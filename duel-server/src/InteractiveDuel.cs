using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Duelo interativo (modelo RPC): dá passos no motor, acumula os eventos de
    /// exibição, resolve sozinho o oponente e as correntes, e PARA quando é a sua
    /// vez de decidir (idle / place / battle do player 0). O front chama Advance()
    /// e depois Respond(...) a cada jogada. Protocolo decifrado em [[ocgcore-protocolo]].
    /// </summary>
    public sealed class InteractiveDuel : IDisposable
    {
        const int END = 0, AWAITING = 1, CONTINUE = 2;
        const byte HUMAN = 0; // só o player 0 joga; o 1 (oponente) passa automático

        /// <summary>Liga o despejo hexadecimal das mensagens ainda em investigação.</summary>
        public static bool DebugSelect = false;
        static bool _dumpedUnselect;

        readonly DuelSession _s;
        Question _pending;
        readonly int[] _lp = { 8000, 8000 }; // pontos de vida dos 2 jogadores

        // Campo: monstros na zona de monstro, por (jogador, sequência).
        // Alimentado pelo MSG_MOVE — é o que a IA do NPC usa para "ver" a mesa.
        readonly Dictionary<(int player, int seq), (uint code, int pos)> _board = new();

        const byte LOCATION_MZONE = 0x4;
        const int POS_FACEUP = 0x1 | 0x4;   // ataque OU defesa com a face para cima

        readonly NpcBrain _npc;
        readonly bool _npcEnabled;
        List<object> _events;   // para o NPC registrar o que fez

        public sealed class Question
        {
            public string kind;                  // idle | place | battle | position | chain | unknown
            public int player;
            public List<Act> summonable = new();
            public List<Act> settable = new();   // monstros setáveis (facedown defense)
            public List<Act> settableST = new(); // magias/armadilhas setáveis
            public List<Act> activatable = new();// cartas ativáveis AGORA (condição ok)
            public bool canBattle, canEnd;
            public List<int> zones = new();      // place: zonas livres
            public string zoneType = "m";        // "m" = monstro, "s" = magia/armadilha
            public List<Act> attackers = new();  // battle
            public int selMin, selMax, selCount; // select_card: quantas escolher / total
            public bool cancelable;
            public bool canFinish;               // selectunselect: já dá para encerrar
            public int sumNeeded;                // selectsum: quanto ainda falta somar
            public List<Sel> choices = new();    // cartas oferecidas na seleção
            public int rawType;                  // tipo bruto da mensagem (p/ "unsupported")
        }
        public struct Act { public uint code; public int index; }

        /// <summary>Carta oferecida num SELECT_CARD / SELECT_TRIBUTE.</summary>
        public struct Sel
        {
            public uint code; public int index;
            public byte controller, location; public int sequence;
            public byte release;   // quantos tributos esta carta vale
            public int param;      // select_sum: quanto esta carta soma (nível)
        }

        public sealed class Result
        {
            public List<object> events = new();
            public Question question;            // null se acabou
            public bool ended;
        }

        public InteractiveDuel(string streamingAssets, uint[] deck, ulong seed,
                               ulong flags = 0, bool npc = true, uint[] npcDeck = null)
        {
            _s = new DuelSession(streamingAssets, deck, npcDeck ?? deck, seed, flags);
            _npcEnabled = npc;
            _npc = new NpcBrain(_s.Cards, FaceUpMonsters, m => Log.Info($"[npc] {m}"));
        }

        /// <summary>
        /// Monstros com a face para cima de um jogador. Só face para cima de
        /// propósito: o NPC não deve "ler" o ATK de uma carta setada, que ele não
        /// teria como conhecer.
        /// </summary>
        IReadOnlyList<uint> FaceUpMonsters(int player)
        {
            var list = new List<uint>();
            foreach (var kv in _board)
                if (kv.Key.player == player && (kv.Value.pos & POS_FACEUP) != 0)
                    list.Add(kv.Value.code);
            return list;
        }

        /// <summary>Avança até a sua vez de decidir (ou o fim). Resolve oponente/correntes.</summary>
        public Result Advance()
        {
            var r = new Result();
            _events = r.events;   // o NPC anexa aqui o que decidiu
            for (int guard = 0; guard < 5000; guard++)
            {
                int status = YgoCoreAPI.OCG_DuelProcess(_s.Handle);
                DrainInto(r.events);

                if (status == END) { r.events.Add(new { type = "end" }); r.ended = true; return r; }
                if (status != AWAITING) continue;

                var q = _pending;
                if (q == null) { _s.Respond(I32(-1)); continue; }         // desconhecido: recusa
                if (q.kind == "chain") { _s.Respond(I32(-1)); continue; }  // ninguém encadeia (vanilla)
                if (q.player != HUMAN) { AutoPass(q); continue; }          // oponente desligado

                // Seleção de cartas do jogador: se houver escolha real, devolve
                // pro front. Sem escolha (só dá para pegar o mínimo), resolve
                // sozinho — pedir clique para uma decisão que não existe irrita.
                if (q.kind is "selectcard" or "selecttribute")
                {
                    if (HasRealChoice(q)) { r.question = q; return r; }
                    _s.Respond(AutoSelect(q));
                    continue;
                }

                // Soma de níveis (ritual): quem escolhe os tributos é o jogador.
                // Só resolvemos sozinho quando existe uma única combinação possível
                // — aí perguntar seria só uma etapa a mais sem decisão nenhuma.
                if (q.kind == "selectsum")
                {
                    if (SomaTemEscolha(q)) { r.question = q; return r; }
                    _s.Respond(AutoSum(q));
                    continue;
                }

                // Seletor incremental: uma carta por vez. Se já dá para encerrar e
                // não sobrou escolha, encerra; senão devolve pro front escolher.
                if (q.kind == "selectunselect")
                {
                    if (q.choices.Count == 0) { _s.Respond(I32(-1)); continue; }
                    if (q.choices.Count == 1 && !q.canFinish)
                    {
                        _s.Respond(PickOne(q.choices[0].index));  // escolha única: não pergunta
                        continue;
                    }
                    r.question = q; return r;
                }
                if (q.kind == "position") { _s.Respond(I32(0x1)); continue; } // face-up ataque
                // pergunta do player 0 que não sei responder: devolve pro front avisar
                // (em vez de travar). O usuário começa um novo duelo.
                if (q.kind == "unsupported") { r.question = q; return r; }

                r.question = q;   // idle / place / battle do player 0 -> devolve pro front
                return r;
            }
            // Estourar o guard significa laço fechado: o motor pede algo que
            // respondemos sempre igual e ele nunca avança. Dizer QUAL pergunta
            // ficou pendente é a diferença entre depurar em minutos ou em horas.
            string travou = _pending == null ? "null" : $"{_pending.kind} p{_pending.player} raw={_pending.rawType}";
            Log.Err($"[guard] laco fechado — pergunta pendente: {travou}");
            r.events.Add(new { type = "end", reason = "guard", stuck = travou });
            r.ended = true;
            return r;
        }

        /// <summary>
        /// Turno do NPC. Com a IA desligada ele só passa o turno (comportamento
        /// antigo, útil para treinar sozinho); ligada, joga pelas regras do
        /// NpcBrain e registra a jogada como evento para o front mostrar.
        /// </summary>
        byte[] NpcIdle(Question q)
        {
            if (!_npcEnabled) return I32(7);

            var play = _npc.Decide(q, q.player);
            _events?.Add(new { type = "npc", action = play.Action, why = play.Why });
            Log.Info($"[npc] {play.Action} -> {play.Why}");

            return play.Action switch
            {
                "activate" => I32((play.Index << 16) | 5),
                "summon" => I32(play.Index << 16),
                "setmonster" => I32((play.Index << 16) | 3),
                _ => I32(7),   // encerra o turno
            };
        }

        /// <summary>Há mais candidatos do que o necessário? Só então vale perguntar.</summary>
        static bool HasRealChoice(Question q)
        {
            if (q.choices.Count == 0) return false;
            return q.choices.Count > Math.Max(1, q.selMin) || q.selMax > q.selMin;
        }

        /// <summary>Aplica a jogada do player e avança de novo.</summary>
        public Result Respond(string action, int arg, IReadOnlyList<int> args = null)
        {
            _s.Respond(action switch
            {
                "select" => EncodeSelect(args ?? new[] { arg }),  // lista de uma vez
                "pick" => PickOne(arg),                            // seletor incremental
                "finishselect" => I32(-1),                         // encerra a seleção
                _ => Encode(action, arg),
            });
            return Advance();
        }

        byte _placeLoc = 0x4; // lembra se o place atual é MZONE(0x4) ou SZONE(0x8)

        byte[] Encode(string action, int arg) => action switch
        {
            "summon" => I32(arg << 16),               // idle, comando 0 = Normal Summon
            "setmonster" => I32((arg << 16) | 3),     // idle, comando 3 = Set (monstro)
            "setspell" => I32((arg << 16) | 4),       // idle, comando 4 = Set (magia/armadilha)
            "activate" => I32((arg << 16) | 5),       // idle, comando 5 = Ativar
            "endturn" => I32(7),                      // idle, encerrar turno
            "battle" => I32(6),                       // idle, ir pra Battle Phase (tentativa)
            "place" => new byte[] { HUMAN, _placeLoc, (byte)arg }, // zona escolhida
            "attack" => I32(arg << 16),               // battlecmd, comando 0 = atacar (tentativa)
            "endbattle" => I32(3),                    // battlecmd, encerrar
            _ => I32(-1),
        };

        void AutoPass(Question q)
        {
            switch (q.kind)
            {
                case "idle": _s.Respond(NpcIdle(q)); break;
                case "battle": _s.Respond(I32(3)); break;         // encerra battle
                case "place":
                    // A localização TEM de acompanhar o tipo de zona pedido: uma
                    // magia vai para a zona de magia (0x8), não para a de monstro.
                    // Fixar 0x4 aqui fazia o motor recusar em laço fechado quando o
                    // NPC ativava o Pote da Ganância.
                    _s.Respond(new byte[]
                    {
                        (byte)q.player,
                        (byte)(q.zoneType == "s" ? 0x8 : 0x4),
                        (byte)(q.zones.Count > 0 ? q.zones[0] : 0),
                    });
                    break;
                case "position": _s.Respond(I32(0x1)); break;
                case "selectcard":
                case "selecttribute": _s.Respond(AutoSelect(q)); break;
                case "selectunselect":
                    // Oponente desligado: escolhe a primeira; se não há o que
                    // escolher, encerra.
                    _s.Respond(q.choices.Count > 0 ? PickOne(q.choices[0].index) : I32(-1));
                    break;
                case "selectsum": _s.Respond(AutoSum(q)); break;   // NPC não escolhe: resolve
                default: _s.Respond(I32(-1)); break;
            }
        }

        // ---- parse das mensagens em eventos + pergunta pendente ----

        void DrainInto(List<object> events)
        {
            IntPtr p = YgoCoreAPI.OCG_DuelGetMessage(_s.Handle, out uint len);
            if (p == IntPtr.Zero || len == 0) return;
            byte[] d = new byte[len];
            Marshal.Copy(p, d, 0, (int)len);

            int off = 0;
            while (off < d.Length)
            {
                int mlen = BitConverter.ToInt32(d, off); off += 4;
                if (mlen <= 0 || off + mlen > d.Length) break;
                try { Parse(d, off, mlen, events); }
                catch (Exception ex) { Log.Err($"[parse] type={d[off]} len={mlen}: {ex.Message}"); }
                off += mlen;
            }
        }

        void Parse(byte[] d, int o, int mlen, List<object> ev)
        {
            byte type = d[o];
            switch (type)
            {
                case 90: // DRAW
                {
                    byte pl = d[o + 1];
                    int count = (int)BitConverter.ToUInt32(d, o + 2);
                    var cards = new List<object>();
                    int p = o + 6;
                    for (int i = 0; i < count; i++)
                    {
                        uint c = BitConverter.ToUInt32(d, p); p += 8;
                        bool hidden = (c & 0x80000000) != 0;
                        cards.Add(new { code = c & 0x7FFFFFFF, hidden });
                    }
                    ev.Add(new { type = "draw", player = pl, cards });
                    break;
                }
                case 40: ev.Add(new { type = "turn", player = d[o + 1] }); break;
                case 41: ev.Add(new { type = "phase", phase = (int)BitConverter.ToInt16(d, o + 1) }); break;
                case 60: ev.Add(new { type = "summoning", code = BitConverter.ToUInt32(d, o + 1) & 0x7FFFFFFF }); break;
                case 50: // MOVE
                {
                    int p = o + 1;
                    uint code = BitConverter.ToUInt32(d, p) & 0x7FFFFFFF; p += 4;
                    byte pc = d[p++], pl = d[p++]; int ps = BitConverter.ToInt32(d, p); p += 4; int ppo = BitConverter.ToInt32(d, p); p += 4;
                    byte cc = d[p++], cl = d[p++]; int cs = BitConverter.ToInt32(d, p); p += 4; int cpo = BitConverter.ToInt32(d, p); p += 4;
                    ev.Add(new { type = "move", code, fromCtrl = pc, fromLoc = pl, fromSeq = ps, controller = cc, loc = cl, seq = cs, pos = cpo });

                    // Mantém o modelo de campo em dia para a IA enxergar a mesa.
                    if (pl == LOCATION_MZONE) _board.Remove((pc, ps));
                    if (cl == LOCATION_MZONE) _board[(cc, cs)] = (code, cpo);
                    break;
                }
                case 91: LpChange(d, o, -1, ev); break; // MSG_DAMAGE: perde LP
                case 92: LpChange(d, o, +1, ev); break; // MSG_RECOVER: ganha LP
                case 100: LpChange(d, o, -1, ev); break; // MSG_PAY_LPCOST: paga LP
                case 11: _pending = ParseIdle(d, o, mlen); break;
                case 18: _pending = ParsePlace(d, o); break;
                case 10: _pending = ParseBattle(d, o, mlen); break;
                case 19: _pending = new Question { kind = "position", player = d[o + 1] }; break;
                case 16: _pending = new Question { kind = "chain", player = d.Length > o + 1 ? d[o + 1] : (byte)0 }; break;
                case 15: _pending = ParseSelectCards(d, o, mlen, "selectcard"); break;
                case 20: _pending = ParseSelectCards(d, o, mlen, "selecttribute"); break;
                case 26: _pending = ParseSelectUnselect(d, o, mlen); break;
                case 23: _pending = ParseSelectSum(d, o, mlen); break;
                default:
                    // qualquer PERGUNTA (10..30) que ainda não trato: marca como não suportada
                    // em vez de deixar o _pending velho travar tudo em silêncio.
                    if (type >= 10 && type <= 30)
                    {
                        _pending = new Question { kind = "unsupported", player = d[o + 1], rawType = type };
                        Log.Info($"[unsupported select type={type} len={mlen}]");
                    }
                    break;
            }
        }

        // Idle: parseia só a lista de invocáveis (início, entradas de 10 bytes) e
        // lê os flags do FIM da mensagem (3 bytes: to_bp, to_ep, shuffle). As listas
        // do meio (spsummon/repos/set/activate) têm tamanho variável e são ignoradas
        // por ora — isso mantém o parse à prova de estouro.
        Question ParseIdle(byte[] d, int o, int mlen)
        {
            int limit = o + mlen;
            var q = new Question { kind = "idle", player = d[o + 1] };
            int p = o + 2;
            q.summonable = ReadActs(d, ref p, limit);       // summon (entradas de 10 bytes)
            ReadActs(d, ref p, limit);                      // special summon
            ReadActs(d, ref p, limit, 7);                   // reposition — entradas de 7 bytes (seq 1 byte)!
            q.settable = ReadActs(d, ref p, limit);         // mset — monstro setável
            q.settableST = ReadActs(d, ref p, limit);       // sset — magia/armadilha setável
            q.activatable = ReadActsDesc(d, ref p, limit);  // activate — condição já atendida

            // Rede de segurança: a mensagem termina em 3 bytes de flag, então o
            // cursor TEM de parar exatamente aqui. Se não parar, algum tamanho de
            // entrada está errado e as listas acima saíram corrompidas — o que já
            // aconteceu e se manifesta como "só a primeira magia é ativável",
            // sem erro nenhum. Melhor gritar.
            int sobra = limit - p;
            if (sobra != 3)
            {
                Log.Err($"[idle] desalinhado: sobraram {sobra} bytes (esperado 3). " +
                        $"summon={q.summonable.Count} mset={q.settable.Count} " +
                        $"sset={q.settableST.Count} act={q.activatable.Count} — " +
                        "algum tamanho de entrada mudou no motor.");
            }

            q.canBattle = d[limit - 3] != 0;
            q.canEnd = d[limit - 2] != 0;
            return q;
        }

        // entrySize: 10 = mão (code4+ctrl1+loc1+seq4); 7 = campo/reposition (seq de 1 byte).
        static List<Act> ReadActs(byte[] d, ref int p, int limit, int entrySize = 10)
        {
            var list = new List<Act>();
            if (p + 4 > limit) return list;
            int n = (int)BitConverter.ToUInt32(d, p); p += 4;
            for (int i = 0; i < n && p + entrySize <= limit; i++)
            {
                list.Add(new Act { code = BitConverter.ToUInt32(d, p), index = i });
                p += entrySize;
            }
            return list;
        }

        /// <summary>
        /// Lista de ativação. Entrada = **19 bytes**:
        ///   code(4) ctrl(1) loc(1) seq(4) description(8) client_mode(1)
        ///
        /// O `client_mode` é fácil de esquecer — com 18 bytes a leitura desalinha
        /// a partir da SEGUNDA carta, e o efeito prático é que só a primeira magia
        /// da mão aparece como ativável. Confirmado na fonte do ocgcore e medido
        /// com `--probe-idle`.
        /// </summary>
        const int ACT_ENTRY = 19;

        static List<Act> ReadActsDesc(byte[] d, ref int p, int limit)
        {
            var list = new List<Act>();
            if (p + 4 > limit) return list;
            int n = (int)BitConverter.ToUInt32(d, p); p += 4;
            for (int i = 0; i < n && p + ACT_ENTRY <= limit; i++)
            {
                list.Add(new Act { code = BitConverter.ToUInt32(d, p), index = i });
                p += ACT_ENTRY;
            }
            return list;
        }

        Question ParsePlace(byte[] d, int o)
        {
            var q = new Question { kind = "place", player = d[o + 1] };
            // d[o+2] = count; d[o+3..] = flag (bit=1 => zona proibida).
            // bits 0..4 = zonas de monstro; bits 8..12 = zonas de magia/armadilha.
            uint flag = BitConverter.ToUInt32(d, o + 3);
            var freeM = new List<int>(); var freeS = new List<int>();
            for (int z = 0; z < 5; z++) if ((flag & (1u << z)) == 0) freeM.Add(z);
            // 6 e não 5: a sequência 5 do grupo de magia é a ZONA DE CAMPO.
            // Sem ela, Magia de Campo não tem onde ser colocada.
            for (int z = 0; z < 6; z++) if ((flag & (1u << (8 + z))) == 0) freeS.Add(z);
            if (freeM.Count > 0) { q.zoneType = "m"; q.zones = freeM; _placeLoc = 0x4; }
            else { q.zoneType = "s"; q.zones = freeS; _placeLoc = 0x8; }
            return q;
        }

        // MSG_DAMAGE/RECOVER/PAY_LPCOST: player(1) + amount(4). sign -1 perde, +1 ganha.
        void LpChange(byte[] d, int o, int sign, List<object> ev)
        {
            byte player = d[o + 1];
            if (player > 1) return;
            int amount = BitConverter.ToInt32(d, o + 2);
            _lp[player] = Math.Max(0, _lp[player] + sign * amount);
            ev.Add(new { type = "lp", player, lp = _lp[player], delta = sign * amount });
        }

        /// <summary>
        /// SELECT_CARD (15) e SELECT_TRIBUTE (20) compartilham o layout:
        ///   type(1) player(1) cancelable(1) min(4) max(4) count(4)
        /// e depois uma entrada por carta. No SELECT_CARD a entrada tem 10 bytes
        /// (code, ctrl, loc, seq); no SELECT_TRIBUTE tem 11 — o byte extra é
        /// quantos tributos a carta vale. Deduzimos o tamanho pelo comprimento
        /// da mensagem em vez de assumir, porque isso já mordeu antes.
        /// </summary>
        Question ParseSelectCards(byte[] d, int o, int mlen, string kind)
        {
            var q = new Question
            {
                kind = kind,
                player = d[o + 1],
                cancelable = d[o + 2] != 0,
                selMin = BitConverter.ToInt32(d, o + 3),
                selMax = BitConverter.ToInt32(d, o + 7),
                selCount = BitConverter.ToInt32(d, o + 11),
            };

            const int header = 15;
            int rest = mlen - header;
            if (q.selCount > 0 && rest >= q.selCount)
            {
                int entry = rest / q.selCount;
                for (int i = 0; i < q.selCount; i++)
                {
                    int p = o + header + i * entry;
                    if (p + entry > o + mlen) break;
                    q.choices.Add(new Sel
                    {
                        code = BitConverter.ToUInt32(d, p),
                        index = i,
                        controller = d[p + 4],
                        location = d[p + 5],
                        sequence = BitConverter.ToInt32(d, p + 6),
                        release = entry >= 11 ? d[p + 10] : (byte)1,
                    });
                }
            }
            return q;
        }

        /// <summary>
        /// Resposta de seleção de cartas, no formato que o ocgcore realmente lê
        /// (`parse_response_cards`, playerop.cpp):
        ///   [int32 tipo][uint32 quantidade][índices...]
        /// tipo 0 = índices uint32, 1 = uint16, 2 = uint8, 3 = bitfield, -1 = cancelar.
        ///
        /// O prefixo de tipo é o detalhe que faltava: sem ele o motor devolve
        /// MSG_RETRY para qualquer buffer, por mais correto que o resto pareça.
        /// </summary>
        /// <summary>
        /// SELECT_UNSELECT_CARD: escolhe UMA carta. Formato [int32 1][int32 índice].
        ///
        /// O primeiro campo tem que valer exatamente 1 — o motor recusa 0 e
        /// qualquer valor maior que 1 (`returns.at&lt;int32_t&gt;(0) == 0 || > 1`
        /// devolve MSG_RETRY). -1 encerra/cancela a seleção.
        /// </summary>
        static byte[] PickOne(int index)
        {
            var b = new byte[8];
            BitConverter.GetBytes(1).CopyTo(b, 0);
            BitConverter.GetBytes(index).CopyTo(b, 4);
            return b;
        }

        public static byte[] EncodeSelect(IReadOnlyList<int> indices)
        {
            var b = new byte[8 + indices.Count * 4];
            BitConverter.GetBytes(0).CopyTo(b, 0);                  // tipo 0 = uint32
            BitConverter.GetBytes((uint)indices.Count).CopyTo(b, 4);
            for (int i = 0; i < indices.Count; i++)
                BitConverter.GetBytes((uint)indices[i]).CopyTo(b, 8 + i * 4);
            return b;
        }

        /// <summary>
        /// SELECT_UNSELECT_CARD (26) — o seletor incremental do core novo, usado
        /// nos tributos: em vez de mandar a lista pronta, escolhe-se UMA carta por
        /// vez e o motor repergunta, até dar "encerrar".
        ///
        ///   type(1) player(1) finishable(1) cancelable(1) min(4) max(4)
        ///   count(4) + entradas   (cartas selecionáveis)
        ///   count(4) + entradas   (cartas já escolhidas, para desmarcar)
        ///
        /// Resposta: [int32 0][int32 índice] escolhe; [int32 -1] encerra.
        /// O tamanho da entrada é deduzido do comprimento da mensagem — assumir
        /// já custou caro antes.
        /// </summary>
        Question ParseSelectUnselect(byte[] d, int o, int mlen)
        {
            var q = new Question
            {
                kind = "selectunselect",
                player = d[o + 1],
                cancelable = d[o + 3] != 0,
                canFinish = d[o + 2] != 0,
                selMin = BitConverter.ToInt32(d, o + 4),
                selMax = BitConverter.ToInt32(d, o + 8),
            };

            if (DebugSelect && !_dumpedUnselect)
            {
                _dumpedUnselect = true;
                var slice = new byte[Math.Min(mlen, 96)];
                Array.Copy(d, o, slice, 0, slice.Length);
                Log.Info($"[26 raw len={mlen}] {BitConverter.ToString(slice).Replace("-", " ")}");
            }

            const int header = 12;
            int c1 = BitConverter.ToInt32(d, o + header);
            int after1 = o + header + 4;
            int bytesForEntries = mlen - header - 8;    // tira os dois contadores
            int c2 = 0, entry = 0;
            if (c1 > 0)
            {
                // (c1 + c2) * entry = bytesForEntries. Tenta os tamanhos plausíveis.
                foreach (int e in new[] { 14, 10, 12, 8, 11 })
                {
                    if (bytesForEntries % e != 0) continue;
                    int total = bytesForEntries / e;
                    if (total < c1) continue;
                    entry = e; c2 = total - c1; break;
                }
            }

            if (entry > 0)
            {
                for (int i = 0; i < c1; i++)
                {
                    int p = after1 + i * entry;
                    if (p + entry > o + mlen) break;
                    q.choices.Add(new Sel
                    {
                        code = BitConverter.ToUInt32(d, p),
                        index = i,
                        controller = d[p + 4],
                        location = d[p + 5],
                        sequence = entry >= 10 ? BitConverter.ToInt32(d, p + 6) : 0,
                        release = 1,
                    });
                }
            }
            q.selCount = q.choices.Count;
            return q;
        }

        /// <summary>
        /// SELECT_SUM (23) — usado pelo ritual: escolher cartas cujos níveis SOMEM
        /// exatamente o valor pedido. A resposta usa o mesmo formato do
        /// SELECT_CARD (`parse_response_cards`), o que muda é a mensagem:
        ///
        ///   type(1) player(1) semMax(1) acc(4) min(4) max(4)
        ///   mustCount(4)   + entradas de 18 bytes  (obrigatórias, já contam)
        ///   selectCount(4) + entradas de 18 bytes  (as que podemos escolher)
        ///
        /// Entrada = code(4) + info_location(10) + sum_param(4).
        /// </summary>
        Question ParseSelectSum(byte[] d, int o, int mlen)
        {
            var q = new Question { kind = "selectsum", player = d[o + 1] };
            int acc = BitConverter.ToInt32(d, o + 3);
            q.selMin = BitConverter.ToInt32(d, o + 7);
            q.selMax = BitConverter.ToInt32(d, o + 11);

            const int entry = 18;
            int p = o + 15;
            int mustCount = BitConverter.ToInt32(d, p); p += 4;

            // As cartas obrigatórias já entram na conta; o que sobra é o alvo.
            int mustSum = 0;
            for (int i = 0; i < mustCount && p + entry <= o + mlen; i++)
            {
                mustSum += BitConverter.ToInt32(d, p + 14) & 0xffff;
                p += entry;
            }

            int selCount = p + 4 <= o + mlen ? BitConverter.ToInt32(d, p) : 0; p += 4;
            for (int i = 0; i < selCount && p + entry <= o + mlen; i++)
            {
                q.choices.Add(new Sel
                {
                    code = BitConverter.ToUInt32(d, p),
                    index = i,
                    controller = d[p + 4],
                    location = d[p + 5],
                    sequence = BitConverter.ToInt32(d, p + 6),
                    param = BitConverter.ToInt32(d, p + 14) & 0xffff,
                });
                p += entry;
            }
            q.selCount = q.choices.Count;
            q.sumNeeded = acc - mustSum;
            return q;
        }

        /// <summary>
        /// Acha um subconjunto cujos níveis somem exatamente o alvo. As listas
        /// aqui são pequenas (cartas em campo/mão), então busca exaustiva basta e
        /// evita a heurística gulosa errar quando os níveis não são uniformes.
        /// </summary>
        static List<int> SubsetForSum(List<Sel> items, int target, int minCount, int maxCount)
        {
            var best = new List<int>();
            var cur = new List<int>();

            bool Search(int i, int sum)
            {
                if (sum == target &&
                    cur.Count >= Math.Max(1, minCount) &&
                    (maxCount <= 0 || cur.Count <= maxCount))
                {
                    best = new List<int>(cur);
                    return true;
                }
                if (sum > target || i >= items.Count) return false;
                if (maxCount > 0 && cur.Count > maxCount) return false;

                cur.Add(items[i].index);
                if (Search(i + 1, sum + Math.Max(1, items[i].param))) return true;
                cur.RemoveAt(cur.Count - 1);

                return Search(i + 1, sum);
            }

            Search(0, 0);
            return best;
        }

        /// <summary>
        /// Há mais de uma forma de somar o alvo? Só então vale perguntar ao jogador.
        /// Conta as combinações até achar a segunda — não precisa enumerar todas.
        /// </summary>
        static bool SomaTemEscolha(Question q)
        {
            if (q.choices.Count == 0) return false;
            int achadas = 0;

            void Busca(int i, int soma, int usados)
            {
                if (achadas >= 2) return;
                if (soma == q.sumNeeded && usados > 0) { achadas++; return; }
                if (soma > q.sumNeeded || i >= q.choices.Count) return;
                Busca(i + 1, soma + Math.Max(1, q.choices[i].param), usados + 1);
                Busca(i + 1, soma, usados);
            }
            Busca(0, 0, 0);
            return achadas >= 2;
        }

        /// <summary>Resolve o SELECT_SUM sozinho quando não há escolha interessante.</summary>
        byte[] AutoSum(Question q)
        {
            var pick = SubsetForSum(q.choices, q.sumNeeded, q.selMin, q.selMax);
            if (pick.Count == 0)
            {
                // Não achou combinação exata: manda o mínimo e deixa o motor reclamar,
                // em vez de travar o duelo em silêncio.
                Log.Err($"[selectsum] nenhum subconjunto soma {q.sumNeeded} " +
                        $"entre {q.choices.Count} cartas");
                for (int i = 0; i < Math.Max(1, q.selMin) && i < q.choices.Count; i++)
                    pick.Add(q.choices[i].index);
            }
            return EncodeSelect(pick);
        }

        /// <summary>Escolha automática: pega as primeiras cartas até satisfazer o mínimo.</summary>
        static byte[] AutoSelect(Question q)
        {
            int need = Math.Max(1, q.selMin);
            var idx = new List<int>();

            // No tributo cada carta pode valer mais de um; soma até bater o pedido.
            if (q.choices.Count > 0 && q.choices[0].release > 0)
            {
                int sum = 0;
                foreach (var c in q.choices)
                {
                    if (sum >= need) break;
                    idx.Add(c.index);
                    sum += Math.Max(1, (int)c.release);
                }
            }
            else
            {
                for (int i = 0; i < need && i < Math.Max(q.selCount, need); i++) idx.Add(i);
            }
            return EncodeSelect(idx);
        }

        Question ParseBattle(byte[] d, int o, int mlen)
        {
            var q = new Question { kind = "battle", player = d[o + 1] };
            int p = o + 2;
            q.attackers = ReadActs(d, ref p, o + mlen);
            return q;
        }

        static byte[] I32(int v) => BitConverter.GetBytes(v);

        public void Dispose() => _s.Dispose();
    }
}

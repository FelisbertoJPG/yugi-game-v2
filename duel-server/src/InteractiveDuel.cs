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

        readonly DuelSession _s;
        Question _pending;
        readonly int[] _lp = { 8000, 8000 }; // pontos de vida dos 2 jogadores

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
            public int rawType;                  // tipo bruto da mensagem (p/ "unsupported")
        }
        public struct Act { public uint code; public int index; }

        public sealed class Result
        {
            public List<object> events = new();
            public Question question;            // null se acabou
            public bool ended;
        }

        public InteractiveDuel(string streamingAssets, uint[] deck, ulong seed, ulong flags = 0)
        {
            _s = new DuelSession(streamingAssets, deck, deck, seed, flags);
        }

        /// <summary>Avança até a sua vez de decidir (ou o fim). Resolve oponente/correntes.</summary>
        public Result Advance()
        {
            var r = new Result();
            for (int guard = 0; guard < 5000; guard++)
            {
                int status = YgoCoreAPI.OCG_DuelProcess(_s.Handle);
                DrainInto(r.events);

                if (status == END) { r.events.Add(new { type = "end" }); r.ended = true; return r; }
                if (status != AWAITING) continue;

                var q = _pending;
                if (q == null) { _s.Respond(I32(-1)); continue; }         // desconhecido: recusa
                if (q.kind == "chain") { _s.Respond(I32(-1)); continue; }  // ninguém encadeia (vanilla)
                // descarte por limite de mão (7+): resolve automático dos dois lados
                if (q.kind == "selectcard") { _s.Respond(SelectCards(q)); continue; }
                if (q.player != HUMAN) { AutoPass(q); continue; }          // oponente desligado
                if (q.kind == "position") { _s.Respond(I32(0x1)); continue; } // face-up ataque
                // pergunta do player 0 que não sei responder: devolve pro front avisar
                // (em vez de travar). O usuário começa um novo duelo.
                if (q.kind == "unsupported") { r.question = q; return r; }

                r.question = q;   // idle / place / battle do player 0 -> devolve pro front
                return r;
            }
            r.events.Add(new { type = "end", reason = "guard" }); r.ended = true;
            return r;
        }

        /// <summary>Aplica a jogada do player e avança de novo.</summary>
        public Result Respond(string action, int arg)
        {
            _s.Respond(Encode(action, arg));
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
                case "idle": _s.Respond(I32(7)); break;           // oponente encerra o turno
                case "battle": _s.Respond(I32(3)); break;         // encerra battle
                case "place": _s.Respond(new byte[] { (byte)q.player, 0x4, (byte)(q.zones.Count > 0 ? q.zones[0] : 0) }); break;
                case "position": _s.Respond(I32(0x1)); break;
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
                case 15: _pending = ParseSelectCard(d, o); break; // ex.: descarte por limite de mão
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

        // Lista de ativação: cada entrada tem um "description" extra (8 bytes).
        static List<Act> ReadActsDesc(byte[] d, ref int p, int limit)
        {
            var list = new List<Act>();
            if (p + 4 > limit) return list;
            int n = (int)BitConverter.ToUInt32(d, p); p += 4;
            for (int i = 0; i < n && p + 18 <= limit; i++)
            {
                list.Add(new Act { code = BitConverter.ToUInt32(d, p), index = i });
                p += 18; // code(4)+ctrl(1)+loc(1)+seq(4)+desc(8)
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
            for (int z = 0; z < 5; z++) if ((flag & (1u << (8 + z))) == 0) freeS.Add(z);
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

        // SELECT_CARD: type(1) player(1) cancelable(1) min(4) max(4) count(4) + cartas
        Question ParseSelectCard(byte[] d, int o)
        {
            return new Question
            {
                kind = "selectcard",
                player = d[o + 1],
                selMin = BitConverter.ToInt32(d, o + 3),
                selMax = BitConverter.ToInt32(d, o + 7),
                selCount = BitConverter.ToInt32(d, o + 11),
            };
        }

        // Fallback caso o SELECT_CARD apareça mesmo assim (com NO_HAND_LIMIT não vem):
        // formato edo9300/EDOPro em bytes [count][índice...]. Escolhe as primeiras.
        byte[] SelectCards(Question q)
        {
            int n = Math.Max(1, q.selMin);
            var b = new byte[1 + n];
            b[0] = (byte)n;
            for (int i = 0; i < n; i++) b[i + 1] = (byte)i;
            return b;
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

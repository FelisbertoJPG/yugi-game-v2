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
        bool _gameOver;                      // MSG_WIN visto: o host TEM de parar
        int _winByte = -1;                   // player do MSG_WIN (0/1 vencedor, 2 empate)

        // Campo: monstros na zona de monstro, por (jogador, sequência).
        // Alimentado pelo MSG_MOVE — é o que a IA do NPC usa para "ver" a mesa.
        readonly Dictionary<(int player, int seq), (uint code, int pos)> _board = new();

        // Mão de cada jogador e quantas zonas de magia/armadilha (SZONE) estão
        // ocupadas — a IA usa para achar o Reborn na mão e não afogar as magias
        // com armadilhas setadas. Alimentados pelo MSG_DRAW e pelo MSG_MOVE.
        readonly List<uint>[] _hand = { new(), new() };
        readonly int[] _st = { 0, 0 };
        // Modelo da zona de magia/armadilha, por (jogador, sequência), com a
        // POSIÇÃO. Serve para duas perguntas que o NPC precisa fazer: "o
        // oponente tem carta setada?" (vale gastar remoção) e "ele tem uma
        // contínua aberta?" (ex.: Call of the Haunted, que ao ser destruída leva
        // junto o monstro revivido). Alimentado pelo MSG_MOVE e pelo POS_CHANGE.
        readonly Dictionary<(int player, int seq), (uint code, int pos)> _stBoard = new();

        const byte LOCATION_MZONE = 0x4;
        const byte LOCATION_HAND = 0x2;
        const byte LOCATION_SZONE = 0x8;

        /// <summary>A carta está OCULTA para você? Virada (pos &amp; 0xa = face-down)
        /// e do oponente (ctrl != HUMAN). O front nunca deve receber o código dela —
        /// senão dá para espiar o que o adversário setou. Confia no core: é ele que
        /// diz a posição. (O código real fica só no `_board`, para a IA enxergar.)</summary>
        static bool Oculta(int pos, int ctrl) => (pos & 0xa) != 0 && ctrl != HUMAN;
        const int POS_FACEUP = 0x1 | 0x4;   // ataque OU defesa com a face para cima

        readonly NpcBrain _npc;
        readonly bool _npcEnabled;
        List<object> _events;   // para o NPC registrar o que fez

        /// <summary>Gancho de diagnóstico do SELECT_CHAIN cru (só o --probe-chain liga).</summary>
        public static Action<byte[], int, int> ChainProbe;

        public sealed class Question
        {
            public string kind;                  // idle | place | battle | position | chain | unknown
            public int player;
            public List<Act> summonable = new();
            public List<Act> settable = new();   // monstros setáveis (facedown defense)
            public List<Act> settableST = new(); // magias/armadilhas setáveis
            public List<Act> activatable = new();// cartas ativáveis AGORA (condição ok)
            // Cartas em campo que podem MUDAR DE POSIÇÃO agora. Quem decide se
            // pode é o motor: monstro invocado neste turno não entra na lista,
            // e é assim que a regra "só vira no turno seguinte" se aplica sozinha.
            public List<Act> repositionable = new();
            public bool canBattle, canEnd;
            public bool canMain2;                // battle: dá para ir à Main Phase 2
            public List<int> zones = new();      // place: zonas livres
            public string zoneType = "m";        // "m" = monstro, "s" = magia/armadilha
            public List<Act> attackers = new();  // battle
            public int selMin, selMax, selCount; // select_card: quantas escolher / total
            public bool cancelable;
            public bool canFinish;               // selectunselect: já dá para encerrar
            public int sumNeeded;                // selectsum: quanto ainda falta somar
            public bool sumOverflow;             // selectsum: soma "OU MAIS" (ritual) vs exata
            public bool chainForced;             // chain: TEM de ativar algo (não pode recusar)
            public uint askCode;                 // yesno (EFFECTYN) / position: carta em questão
            public byte posMask;                 // position: posições que o motor aceita
            public List<Sel> choices = new();    // cartas oferecidas na seleção
            public int rawType;                  // tipo bruto da mensagem (p/ "unsupported")
        }
        /// <summary>
        /// Uma opção do idle. `location`/`sequence` dizem ONDE a carta está —
        /// sem isso o front não consegue ligar a opção à zona certa do tabuleiro
        /// (a mão casa por código, mas o campo precisa da posição exata).
        /// </summary>
        public struct Act
        {
            public uint code; public int index;
            public byte controller, location; public int sequence;
            public bool canDirect;   // battlecmd: pode atacar direto (campo vazio)
        }

        /// <summary>Carta oferecida num SELECT_CARD / SELECT_TRIBUTE.</summary>
        public struct Sel
        {
            public uint code; public int index;
            public byte controller, location; public int sequence;
            public byte release;   // quantos tributos esta carta vale
            public int param;      // select_sum: quanto esta carta soma (nível)
            public bool hidden;    // carta virada do oponente: código omitido (code=0)
        }

        public sealed class Result
        {
            public List<object> events = new();
            public Question question;            // null se acabou
            public bool ended;
        }

        public InteractiveDuel(string streamingAssets, uint[] deck, ulong seed,
                               ulong flags = 0, bool npc = true, uint[] npcDeck = null,
                               uint[] extra = null, uint[] npcExtra = null)
        {
            // Sem `npcDeck` o oponente joga com o SEU deck; o Extra segue a mesma
            // regra, senão ele duelaria com o seu main e o extra de outro deck.
            _s = new DuelSession(streamingAssets, deck, npcDeck ?? deck, seed, flags,
                                 extra, npcDeck != null ? npcExtra : (npcExtra ?? extra));
            _npcEnabled = npc;
            _npc = new NpcBrain(_s.Cards, FaceUpMonsters, m => Log.Info($"[npc] {m}"),
                                HandOf, StCountOf, FaceUpMonstersPos, SetStCountOf, FaceUpStOf);
        }

        /// <summary>Cartas na mão de um jogador (para a IA achar Reborn/dragões).</summary>
        IReadOnlyList<uint> HandOf(int player) =>
            player >= 0 && player <= 1 ? _hand[player] : (IReadOnlyList<uint>)Array.Empty<uint>();

        /// <summary>Zonas de magia/armadilha ocupadas de um jogador.</summary>
        int StCountOf(int player) => player >= 0 && player <= 1 ? _st[player] : 0;

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

        /// <summary>
        /// Os mesmos monstros, mas COM a posição.
        ///
        /// Sem isto o NpcBrain não distinguia ataque de defesa e atacava uma
        /// Mystical Elf (800/2000) deitada com um Battle Ox (1700): ele comparava
        /// com os 800 de ATK, quando a batalha real é contra 2000 de DEF.
        /// </summary>
        IReadOnlyList<(uint code, int pos)> FaceUpMonstersPos(int player)
        {
            var list = new List<(uint, int)>();
            foreach (var kv in _board)
                if (kv.Key.player == player && (kv.Value.pos & POS_FACEUP) != 0)
                    list.Add((kv.Value.code, kv.Value.pos));
            return list;
        }

        /// <summary>
        /// Quantas magias/armadilhas do jogador estão VIRADAS (setadas).
        ///
        /// É a informação que falta para o NPC não queimar uma remoção de
        /// magia/armadilha à toa: destruir uma magia que já está resolvendo não
        /// impede nada, então a carta só vale contra o que ainda está baixado.
        /// </summary>
        int SetStCountOf(int player)
        {
            int n = 0;
            foreach (var kv in _stBoard)
                if (kv.Key.player == player && (kv.Value.pos & 0xa) != 0) n++;   // 0x2/0x8 = virada
            return n;
        }

        /// <summary>
        /// Magias/armadilhas do jogador que estão ABERTAS (face para cima), com o
        /// código. É informação pública — qualquer humano as vê. Serve para o NPC
        /// reconhecer alvos que valem uma remoção mesmo sem estarem setados, como
        /// o Call of the Haunted: destruí-lo mata junto o monstro que ele reviveu.
        /// </summary>
        IReadOnlyList<uint> FaceUpStOf(int player)
        {
            var list = new List<uint>();
            foreach (var kv in _stBoard)
                if (kv.Key.player == player && (kv.Value.pos & POS_FACEUP) != 0 && kv.Value.code != 0)
                    list.Add(kv.Value.code);
            return list;
        }

        /// <summary>Vencedor do duelo: 0/1, ou -1 para empate. LP zerado manda; se
        /// ninguém zerou (ex.: deckout), usa o player do MSG_WIN (2 = empate).</summary>
        int Winner()
        {
            bool p0dead = _lp[0] <= 0, p1dead = _lp[1] <= 0;
            if (p1dead && !p0dead) return 0;
            if (p0dead && !p1dead) return 1;
            return _winByte == 0 || _winByte == 1 ? _winByte : -1;
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

                // O ocgcore avisa o fim pelo MSG_WIN (não por um status de END quando
                // o LP zera no meio da fase). Ao vê-lo, o host TEM de parar — senão o
                // duelo segue com o LP travado em 0, sem nunca encerrar.
                if (status == END || _gameOver)
                {
                    r.events.Add(new { type = "end", winner = Winner() });
                    r.ended = true; return r;
                }
                if (status != AWAITING) continue;

                var q = _pending;
                if (q == null) { _s.Respond(I32(-1)); continue; }         // desconhecido: recusa

                // Enquanto uma cadeia está sendo MONTADA só aparecem janelas de
                // corrente; qualquer outra pergunta significa que ela já resolveu.
                // É esse o sinal que zera a memória do NPC de "já encadeei" —
                // sem ele, ele encadearia uma vez e nunca mais.
                if (q.kind != "chain") _npc.ResetCadeia();

                // Corrente (SELECT_CHAIN): janela sem nada some sozinha; com opções,
                // o NPC decide pela sua regra e o humano decide na tela.
                if (q.kind == "chain")
                {
                    if (q.choices.Count == 0) { _s.Respond(I32(-1)); continue; }
                    if (q.player != HUMAN) { _s.Respond(NpcChain(q)); continue; }
                    r.question = q; return r;
                }

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
                // SELECT_POSITION: quem escolhe é o JOGADOR. Invocação-Ritual (e
                // qualquer Invocação-Especial) pode entrar em ataque OU em defesa
                // com a face para cima — não é Set, é escolha de posição. Antes
                // respondíamos 0x1 aqui e o ritual sempre caía em ataque, sem a
                // pergunta jamais chegar à tela.
                if (q.kind == "position" && q.player == HUMAN) { r.question = q; return r; }
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
                "setspell" => I32((play.Index << 16) | 4),   // seta magia/armadilha
                "battle" => I32(6),   // vai para a Battle Phase
                _ => I32(7),   // encerra o turno
            };
        }

        /// <summary>Seleção do NPC (tributo/alvo/descarte/reborn) pela regra do brain.</summary>
        byte[] NpcSelect(Question q)
        {
            var idx = _npcEnabled ? _npc.DecideSelect(q, q.player) : null;
            return idx != null && idx.Count > 0 ? EncodeSelect(idx) : AutoSelect(q);
        }

        /// <summary>
        /// Soma do ritual (SELECT_SUM) para o NPC: prefere alimentar o cemitério com
        /// o monstro de MAIOR nível, então ordena as opções por nível decrescente
        /// antes de procurar a combinação — assim o dragão grande entra como material.
        /// </summary>
        byte[] NpcSum(Question q)
        {
            if (!_npcEnabled) return AutoSum(q);
            var ordenado = q.choices.OrderByDescending(c => c.param).ToList();
            List<int> pick = null;
            EnumeraSomas(ordenado, q.sumNeeded, q.selMin, q.selMax, q.sumOverflow,
                         p => { pick = p; return false; });
            return pick != null && pick.Count > 0 ? EncodeSelect(pick) : AutoSum(q);
        }

        /// <summary>
        /// Turno do NPC na Battle Phase. Desligada a IA, encerra o combate (I32(3));
        /// ligada, o NpcBrain decide se ataca (comando 1, índice do atacante) ou
        /// encerra. O motor volta a perguntar por atacante, então cada chamada
        /// resolve um ataque.
        /// </summary>
        byte[] NpcBattle(Question q)
        {
            if (!_npcEnabled) return I32(3);

            var play = _npc.DecideBattle(q, q.player);
            _events?.Add(new { type = "npc", action = play.Attack ? "attack" : "endbattle", why = play.Why });
            Log.Info($"[npc] {(play.Attack ? "attack" : "endbattle")} -> {play.Why}");

            return play.Attack ? I32((play.Index << 16) | 1) : I32(3);
        }

        /// <summary>
        /// Corrente do NPC (SELECT_CHAIN com opções). O NpcBrain diz qual índice
        /// ativar (ou -1 para recusar). Registra o que ativou para o front mostrar.
        /// </summary>
        byte[] NpcChain(Question q)
        {
            int idx = _npcEnabled ? _npc.DecideChain(q, q.player) : -1;
            if (idx >= 0 && idx < q.choices.Count)
            {
                var c = q.choices[idx];
                _events?.Add(new { type = "npc", action = "chain", code = c.code, why = $"ativa {c.code} em resposta" });
                Log.Info($"[npc] chain -> ativa {c.code} (idx {idx})");
            }
            return I32(idx);
        }

        /// <summary>Há mais candidatos do que o necessário? Só então vale perguntar.</summary>
        static bool HasRealChoice(Question q)
        {
            if (q.choices.Count == 0) return false;
            return q.choices.Count > Math.Max(1, q.selMin) || q.selMax > q.selMin;
        }

        /// <summary>
        /// Quais ações fazem sentido para cada pergunta pendente.
        ///
        /// Isto não é preciosismo: os buffers de resposta são apenas bytes, e um
        /// buffer válido para uma pergunta costuma ser válido — com outro
        /// significado — para outra. Um "attack" respondido a um SELECT_PLACE
        /// vira `01 00 00 00`, que o motor lê como `[jogador 1, ...]` e entrega a
        /// carta ao OPONENTE. Recusar aqui é mais barato que caçar o efeito.
        /// </summary>
        static readonly Dictionary<string, string[]> AcoesValidas = new()
        {
            ["idle"] = new[] { "summon", "reposition", "setmonster", "setspell",
                               "activate", "battle", "endturn" },
            ["place"] = new[] { "place" },
            ["battle"] = new[] { "attack", "battleactivate", "tomain2", "endbattle" },
            ["selectcard"] = new[] { "select" },
            ["selecttribute"] = new[] { "select" },
            ["selectsum"] = new[] { "select" },
            ["selectunselect"] = new[] { "pick", "finishselect" },
            ["position"] = new[] { "position" },
            ["chain"] = new[] { "chain" },
            ["yesno"] = new[] { "yesno" },
        };

        /// <summary>Aplica a jogada do player e avança de novo.</summary>
        public Result Respond(string action, int arg, IReadOnlyList<int> args = null)
        {
            string esperada = _pending?.kind;
            if (esperada != null && AcoesValidas.TryGetValue(esperada, out var ok)
                && Array.IndexOf(ok, action) < 0)
            {
                Log.Err($"[respond] acao '{action}' nao combina com a pergunta " +
                        $"pendente '{esperada}' — ignorada (esperado: {string.Join("/", ok)})");
                var recusa = new Result { question = _pending };
                recusa.events.Add(new { type = "refused", action, expected = esperada });
                return recusa;
            }

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

        // Comandos do SELECT_IDLECMD: (índice << 16) | comando.
        //   0 summon · 1 spsummon · 2 reposição · 3 mset · 4 sset
        //   5 ativar · 6 ir pra Battle · 7 End Phase
        // Comandos do SELECT_BATTLECMD:
        //   0 atacar · 1 ativar · 2 ir pra Main2 · 3 End Phase
        byte[] Encode(string action, int arg) => action switch
        {
            "summon" => I32(arg << 16),               // idle, comando 0 = Normal Summon
            "reposition" => I32((arg << 16) | 2),     // idle, comando 2 = mudar posição
            "setmonster" => I32((arg << 16) | 3),     // idle, comando 3 = Set (monstro)
            "setspell" => I32((arg << 16) | 4),       // idle, comando 4 = Set (magia/armadilha)
            "activate" => I32((arg << 16) | 5),       // idle, comando 5 = Ativar
            "battle" => I32(6),                       // idle, ir pra Battle Phase
            "endturn" => I32(7),                      // idle, End Phase
            "place" => new byte[] { HUMAN, _placeLoc, (byte)arg }, // zona escolhida
            // ⚠ No battlecmd a lista de ATIVÁVEIS vem antes da de atacantes, então
            // ativar é o comando 0 e atacar é o 1 — o contrário do que parece.
            "battleactivate" => I32(arg << 16),       // battlecmd, comando 0 = ativar
            "attack" => I32((arg << 16) | 1),         // battlecmd, comando 1 = atacar
            "tomain2" => I32(2),                      // battlecmd, comando 2 = ir pra Main2
            "endbattle" => I32(3),                    // battlecmd, comando 3 = End Phase
            "chain" => I32(arg),                      // corrente: índice a ativar, ou -1 recusa
            "yesno" => I32(arg),                      // sim/não: 1 = sim, 0 = não
            // Posição escolhida: 0x1 ataque, 0x4 defesa com a FACE PARA CIMA.
            // Faltava aqui: "position" já constava em AcoesValidas, mas caía no
            // `_ => I32(-1)` e o motor recusava tudo. Passou despercebido porque
            // o host respondia a posição por dentro, sem usar este Encode.
            "position" => I32(arg),
            _ => I32(-1),
        };

        void AutoPass(Question q)
        {
            switch (q.kind)
            {
                case "idle": _s.Respond(NpcIdle(q)); break;
                case "battle": _s.Respond(NpcBattle(q)); break;   // ataca pelas regras (ou encerra)
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
                case "position":
                    // Statline decide: parede fica deitada (com a face para cima,
                    // que não é Set). Com a IA desligada, mantém o ataque de antes.
                    _s.Respond(I32(_npcEnabled ? _npc.DecidePosicao(q.askCode, q.posMask) : 0x1));
                    break;
                case "yesno":
                    // Efeito opcional (ex.: Dust Tornado setar da mão): o NPC aceita.
                    _events?.Add(new { type = "npc", action = "yesno", why = "aceita o efeito opcional" });
                    _s.Respond(I32(1));
                    break;
                case "selectcard":
                case "selecttribute": _s.Respond(NpcSelect(q)); break;
                case "selectunselect":
                    // Oponente desligado: escolhe a primeira; se não há o que
                    // escolher, encerra.
                    _s.Respond(q.choices.Count > 0 ? PickOne(q.choices[0].index) : I32(-1));
                    break;
                case "selectsum": _s.Respond(NpcSum(q)); break;   // ritual: prefere nível alto
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
                case 1: // MSG_RETRY — o motor recusou a última resposta
                {
                    // Sem isto o RETRY é invisível: a tela simplesmente não reage
                    // e parece que o clique não funcionou. Foi assim que uma
                    // seleção de ritual com soma errada passou por "não consigo
                    // usar esta carta".
                    Log.Err($"[retry] o motor recusou a resposta anterior " +
                            $"(pergunta pendente: {_pending?.kind ?? "nenhuma"})");
                    ev.Add(new { type = "retry", question = _pending?.kind });
                    break;
                }
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
                        uint real = c & 0x7FFFFFFF;
                        cards.Add(new { code = real, hidden });
                        if (pl <= 1) _hand[pl].Add(real);   // a IA precisa saber a mão do NPC
                    }
                    ev.Add(new { type = "draw", player = pl, cards });
                    break;
                }
                case 5: // MSG_WIN — o duelo ACABOU. player(1)=vencedor (2=empate), reason(1).
                    _gameOver = true;
                    _winByte = d[o + 1];
                    break;
                case 40: ev.Add(new { type = "turn", player = d[o + 1] }); break;
                case 41: ev.Add(new { type = "phase", phase = (int)BitConverter.ToInt16(d, o + 1) }); break;
                case 60: ev.Add(new { type = "summoning", code = BitConverter.ToUInt32(d, o + 1) & 0x7FFFFFFF }); break;
                case 50: // MOVE
                {
                    int p = o + 1;
                    uint code = BitConverter.ToUInt32(d, p) & 0x7FFFFFFF; p += 4;
                    byte pc = d[p++], pl = d[p++]; int ps = BitConverter.ToInt32(d, p); p += 4; int ppo = BitConverter.ToInt32(d, p); p += 4;
                    byte cc = d[p++], cl = d[p++]; int cs = BitConverter.ToInt32(d, p); p += 4; int cpo = BitConverter.ToInt32(d, p); p += 4;
                    // Carta que ASSENTA virada no campo do oponente sai sem código.
                    bool ocultaMv = Oculta(cpo, cc);
                    ev.Add(new { type = "move", code = ocultaMv ? 0u : code, hidden = ocultaMv, fromCtrl = pc, fromLoc = pl, fromSeq = ps, controller = cc, loc = cl, seq = cs, pos = cpo });

                    // Mantém o modelo de campo em dia (com o código REAL) para a IA.
                    if (pl == LOCATION_MZONE) _board.Remove((pc, ps));
                    if (cl == LOCATION_MZONE) _board[(cc, cs)] = (code, cpo);
                    // Mão e zonas de magia/armadilha do NPC (código real).
                    if (pl == LOCATION_HAND && pc <= 1) _hand[pc].Remove(code);
                    if (cl == LOCATION_HAND && cc <= 1) _hand[cc].Add(code);
                    if (pl == LOCATION_SZONE && pc <= 1 && _st[pc] > 0) _st[pc]--;
                    if (cl == LOCATION_SZONE && cc <= 1) _st[cc]++;
                    if (pl == LOCATION_SZONE && pc <= 1) _stBoard.Remove((pc, ps));
                    if (cl == LOCATION_SZONE && cc <= 1) _stBoard[(cc, cs)] = (code, cpo);
                    break;
                }
                case 53: // MSG_POS_CHANGE
                {
                    // type(1) code(4) ctrl(1) loc(1) seq(1) posAnterior(1) posAtual(1)
                    // Medido com --probe-pos; repare que o `seq` aqui tem 1 byte,
                    // ao contrário do MSG_MOVE, onde tem 4.
                    uint code = BitConverter.ToUInt32(d, o + 1) & 0x7FFFFFFF;
                    byte ctrl = d[o + 5], loc = d[o + 6], seq = d[o + 7];
                    byte anterior = d[o + 8], atual = d[o + 9];
                    // Se PASSA a ficar virada no campo do oponente, some com o código.
                    bool ocultaPos = Oculta(atual, ctrl);
                    ev.Add(new
                    {
                        type = "pos", code = ocultaPos ? 0u : code, hidden = ocultaPos,
                        controller = ctrl, loc, seq = (int)seq, pos = (int)atual, prevPos = (int)anterior,
                    });
                    if (loc == LOCATION_MZONE && _board.TryGetValue((ctrl, seq), out var antes))
                        _board[(ctrl, seq)] = (antes.code, atual);
                    // Magia/armadilha que DESVIRA (foi ativada) deixa de contar
                    // como setada — senão o NPC continuaria guardando remoção
                    // para uma carta que já está aberta. O código só chega
                    // preenchido quando ela abre, que é justamente quando passa
                    // a interessar saber QUAL é.
                    if (loc == LOCATION_SZONE && ctrl <= 1)
                    {
                        _stBoard.TryGetValue((ctrl, seq), out var antesSt);
                        _stBoard[(ctrl, seq)] = (code != 0 ? code : antesSt.code, atual);
                    }
                    break;
                }
                case 110: // MSG_ATTACK — quem ataca quem
                {
                    // atacante{ctrl(1)loc(1)seq(4)pos(4)} + alvo{...}
                    ev.Add(new
                    {
                        type = "attack",
                        atkCtrl = d[o + 1], atkLoc = d[o + 2],
                        atkSeq = BitConverter.ToInt32(d, o + 3),
                        defCtrl = d[o + 11], defLoc = d[o + 12],
                        defSeq = BitConverter.ToInt32(d, o + 13),
                        direct = d[o + 12] == 0,   // sem localização = ataque direto
                    });
                    break;
                }
                case 111: // MSG_BATTLE — o resultado do combate
                {
                    // Cada lado: loc(10) + atk(4) + def(4) + destruido(1) = 19 bytes.
                    // O motor já resolveu tudo; aqui é só para a tela contar o que houve.
                    int a = o + 1, b = a + 19;
                    ev.Add(new
                    {
                        type = "battle",
                        atkAtk = BitConverter.ToInt32(d, a + 10),
                        atkDef = BitConverter.ToInt32(d, a + 14),
                        atkDestroyed = d[a + 18] != 0,
                        defAtk = BitConverter.ToInt32(d, b + 10),
                        defDef = BitConverter.ToInt32(d, b + 14),
                        defDestroyed = d[b + 18] != 0,
                    });
                    break;
                }
                case 91: LpChange(d, o, -1, ev); break; // MSG_DAMAGE: perde LP
                case 92: LpChange(d, o, +1, ev); break; // MSG_RECOVER: ganha LP
                case 100: LpChange(d, o, -1, ev); break; // MSG_PAY_LPCOST: paga LP
                case 11: _pending = ParseIdle(d, o, mlen); break;
                case 18: _pending = ParsePlace(d, o); break;
                case 10: _pending = ParseBattle(d, o, mlen); break;
                case 19: _pending = ParsePosition(d, o, mlen); break;
                // MSG_SELECT_EFFECTYN (12) e MSG_SELECT_YESNO (13): pergunta de
                // sim/não. Ex.: Dust Tornado, após destruir, oferece "setar 1 magia/
                // armadilha da mão?". Resposta = int32 (1=sim, 0=não). O 12 traz o
                // código da carta cujo efeito é oferecido; o 13 é um sim/não puro.
                case 12: _pending = new Question { kind = "yesno", player = d[o + 1], askCode = BitConverter.ToUInt32(d, o + 2) & 0x7FFFFFFF }; break;
                case 13: _pending = new Question { kind = "yesno", player = d[o + 1] }; break;
                case 16:
                    ChainProbe?.Invoke(d, o, mlen);   // diagnóstico do layout (--probe-chain)
                    _pending = ParseSelectChain(d, o, mlen);
                    break;
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
            q.repositionable = ReadActs(d, ref p, limit, 7); // reposition — 7 bytes (seq 1 byte)!
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
                list.Add(new Act
                {
                    code = BitConverter.ToUInt32(d, p),
                    index = i,
                    controller = d[p + 4],
                    location = d[p + 5],
                    sequence = entrySize >= 10 ? BitConverter.ToInt32(d, p + 6) : d[p + 6],
                });
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
                list.Add(new Act
                {
                    code = BitConverter.ToUInt32(d, p),
                    index = i,
                    controller = d[p + 4],
                    location = d[p + 5],
                    sequence = BitConverter.ToInt32(d, p + 6),
                });
                p += ACT_ENTRY;
            }
            return list;
        }

        /// <summary>
        /// MSG_SELECT_POSITION (19): `type(1) player(1) code(4) posicoesPermitidas(1)`.
        ///
        /// A máscara diz o que o motor aceita — 0x1 ataque, 0x2 ataque virado,
        /// 0x4 defesa, 0x8 defesa virada. Uma Invocação-Ritual costuma vir com
        /// 0x5 (ataque OU defesa, ambas com a face para cima), e é justamente
        /// essa escolha que antes nunca chegava à tela.
        ///
        /// Lê defensivamente: se a mensagem for menor do que o layout supõe,
        /// devolve só ataque em vez de estourar. O `--test-ritual-pos` confere
        /// que o código lido bate com a carta invocada — é o que prova o layout.
        /// </summary>
        Question ParsePosition(byte[] d, int o, int mlen)
        {
            var q = new Question { kind = "position", player = d[o + 1] };
            if (mlen >= 7)
            {
                q.askCode = BitConverter.ToUInt32(d, o + 2) & 0x7FFFFFFF;
                q.posMask = d[o + 6];
            }
            if (q.posMask == 0) q.posMask = 0x1;   // sem máscara legível: ataque
            return q;
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
        /// <summary>
        /// SELECT_CHAIN (16). Cabeçalho de 16 bytes:
        ///   type(1) player(1) speCount(1) forced(1) hintTiming(4) hintOutro(4) count(4)
        /// e uma entrada de 23 bytes por carta ativável:
        ///   code(4) ctrl(1) loc(1) seq(4) pos(4) desc(8) flag(1).
        /// Medido com --probe-chain (Mirror Force setada + ataque do NPC). count 0 =
        /// janela sem nada para encadear. Deduzo o tamanho da entrada pelo
        /// comprimento, como no SELECT_CARD, para não desalinhar em silêncio.
        /// </summary>
        Question ParseSelectChain(byte[] d, int o, int mlen)
        {
            var q = new Question
            {
                kind = "chain",
                player = d[o + 1],
                chainForced = d[o + 3] != 0,
            };
            const int header = 16;
            int count = mlen >= 16 ? BitConverter.ToInt32(d, o + 12) : 0;
            int rest = mlen - header;
            if (count > 0 && rest >= count)
            {
                int entry = rest / count;
                for (int i = 0; i < count; i++)
                {
                    int p = o + header + i * entry;
                    if (p + 10 > o + mlen) break;
                    q.choices.Add(new Sel
                    {
                        code = BitConverter.ToUInt32(d, p),
                        controller = d[p + 4],
                        location = d[p + 5],
                        sequence = BitConverter.ToInt32(d, p + 6),
                        index = i,
                    });
                }
            }
            return q;
        }

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
                    uint rawCode = BitConverter.ToUInt32(d, p);
                    byte cc = d[p + 4], cl = d[p + 5];
                    int cseq = BitConverter.ToInt32(d, p + 6);
                    // Alvo de ataque virado do oponente: o SELECT_CARD não traz a
                    // posição, então consulto o _board (que o core mantém). Sem isto,
                    // o overlay de seleção mostrava a arte real da carta setada.
                    bool oculta = cl == LOCATION_MZONE && cc != HUMAN
                        && _board.TryGetValue((cc, cseq), out var bi) && Oculta(bi.pos, cc);
                    q.choices.Add(new Sel
                    {
                        code = oculta ? 0u : rawCode,
                        hidden = oculta,
                        index = i,
                        controller = cc,
                        location = cl,
                        sequence = cseq,
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
            // Byte de modo (medido: 0x17 00 [modo] [acc..]). modo=1 → "soma OU MAIS"
            // (ritual "nível 8 ou mais"); modo=0 → soma exata. Ignorar isto fazia
            // o ritual falhar sempre que os tributos não somavam o valor cravado.
            q.sumOverflow = d[o + 2] != 0;
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
        /// Enumera as combinações de tributos VÁLIDAS de um SELECT_SUM, chamando
        /// `aceita` para cada uma (devolve false para parar a busca). As listas são
        /// pequenas (campo + mão), então busca exaustiva basta.
        ///
        /// Dois modos, decididos pelo byte de modo do motor:
        ///   • exato    → a soma tem de bater `target` cravado.
        ///   • ou mais  → ritual ("nível 8 OU MAIS"): a soma passa de `target`, mas
        ///                sem carta dispensável — tirar a de MENOR nível já derruba
        ///                abaixo de `target` (`soma - menor &lt; target`). É a mesma
        ///                regra que o EDOPro aplica: não deixa sobrar tributo.
        /// </summary>
        static void EnumeraSomas(List<Sel> items, int target, int min, int max,
                                 bool overflow, Func<List<int>, bool> aceita)
        {
            var cur = new List<int>();   // posições em items

            int Soma() { int s = 0; foreach (int p in cur) s += Math.Max(1, items[p].param); return s; }

            bool Valida(int soma)
            {
                if (cur.Count < Math.Max(1, min)) return false;
                if (max > 0 && cur.Count > max) return false;
                if (!overflow) return soma == target;
                int menor = int.MaxValue;
                foreach (int p in cur) menor = Math.Min(menor, Math.Max(1, items[p].param));
                return soma >= target && soma - menor < target;
            }

            // devolve false = "pare tudo" (aceita pediu para encerrar).
            bool Rec(int i)
            {
                int soma = Soma();
                if (Valida(soma))
                    return aceita(cur.ConvertAll(p => items[p].index)); // achou; não estende (superset é inválido)
                if (soma >= target || i >= items.Count) return true;    // não dá para crescer útil
                if (max > 0 && cur.Count >= max) return true;

                cur.Add(i);
                if (!Rec(i + 1)) return false;
                cur.RemoveAt(cur.Count - 1);
                return Rec(i + 1);
            }
            Rec(0);
        }

        /// <summary>
        /// Há mais de uma combinação de tributos válida? Só então vale perguntar ao
        /// jogador — para uma decisão única, resolver sozinho poupa um clique.
        /// </summary>
        static bool SomaTemEscolha(Question q)
        {
            if (q.choices.Count == 0) return false;
            int achadas = 0;
            EnumeraSomas(q.choices, q.sumNeeded, q.selMin, q.selMax, q.sumOverflow,
                         _ => { achadas++; return achadas < 2; });
            return achadas >= 2;
        }

        /// <summary>Resolve o SELECT_SUM sozinho quando não há escolha interessante.</summary>
        byte[] AutoSum(Question q)
        {
            List<int> pick = null;
            EnumeraSomas(q.choices, q.sumNeeded, q.selMin, q.selMax, q.sumOverflow,
                         p => { pick = p; return false; });
            if (pick == null || pick.Count == 0)
            {
                // Nenhuma combinação válida: manda o mínimo e deixa o motor reclamar,
                // em vez de travar o duelo em silêncio.
                Log.Err($"[selectsum] nenhuma combinacao {(q.sumOverflow ? ">=" : "==")} " +
                        $"{q.sumNeeded} entre {q.choices.Count} cartas");
                pick = new List<int>();
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

        /// <summary>
        /// SELECT_BATTLECMD (10): `type(1) player(1)` + lista de ATIVÁVEIS
        /// (19 bytes cada, igual ao idle) + lista de ATACANTES (8 bytes:
        /// `code(4) ctrl(1) loc(1) seq(1) podeAtacarDireto(1)`) + 2 flags
        /// (pode ir pra Main 2, pode ir pra End Phase).
        ///
        /// Medido com `--probe-battle`. A verificação do cursor no fim é a mesma
        /// rede de segurança do idle: se sobrar diferente de 2, algum tamanho
        /// mudou e as listas saíram corrompidas.
        /// </summary>
        Question ParseBattle(byte[] d, int o, int mlen)
        {
            int limit = o + mlen;
            var q = new Question { kind = "battle", player = d[o + 1] };
            int p = o + 2;

            q.activatable = ReadActsDesc(d, ref p, limit);
            q.attackers = ReadAttackers(d, ref p, limit);

            int sobra = limit - p;
            if (sobra != 2)
            {
                Log.Err($"[battlecmd] desalinhado: sobraram {sobra} bytes (esperado 2). " +
                        $"ativ={q.activatable.Count} atk={q.attackers.Count}");
            }
            q.canMain2 = d[limit - 2] != 0;
            q.canEnd = d[limit - 1] != 0;
            return q;
        }

        /// <summary>Atacantes: entrada de 8 bytes, com a flag de ataque direto.</summary>
        static List<Act> ReadAttackers(byte[] d, ref int p, int limit)
        {
            var list = new List<Act>();
            if (p + 4 > limit) return list;
            int n = (int)BitConverter.ToUInt32(d, p); p += 4;
            for (int i = 0; i < n && p + 8 <= limit; i++)
            {
                list.Add(new Act
                {
                    code = BitConverter.ToUInt32(d, p),
                    index = i,
                    controller = d[p + 4],
                    location = d[p + 5],
                    sequence = d[p + 6],
                    canDirect = d[p + 7] != 0,
                });
                p += 8;
            }
            return list;
        }

        static byte[] I32(int v) => BitConverter.GetBytes(v);

        public void Dispose() => _s.Dispose();
    }
}

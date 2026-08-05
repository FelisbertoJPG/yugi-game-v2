using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste da LEITURA do NPC — `--test-leitura`.
    ///
    /// O NPC passou a enxergar o que um humano não veria: a mão do oponente e as
    /// cartas baixadas (monstro virado e magia/armadilha setada). Isso é uma
    /// escolha de projeto, não um bug — é o que permite medir o impacto de cada
    /// carta em vez de jogar às cegas — e vem em quatro regras:
    ///
    ///   • batalha: o monstro setado entra na conta pela DEF real, e armadilha
    ///     que pune ataque muda QUEM ataca (ou se ataca);
    ///   • isca: não gasta a negação na carta média quando ele ainda tem a boa
    ///     na mão (o golpe clássico contra bot);
    ///   • remoção: guarda o Dust Tornado para a carta que atrapalha, e mira
    ///     nela em vez da primeira zona;
    ///   • extensão: não põe o segundo corpo em campo contra um Raigeki
    ///     conhecido, nem a segunda armadilha contra um Heavy Storm.
    ///
    /// A última seção é um duelo de verdade: se os acessos de leitura não
    /// estiverem ligados no `InteractiveDuel`, todas as regras acima
    /// silenciosamente não fazem nada — nenhuma delas dá erro, elas só somem.
    /// </summary>
    public static class TestLeitura
    {
        const uint BATTLE_OX = 5053103;       // 1700/1000
        const uint GAIA = 6368038;            // Nv7 2300/2100
        const uint CELTIC = 91152256;         // 1400/1200
        const uint MYSTICAL_ELF = 15025844;   // 800/2000 — a parede setada
        const uint MYSTERY_SHELL = 18108166;  // Nv4 2000/0
        const uint MIRROR = 44095762;         // Mirror Force
        const uint SAKURETSU = 56120475;      // Sakuretsu Armor
        const uint WABOKU = 12607053;         // armadilha que nao atrapalha
        const uint DUST = 60082869;           // Dust Tornado
        const uint SOLEMN = 41420027;         // Solemn Judgment
        const uint RAIGEKI = 12580477;        // varredura de monstro
        const uint HEAVY_STORM = 19613556;    // varredura de magia/armadilha

        const int ATAQUE = 0x1, DEFESA_VIRADA = 0x8;

        static int _pass, _fail;

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== leitura: batalha (campo baixado do oponente) ===\n");
            Batalha(sa);
            Log.Info("\n=== leitura: a isca (mao do oponente x negacao) ===\n");
            Isca(sa);
            Log.Info("\n=== leitura: remocao direcionada ===\n");
            Remocao(sa);
            Log.Info("\n=== leitura: nao se estender contra varredura conhecida ===\n");
            Extensao(sa);
            Log.Info("\n=== leitura: formacao de isca (deita os outros, ataca com um) ===\n");
            FormacaoDeIsca(sa);
            Log.Info("\n=== duelo real: a leitura chega mesmo ao NPC ===\n");
            DueloReal(sa);
            Log.Info("\n=== duelo real: o motor aceita a formacao de isca ===\n");
            DueloRealIsca(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>Uma mesa completa, com tudo que o NPC agora enxerga.</summary>
        sealed class Mesa
        {
            // O campo é sempre (código, posição, sequência da zona) — a sequência
            // é o que a formação de isca usa para casar a opção do motor com a
            // zona certa. `CampoDeleAberto` é o recorte do que está com a face
            // para cima, que é o que continua medindo AMEAÇA.
            public readonly List<(uint code, int pos, int seq)> CampoDeleTodo = new();
            public readonly List<uint> MaoDele = new();
            public readonly List<uint> SetadasDele = new();
            public readonly List<(uint code, int pos, int seq)> MeuCampo = new();
            public readonly List<uint> MinhasSetadas = new();
            public int MinhasZonasSt;

            const int FACEUP = 0x1 | 0x4;
            List<(uint code, int pos, int seq)> Todo(int p) => p == 0 ? CampoDeleTodo : MeuCampo;
            List<(uint code, int pos)> Abertos(int p) =>
                Todo(p).Where(m => (m.pos & FACEUP) != 0).Select(m => (m.code, m.pos)).ToList();

            public NpcBrain Brain(DatabaseManager db) => new(db,
                fieldOf: p => Abertos(p).Select(x => x.code).ToList(),
                log: _ => { },
                handOf: p => p == 0 ? MaoDele : new List<uint>(),
                stCountOf: p => p == 0 ? SetadasDele.Count : MinhasZonasSt,
                fieldPosOf: Abertos,
                setStCountOf: p => p == 0 ? SetadasDele.Count : MinhasSetadas.Count,
                faceUpStOf: _ => new List<uint>(),
                lpOf: _ => 8000,
                todoFieldPosOf: Todo,
                setStOf: p => p == 0 ? SetadasDele : MinhasSetadas);

            public void Limpa()
            {
                CampoDeleTodo.Clear(); MaoDele.Clear();
                SetadasDele.Clear(); MeuCampo.Clear(); MinhasSetadas.Clear();
                MinhasZonasSt = 0;
            }
        }

        static InteractiveDuel.Question Batalha(params uint[] atacantes)
        {
            var q = new InteractiveDuel.Question { kind = "battle", player = 1 };
            int i = 0;
            foreach (var c in atacantes)
                q.attackers.Add(new InteractiveDuel.Act { code = c, index = i++, canDirect = false });
            return q;
        }

        // ------------------------------------------------------------------
        static void Batalha(string sa)
        {
            var db = new DatabaseManager(sa);
            var mesa = new Mesa();
            var brain = mesa.Brain(db);

            // 1. o caso que o "risco assumido" antigo nao resolvia: uma parede
            //    setada de 2000 de DEF. Antes, o setado nao entrava na conta e o
            //    Battle Ox se jogava contra ela sem ter como saber.
            mesa.Limpa();
            mesa.CampoDeleTodo.Add((MYSTICAL_ELF, DEFESA_VIRADA, 0));
            var b = brain.DecideBattle(Batalha(BATTLE_OX), 1);
            Check("NAO ataca a parede SETADA de 2000 de DEF com o Battle Ox (1700)",
                  !b.Attack && b.Why.Contains($"{MYSTICAL_ELF}"), $"(attack={b.Attack} — {b.Why})");

            // 2. e continua atacando o setado FRACO: ler o campo nao e' virar medroso
            mesa.Limpa();
            mesa.CampoDeleTodo.Add((CELTIC, DEFESA_VIRADA, 0));   // DEF 1200
            b = brain.DecideBattle(Batalha(BATTLE_OX), 1);
            Check("ATACA o setado fraco (DEF 1200 < 1700)", b.Attack, $"(attack={b.Attack} — {b.Why})");

            // 3. Mirror Force baixada + campo cheio: atacar entrega todo mundo
            mesa.Limpa();
            mesa.CampoDeleTodo.Add((CELTIC, DEFESA_VIRADA, 0));
            mesa.SetadasDele.Add(MIRROR);
            b = brain.DecideBattle(Batalha(BATTLE_OX, GAIA), 1);
            Check("com Mirror Force baixada e 2 atacantes, NAO ataca",
                  !b.Attack && b.Why.Contains($"{MIRROR}"), $"(attack={b.Attack} — {b.Why})");

            // 4. ...mas com UM monstro so' ele puxa a armadilha, em vez de travar
            //    o duelo esperando ela sumir sozinha.
            b = brain.DecideBattle(Batalha(BATTLE_OX), 1);
            Check("com Mirror Force baixada e 1 atacante, ATACA (puxa a armadilha)",
                  b.Attack, $"(attack={b.Attack} — {b.Why})");

            // 5. Sakuretsu pune o ATACANTE: o prejuizo e' 1-por-1, entao que seja
            //    com o corpo barato. Gaia (2300) e Battle Ox (1700) contra um alvo
            //    de 1200 — os dois vencem, mas so' um deles precisa morrer.
            mesa.Limpa();
            mesa.CampoDeleTodo.Add((CELTIC, DEFESA_VIRADA, 0));
            mesa.SetadasDele.Add(SAKURETSU);
            b = brain.DecideBattle(Batalha(GAIA, BATTLE_OX), 1);
            Check("com Sakuretsu baixada, ataca com o mais BARATO que ainda vence (Battle Ox)",
                  b.Attack && b.Index == 1, $"(attack={b.Attack} idx {b.Index} — {b.Why})");

            // 6. controle: sem armadilha, volta ao de sempre (o mais forte)
            mesa.SetadasDele.Clear();
            b = brain.DecideBattle(Batalha(GAIA, BATTLE_OX), 1);
            Check("sem armadilha baixada, volta a atacar com o mais forte (Gaia)",
                  b.Attack && b.Index == 0, $"(attack={b.Attack} idx {b.Index} — {b.Why})");
        }

        // ------------------------------------------------------------------
        static void Isca(string sa)
        {
            var db = new DatabaseManager(sa);
            var mesa = new Mesa();
            var brain = mesa.Brain(db);

            InteractiveDuel.Question Janela(uint gatilho, string tipo, params uint[] cartas)
            {
                var q = new InteractiveDuel.Question
                {
                    kind = "chain",
                    player = 1,
                    chainTriggerCode = gatilho,
                    chainTriggerKind = tipo,
                    chainTriggerPlayer = 0,
                };
                int i = 0;
                foreach (var c in cartas) q.choices.Add(new InteractiveDuel.Sel { code = c, index = i++ });
                return q;
            }
            int Decide(InteractiveDuel.Question q) { brain.ResetCadeia(); return brain.DecideChain(q, 1); }

            // 1. o golpe: ele invoca um 2000 (que sozinho justificaria a negacao)
            //    mas ainda tem Raigeki na mao. Gastar o Solemn agora e' cair na isca.
            mesa.Limpa();
            mesa.MaoDele.Add(RAIGEKI);
            mesa.MinhasSetadas.Add(SOLEMN);
            int idx = Decide(Janela(MYSTERY_SHELL, "summon", SOLEMN));
            Check("SEGURA a negacao: ele ainda tem Raigeki na mao (isca)", idx == -1, $"(veio idx {idx})");

            // 2. com DUAS negacoes baixadas nao ha isca que pegue: gasta uma agora
            //    e guarda a outra para o que vier.
            mesa.MinhasSetadas.Add(SOLEMN);
            idx = Decide(Janela(MYSTERY_SHELL, "summon", SOLEMN, SOLEMN));
            Check("com 2 negacoes baixadas, nega assim mesmo (guarda a outra)", idx == 0, $"(veio idx {idx})");

            // 3. o limite da regra: acima do inegociavel, nega mesmo sabendo que
            //    vem coisa pior. Deixar uma Mirror Force resolver "porque ele tem
            //    Raigeki na mao" e' perder hoje para se proteger de amanha.
            mesa.MinhasSetadas.Clear(); mesa.MinhasSetadas.Add(SOLEMN);
            idx = Decide(Janela(MIRROR, "activation", SOLEMN));
            Check("ameaca inegociavel (Mirror Force) e' negada mesmo com Raigeki na mao dele",
                  idx == 0, $"(veio idx {idx})");

            // 4. controle: sem nada na mao dele, a negacao sai normalmente
            mesa.MaoDele.Clear();
            idx = Decide(Janela(MYSTERY_SHELL, "summon", SOLEMN));
            Check("com a mao dele sem ameaca, nega o 2000 normalmente", idx == 0, $"(veio idx {idx})");
        }

        // ------------------------------------------------------------------
        static void Remocao(string sa)
        {
            var db = new DatabaseManager(sa);
            var mesa = new Mesa();
            var brain = mesa.Brain(db);

            var janela = new InteractiveDuel.Question { kind = "chain", player = 1 };
            janela.choices.Add(new InteractiveDuel.Sel { code = DUST, index = 0 });

            // 1. duas setadas, uma delas perigosa: usa, e o motivo diz em quem
            mesa.Limpa();
            mesa.SetadasDele.Add(WABOKU);
            mesa.SetadasDele.Add(MIRROR);
            brain.ResetCadeia();
            int idx = brain.DecideChain(janela, 1);
            Check("usa o Dust Tornado quando ele tem uma Mirror Force baixada",
                  idx == 0 && (brain.PorqueDaCadeia ?? "").Contains($"{MIRROR}"),
                  $"(idx {idx} — {brain.PorqueDaCadeia})");

            // 2. e MIRA nela: o criterio generico (maior ATK) daria 0 para as duas
            //    e estouraria a primeira da lista.
            var alvo = new InteractiveDuel.Question
            { kind = "selectcard", player = 1, selMin = 1, selMax = 1, selCount = 2 };
            alvo.choices.Add(new InteractiveDuel.Sel { code = WABOKU, index = 0, location = 0x8, controller = 0 });
            alvo.choices.Add(new InteractiveDuel.Sel { code = MIRROR, index = 1, location = 0x8, controller = 0 });
            var picks = brain.DecideSelect(alvo, 1);
            Check("a remocao MIRA na Mirror Force, nao na primeira zona",
                  picks.Count == 1 && picks[0] == 1, $"(veio [{string.Join(",", picks)}])");

            // 3. so' carta que nao atrapalha: guarda a remocao para a hora certa
            //    (antes, "ele tem alguma coisa setada" ja bastava para queimar)
            mesa.SetadasDele.Clear();
            mesa.SetadasDele.Add(WABOKU);
            brain.ResetCadeia();
            idx = brain.DecideChain(janela, 1);
            Check("GUARDA o Dust Tornado quando a unica setada dele e' inofensiva",
                  idx == -1, $"(veio idx {idx})");
        }

        // ------------------------------------------------------------------
        static void Extensao(string sa)
        {
            var db = new DatabaseManager(sa);
            var mesa = new Mesa();
            var brain = mesa.Brain(db);

            InteractiveDuel.Question Idle(uint[] invocaveis, uint[] setaveisSt = null)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in invocaveis) q.summonable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                i = 0;
                foreach (var c in setaveisSt ?? Array.Empty<uint>())
                    q.settableST.Add(new InteractiveDuel.Act { code = c, index = i++ });
                return q;
            }

            // 1. ele tem Raigeki na mao e eu ja tenho campo que da' conta:
            //    o segundo corpo sairia junto com o primeiro, numa carta so'.
            mesa.Limpa();
            mesa.MaoDele.Add(RAIGEKI);
            mesa.MeuCampo.Add((BATTLE_OX, ATAQUE, 0));         // 1700 meu
            mesa.CampoDeleTodo.Add((CELTIC, ATAQUE, 0));       // 1400 dele
            var p = brain.Decide(Idle(new[] { CELTIC }), 1);
            Check("NAO invoca o segundo corpo com Raigeki na mao dele",
                  p.Action != "summon" && p.Action != "setmonster", $"(veio {p.Action}: {p.Why})");

            // 2. ...mas de campo vazio ele invoca assim mesmo: a regra e' para nao
            //    dar 2-por-1, nao para ficar parado.
            mesa.MeuCampo.Clear();
            p = brain.Decide(Idle(new[] { CELTIC }), 1);
            Check("com o campo VAZIO invoca assim mesmo (a regra nao vira passividade)",
                  p.Action == "summon", $"(veio {p.Action}: {p.Why})");

            // 3. o mesmo raciocinio nas armadilhas: com Heavy Storm na mao dele,
            //    a segunda setada seria a segunda carta a sair na varredura.
            mesa.Limpa();
            mesa.MaoDele.Add(HEAVY_STORM);
            mesa.MinhasZonasSt = 1;
            p = brain.Decide(Idle(Array.Empty<uint>(), new[] { WABOKU }), 1);
            Check("NAO seta a 2a armadilha com Heavy Storm na mao dele",
                  p.Action != "setspell", $"(veio {p.Action}: {p.Why})");

            // 4. controle: sem varredura na mao dele, seta normalmente
            mesa.MaoDele.Clear();
            p = brain.Decide(Idle(Array.Empty<uint>(), new[] { WABOKU }), 1);
            Check("sem varredura na mao dele, seta a armadilha normalmente",
                  p.Action == "setspell", $"(veio {p.Action}: {p.Why})");
        }

        // ------------------------------------------------------------------
        static void FormacaoDeIsca(string sa)
        {
            var db = new DatabaseManager(sa);
            var mesa = new Mesa();
            var brain = mesa.Brain(db);

            // O idle com a lista de reposição, que é onde o motor oferece a
            // mudança de posição — e onde a `sequence` importa: é ela, e não o
            // código, que identifica a zona.
            InteractiveDuel.Question Idle(params (uint code, int seq)[] reposicionaveis)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var (c, s) in reposicionaveis)
                    q.repositionable.Add(new InteractiveDuel.Act
                    { code = c, index = i++, location = 0x4, sequence = s, controller = 1 });
                return q;
            }

            // Campo: Gaia (2300) e Battle Ox (1700) em ataque; ele tem Mirror
            // Force baixada e um Celtic (1400) em ataque. A jogada certa e' deitar
            // o Gaia e atacar so' com o Battle Ox, que ainda vence os 1400.
            mesa.Limpa();
            mesa.SetadasDele.Add(MIRROR);
            mesa.CampoDeleTodo.Add((CELTIC, ATAQUE, 0));
            mesa.MeuCampo.Add((GAIA, ATAQUE, 0));
            mesa.MeuCampo.Add((BATTLE_OX, ATAQUE, 1));

            var p = brain.Decide(Idle((GAIA, 0), (BATTLE_OX, 1)), 1);
            Check("com Mirror Force baixada, DEITA o mais forte (Gaia) e guarda a isca",
                  p.Action == "reposition" && p.Index == 0, $"(veio {p.Action} idx {p.Index}: {p.Why})");
            Check("o motivo diz quem fica de pe (o Battle Ox, que ainda vence os 1400)",
                  p.Why.Contains($"{BATTLE_OX}"), $"({p.Why})");

            // Depois de deitado, so' o Battle Ox segue em ataque: a DecideBattle
            // volta a atacar (1 atacante = puxa a armadilha pagando um corpo).
            mesa.MeuCampo.Clear();
            mesa.MeuCampo.Add((GAIA, 0x4, 0));          // deitado, face para cima
            mesa.MeuCampo.Add((BATTLE_OX, ATAQUE, 1));
            var b = brain.DecideBattle(Batalha(BATTLE_OX), 1);
            Check("na formacao pronta, ATACA com a isca (o Gaia ja esta protegido)",
                  b.Attack, $"(attack={b.Attack} — {b.Why})");
            p = brain.Decide(Idle((GAIA, 0), (BATTLE_OX, 1)), 1);
            Check("e nao fica deitando mais ninguem (so' um em ataque = formacao pronta)",
                  p.Action != "reposition", $"(veio {p.Action}: {p.Why})");

            // Controle: sem a varredora baixada, ninguem deita — a regra e'
            // resposta a uma carta conhecida, nao um tique.
            mesa.SetadasDele.Clear();
            mesa.MeuCampo.Clear();
            mesa.MeuCampo.Add((GAIA, ATAQUE, 0));
            mesa.MeuCampo.Add((BATTLE_OX, ATAQUE, 1));
            p = brain.Decide(Idle((GAIA, 0), (BATTLE_OX, 1)), 1);
            Check("sem varredora baixada, NAO deita ninguem",
                  p.Action != "reposition", $"(veio {p.Action}: {p.Why})");
        }

        // ------------------------------------------------------------------
        // Duelo real 2: a formação de isca chega até o motor.
        //
        // O comando de mudar de posição é `(indice << 16) | 2` no SELECT_IDLECMD.
        // Errar esse 2 não dá erro: o motor devolve MSG_RETRY e a jogada some.
        // Aqui o jogador seta uma Mirror Force e não faz mais nada; o NPC acumula
        // Battle Ox em ataque e tem de deitar um — e o MSG_POS_CHANGE que volta é
        // a prova de que o motor aceitou.
        // ------------------------------------------------------------------
        static void DueloRealIsca(string sa)
        {
            var jogador = new List<uint>();
            for (int i = 0; i < 20; i++) jogador.Add(MIRROR);
            for (int i = 0; i < 20; i++) jogador.Add(MYSTICAL_ELF);
            var npc = new List<uint>();
            for (int i = 0; i < 40; i++) npc.Add(BATTLE_OX);

            bool decidiuDeitar = false, motorAceitou = false, travou = false, retry = false;
            string motivo = "";

            using var duel = new InteractiveDuel(sa, jogador.ToArray(), 20250805UL, 0x1000000UL,
                                                 npc: true, npcDeck: npc.ToArray(), npcLeitura: true);
            var r = duel.Advance();

            for (int guard = 0; guard < 400 && !r.ended && !motorAceitou; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string tipo = t.GetProperty("type")?.GetValue(e) as string;
                    if (tipo == "end" && (t.GetProperty("reason")?.GetValue(e) as string) == "guard") travou = true;
                    if (tipo == "retry") retry = true;
                    if (tipo == "npc" && (t.GetProperty("action")?.GetValue(e) as string) == "reposition")
                    {
                        decidiuDeitar = true;
                        motivo = t.GetProperty("why")?.GetValue(e) as string ?? "";
                    }
                    // MSG_POS_CHANGE de um monstro do NPC para DEFESA aberta (0x4)
                    if (tipo == "pos" && decidiuDeitar
                        && Convert.ToInt32(t.GetProperty("controller")?.GetValue(e) ?? 0) == 1
                        && Convert.ToInt32(t.GetProperty("pos")?.GetValue(e) ?? 0) == 0x4)
                        motorAceitou = true;
                }

                var q = r.question;
                if (q == null) break;
                r = q.kind switch
                {
                    // O jogador so' seta a Mirror Force e passa — ela fica baixada
                    // (ele nunca ativa), que e' o cenario da regra.
                    "idle" => q.settableST.Count > 0
                        ? duel.Respond("setspell", q.settableST[0].index)
                        : duel.Respond("endturn", 0),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "chain" => duel.Respond("chain", -1),
                    "battle" => duel.Respond("endbattle", 0),
                    "selectcard" or "selecttribute" or "selectsum" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Check("o duelo nao travou em laco fechado", !travou);
            Check("o NPC decidiu deitar um monstro contra a Mirror Force baixada", decidiuDeitar);
            Check("o motor ACEITOU a mudanca de posicao (sem MSG_RETRY)", motorAceitou && !retry,
                  $"(aceitou={motorAceitou} retry={retry})");
            if (decidiuDeitar) Log.Info($"  motivo do NPC: {motivo}");
        }

        // ------------------------------------------------------------------
        // Duelo real: prova que a leitura CHEGA. O jogador seta Mystical Elf
        // (800/2000) e passa; o NPC, com Battle Ox (1700), tem de recusar o
        // ataque CITANDO a carta virada — informação que ele só pode ter porque
        // `AllMonstersPos` está ligado. Sem o encanamento, ele atacaria às cegas
        // e nenhuma regra reclamaria.
        // ------------------------------------------------------------------
        static void DueloReal(string sa)
        {
            // O MESMO duelo nos dois níveis. É a prova de que a dificuldade é
            // real e de que ela mora só no encanamento: mesma IA, mesmas cartas,
            // decisão oposta — o avançado enxerga a parede virada e recua, o
            // iniciante não tem como saber e ataca.
            var avancado = ParedeSetada(sa, leitura: true);
            Check("o duelo (avancado) nao travou em laco fechado", !avancado.travou);
            Check("NPC AVANCADO: recusa o ataque CITANDO a DEF da carta virada",
                  avancado.leuOSetado, $"(atacou as cegas? {avancado.atacou})");
            if (avancado.leuOSetado) Log.Info($"  motivo do NPC: {avancado.motivo}");

            var iniciante = ParedeSetada(sa, leitura: false);
            Check("o duelo (iniciante) nao travou em laco fechado", !iniciante.travou);
            Check("NPC INICIANTE: nao le a carta virada — ataca a parede as cegas",
                  iniciante.atacou && !iniciante.leuOSetado,
                  $"(atacou={iniciante.atacou} leu={iniciante.leuOSetado})");
        }

        static (bool leuOSetado, bool atacou, bool travou, string motivo) ParedeSetada(
            string sa, bool leitura)
        {
            var jogador = new List<uint>();
            for (int i = 0; i < 40; i++) jogador.Add(MYSTICAL_ELF);
            var npc = new List<uint>();
            for (int i = 0; i < 40; i++) npc.Add(BATTLE_OX);

            bool leuOSetado = false, travou = false, atacouAsCegas = false;
            string motivo = "";

            using var duel = new InteractiveDuel(sa, jogador.ToArray(), 4242UL, 0x1000000UL,
                                                 npc: true, npcDeck: npc.ToArray(), npcLeitura: leitura);
            var r = duel.Advance();

            for (int guard = 0; guard < 400 && !r.ended && !leuOSetado && !atacouAsCegas; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string tipo = t.GetProperty("type")?.GetValue(e) as string;
                    if (tipo == "end" && (t.GetProperty("reason")?.GetValue(e) as string) == "guard")
                        travou = true;
                    if (tipo != "npc") continue;
                    string acao = t.GetProperty("action")?.GetValue(e) as string;
                    string why = t.GetProperty("why")?.GetValue(e) as string ?? "";
                    if (acao == "endbattle" && why.Contains($"{MYSTICAL_ELF}"))
                    { leuOSetado = true; motivo = why; }
                    if (acao == "attack") { atacouAsCegas = true; motivo = why; }
                }

                var q = r.question;
                if (q == null) break;
                r = q.kind switch
                {
                    // O jogador SETA (a carta fica virada) e passa o turno.
                    "idle" => q.settable.Count > 0
                        ? duel.Respond("setmonster", q.settable[0].index)
                        : duel.Respond("endturn", 0),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "chain" => duel.Respond("chain", -1),
                    "battle" => duel.Respond("endbattle", 0),
                    "selectcard" or "selecttribute" or "selectsum" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            return (leuOSetado, atacouAsCegas, travou, motivo);
        }
    }
}

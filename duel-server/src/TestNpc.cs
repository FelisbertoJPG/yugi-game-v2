using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste das regras do NPC do Teste de Batalha — `--test-npc`.
    ///
    /// Verifica a lógica de decisão isoladamente (sem duelo), montando situações
    /// controladas, e depois roda um duelo de verdade para confirmar que o NPC
    /// realmente invoca, usa o Pote da Ganância e encerra o turno.
    /// </summary>
    public static class TestNpc
    {
        // Vanilla Nv4, ATK/DEF conhecidos e sem efeito para atrapalhar:
        const uint BATTLE_OX = 5053103;      // 1700 / 1000
        const uint MYSTICAL_ELF = 15025844;  //  800 / 2000  <- maior DEF
        const uint CELTIC = 91152256;        // 1400 / 1200
        const uint GAIA = 6368038;           // Nv7 2300 / 2100
        const uint POT = 55144522;           // Pote da Ganancia
        const uint AQUA_MADOOR = 85639257;   // 1200 / 2000  <- o caso do exemplo
        const uint GIANT_SOLDIER = 13039848; // 1300 / 2000
        const uint POLYMERIZATION = 24094653;      // fusao
        const uint FUSION_SAGE = 26902560;         // busca 1 Polymerization
        const uint BLACK_LUSTER_RITUAL = 55761792; // magia de ritual (tem TYPE_RITUAL)
        const uint MONSTER_REBORN_ID = 83764718;
        const uint GAIA_CHAMPION = 66889139;       // fusao Nv7 2600/2100
        const uint SUMMONED_SKULL_LIKE = 70781052; // Summoned Skull Nv6 2500/1200 (1 tributo)
        const uint BLACK_SKULL_DRAGON = 11901678;  // fusao Nv9 3200/2500
        const uint RED_EYES = 74677422;            // Nv7 2400/2000 (2 tributos)
        const uint WABOKU = 12607053;              // Armadilha Normal (protecao)
        const uint TIME_WIZARD = 71625222;         // moeda: varre um dos campos
        const uint TRAP_HOLE = 4206964;             // Armadilha Normal: destroi o invocado
        const uint DUST_TORNADO = 60082869;         // remocao de S/T (Armadilha Normal)
        const uint CALL_HAUNTED = 97077563;        // continua ABERTA: alvo que vale remocao
        const uint MYSTERY_SHELL_DRAGON = 18108166;// Nv4 2000/0 — ameaca que os Nv4 do NPC nao superam
        const uint DOUBLE_COSTON = 44436472;       // 1700/1650 Nv4 DARK — vale 2 tributos p/ DARK
        const uint RYU_RAN = 2964201;              // Nv7 2200/2600 — o corpo do relato: parede no papel,
                                                   // beatstick na mesa
        const uint ISLAND_TURTLE = 4042268;        // 1100/2000 — o alvo fraco do caso Aqua Madoor

        static int _pass, _fail;

        /// <summary>O jogador 0 joga simples: invoca o mais forte que puder.</summary>
        static InteractiveDuel.Result JogadaDoJogador(InteractiveDuel duel, InteractiveDuel.Question q)
        {
            if (q.summonable.Count == 0) return duel.Respond("endturn", 0);
            var gaia = q.summonable.FirstOrDefault(a => a.code == GAIA);
            int idx = gaia.code == GAIA ? gaia.index : q.summonable[0].index;
            return duel.Respond("summon", idx);
        }

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== regras do NPC (decisao isolada) ===\n");
            LogicaIsolada(sa);
            Log.Info("\n=== posicao de batalha e uso de corrente ===\n");
            PosicaoECorrente(sa);
            Log.Info("\n=== regras de batalha do NPC (decisao isolada) ===\n");
            BatalhaIsolada(sa);
            Log.Info("\n=== NPC jogando um duelo de verdade ===\n");
            DueloReal(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------
        // Decisão isolada: monta a pergunta na mão e confere a escolha.
        // ------------------------------------------------------------------
        static void LogicaIsolada(string sa)
        {
            var db = new DatabaseManager(sa);
            var campo = new List<uint>();                       // campo do oponente
            var brain = new NpcBrain(db, p => p == 0 ? campo : new List<uint>());

            InteractiveDuel.Question Idle(
                IEnumerable<uint> summonable, IEnumerable<uint> settable = null,
                IEnumerable<uint> activatable = null)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in summonable) q.summonable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                i = 0;
                foreach (var c in settable ?? Enumerable.Empty<uint>()) q.settable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                i = 0;
                foreach (var c in activatable ?? Enumerable.Empty<uint>()) q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                return q;
            }

            // regra 1 — a mão precisa ser setável também, senão o statline
            // defensivo da Mystical Elf não teria como virar Set.
            campo.Clear();
            var p = brain.Decide(Idle(new[] { CELTIC, BATTLE_OX, MYSTICAL_ELF }), 1);
            Check("regra 1: invoca o de maior ATK entre os ofensivos (Battle Ox 1700)",
                  p.Action == "summon" && p.Index == 1, $"(veio {p.Action} idx {p.Index})");

            // regra 2: oponente com ATK maior que tudo na mao
            campo.Clear(); campo.Add(GAIA);   // 2300 em campo
            p = brain.Decide(Idle(new[] { CELTIC, BATTLE_OX },
                                  settable: new[] { CELTIC, BATTLE_OX, MYSTICAL_ELF }), 1);
            Check("regra 2: com ameaca 2300, seta o de maior DEF (Mystical Elf 2000)",
                  p.Action == "setmonster" && p.Index == 2, $"(veio {p.Action} idx {p.Index})");

            // regra 2 nao dispara quando a mao supera a ameaca
            campo.Clear(); campo.Add(CELTIC);  // 1400 em campo
            p = brain.Decide(Idle(new[] { BATTLE_OX },              // 1700 > 1400
                                  settable: new[] { MYSTICAL_ELF }), 1);
            Check("sem ameaca real (1700 > 1400): volta a invocar em ataque",
                  p.Action == "summon", $"(veio {p.Action})");

            // regra 3: nivel maior tem precedencia
            campo.Clear(); campo.Add(GAIA);
            p = brain.Decide(Idle(new[] { BATTLE_OX, GAIA },
                                  settable: new[] { MYSTICAL_ELF }), 1);
            Check("regra 3: prefere a invocacao de nivel maior (Gaia Nv7)",
                  p.Action == "summon" && p.Index == 1, $"(veio {p.Action} idx {p.Index})");

            // regra 4: Pote antes de tudo
            campo.Clear(); campo.Add(GAIA);
            p = brain.Decide(Idle(new[] { BATTLE_OX, GAIA },
                                  settable: new[] { MYSTICAL_ELF },
                                  activatable: new[] { POT }), 1);
            Check("regra 4: Pote da Ganancia antes de qualquer invocacao",
                  p.Action == "activate" && p.Index == 0, $"(veio {p.Action} idx {p.Index})");

            // --- busca especifica ANTES da compra ---------------------------
            // Com Pote e Fusion Sage na mao, a busca vem primeiro: comprar antes
            // poderia trazer a propria Polymerization e deixar a Sage morta.
            campo.Clear();
            p = brain.Decide(Idle(new[] { BATTLE_OX },
                                  activatable: new[] { POT, FUSION_SAGE }), 1);
            Check("busca especifica (Fusion Sage) vem ANTES do Pote da Ganancia",
                  p.Action == "activate" && p.Index == 1, $"(veio {p.Action} idx {p.Index})");

            // Sozinho, o Pote continua sendo a primeira jogada — a nova regra nao
            // pode ter empurrado a compra para tras quando nao ha busca.
            campo.Clear();
            p = brain.Decide(Idle(new[] { BATTLE_OX }, activatable: new[] { POT }), 1);
            Check("sem busca na mao, o Pote continua vindo primeiro",
                  p.Action == "activate" && p.Index == 0, $"(veio {p.Action} idx {p.Index})");

            // A busca tambem vem antes de invocar (é jogada de Main Phase barata).
            campo.Clear();
            p = brain.Decide(Idle(new[] { GAIA, BATTLE_OX },
                                  activatable: new[] { FUSION_SAGE }), 1);
            Check("busca especifica vem antes de invocar",
                  p.Action == "activate" && p.Index == 0, $"(veio {p.Action} idx {p.Index})");

            // --- fusao, mesma logica do ritual ------------------------------
            // A Poly ganha da invocacao pelo mesmo motivo do ritual: poe corpo
            // grande em campo E enche o cemiterio para o Monster Reborn.
            campo.Clear();
            p = brain.Decide(Idle(new[] { BATTLE_OX, GAIA },
                                  activatable: new[] { POLYMERIZATION }), 1);
            Check("fusao (Polymerization) tem prioridade sobre invocar",
                  p.Action == "activate" && p.Index == 0, $"(veio {p.Action} idx {p.Index})");

            // Ritual e fusao sao do mesmo nivel; o ritual foi declarado primeiro,
            // entao ele resolve antes. O teste fixa essa ordem de propósito.
            campo.Clear();
            p = brain.Decide(Idle(new[] { BATTLE_OX },
                                  activatable: new[] { POLYMERIZATION, BLACK_LUSTER_RITUAL }), 1);
            Check("com ritual E fusao na mao, o ritual resolve primeiro",
                  p.Action == "activate" && p.Index == 1, $"(veio {p.Action} idx {p.Index})");

            // O Monster Reborn continua acima das duas: reviver e' de graca,
            // enquanto ritual/fusao gastam material.
            campo.Clear();
            p = brain.Decide(Idle(new[] { BATTLE_OX },
                                  activatable: new[] { POLYMERIZATION, MONSTER_REBORN_ID }), 1);
            Check("Monster Reborn continua acima da fusao",
                  p.Action == "activate" && p.Index == 1, $"(veio {p.Action} idx {p.Index})");

            // --- nao tributar um corpo melhor do que o que entra -------------
            // A jogada absurda observada em duelo: o NPC tinha uma FUSAO de 2600
            // em campo e tributou justamente ela para invocar um 2500.
            //
            // Repare que `campo` aqui e' o do jogador 0 e o brain decide pelo 1,
            // entao para simular o campo DO NPC precisamos de um brain proprio
            // que enxergue o lado 1.
            var meuCampo = new List<uint>();
            var brainNpc = new NpcBrain(db, p => p == 1 ? meuCampo : new List<uint>());

            meuCampo.Clear(); meuCampo.Add(GAIA_CHAMPION);   // fusao 2600 em campo
            p = brainNpc.Decide(Idle(new[] { GAIA }), 1);    // Nv7 2300, pediria 2 tributos
            Check("NAO tributa a fusao 2600 para invocar um 2300",
                  p.Action != "summon", $"(veio {p.Action} idx {p.Index})");

            // O caso limite do relato: 2500 entrando contra 2600 saindo.
            meuCampo.Clear(); meuCampo.Add(GAIA_CHAMPION);
            p = brainNpc.Decide(Idle(new[] { SUMMONED_SKULL_LIKE }), 1);
            Check("NAO tributa 2600 para invocar 2500",
                  p.Action != "summon", $"(veio {p.Action} idx {p.Index})");

            // Mas continua subindo quando a troca MELHORA o campo: dois corpos
            // fracos viram um Nv7 de 2300.
            meuCampo.Clear(); meuCampo.Add(CELTIC); meuCampo.Add(MYSTICAL_ELF); // 1400 e 800
            p = brainNpc.Decide(Idle(new[] { GAIA }), 1);
            Check("AINDA tributa quando a troca melhora (1400/800 -> Nv7 2300)",
                  p.Action == "summon", $"(veio {p.Action} idx {p.Index})");

            // Campo vazio: sem tributo visivel, confia no motor (foi ele que ofereceu).
            meuCampo.Clear();
            p = brainNpc.Decide(Idle(new[] { GAIA }), 1);
            Check("campo vazio: nao bloqueia a invocacao oferecida pelo motor",
                  p.Action == "summon", $"(veio {p.Action} idx {p.Index})");

            // O MESMO erro pela porta de trás: SETAR tambem custa tributo.
            // Relato: fusao de 3200 tributada para setar um Red-Eyes (2400/2000).
            meuCampo.Clear(); meuCampo.Add(BLACK_SKULL_DRAGON);   // fusao 3200
            p = brainNpc.Decide(Idle(Array.Empty<uint>(), settable: new[] { RED_EYES }), 1);
            Check("NAO tributa a fusao 3200 para SETAR um Red-Eyes (DEF 2000)",
                  p.Action != "setmonster", $"(veio {p.Action} idx {p.Index})");

            // E com ameaca em campo, que e' quando a regra de defesa empurraria
            // para o Set — o custo continua pesando mais.
            meuCampo.Clear(); meuCampo.Add(BLACK_SKULL_DRAGON);
            campo.Clear(); campo.Add(GAIA_CHAMPION);              // ameaca 2600 do outro lado
            p = brainNpc.Decide(Idle(Array.Empty<uint>(), settable: new[] { RED_EYES }), 1);
            Check("nem sob ameaca tributa 3200 para setar 2000 de DEF",
                  p.Action != "setmonster", $"(veio {p.Action} idx {p.Index})");
            campo.Clear();

            // Mas o Tribute Set continua valendo quando a DEF que entra supera o
            // que sai: dois corpos fracos viram uma parede de 2000.
            meuCampo.Clear(); meuCampo.Add(CELTIC); meuCampo.Add(MYSTICAL_ELF);  // 1400 e 800
            p = brainNpc.Decide(Idle(Array.Empty<uint>(), settable: new[] { RED_EYES }), 1);
            Check("AINDA seta com tributo quando a DEF supera o sacrificado (1400 -> DEF 2000)",
                  p.Action == "setmonster", $"(veio {p.Action} idx {p.Index})");

            // --- statline da propria carta decide o modo --------------------
            // O caso exato levantado: o jogador tem 1100 em campo e o NPC tem um
            // Aqua Madoor 1200/2000. Ele venceria atacando (1200 > 1100), mas o
            // statline diz que ele rende mais como parede — entao seta.
            campo.Clear(); campo.Add(4042268);         // Island Turtle, 1100 ATK
            p = brain.Decide(Idle(new[] { AQUA_MADOOR }, settable: new[] { AQUA_MADOOR }), 1);
            Check("Aqua Madoor 1200/2000 contra 1100: SETA (venceria atacando, mas e' parede)",
                  p.Action == "setmonster", $"(veio {p.Action})");

            campo.Clear(); campo.Add(GIANT_SOLDIER);   // 1300 ATK em campo
            p = brain.Decide(Idle(new[] { MYSTICAL_ELF }, settable: new[] { MYSTICAL_ELF }), 1);
            Check("Mystical Elf (800/2000) diante de 1300: seta",
                  p.Action == "setmonster",
                  $"(veio {p.Action} — DEF 2000 > ATK 800, e' parede)");

            campo.Clear();                              // campo vazio
            p = brain.Decide(Idle(new[] { MYSTICAL_ELF }, settable: new[] { MYSTICAL_ELF }), 1);
            Check("sem ameaca, parede continua sendo setada (statline manda)",
                  p.Action == "setmonster", $"(veio {p.Action})");

            campo.Clear();
            p = brain.Decide(Idle(new[] { BATTLE_OX }, settable: new[] { BATTLE_OX }), 1);
            Check("Battle Ox (1700/1000) com campo vazio: ataca",
                  p.Action == "summon", $"(veio {p.Action})");

            // ofensivo perde para a ameaca -> volta a defender
            campo.Clear(); campo.Add(GAIA);            // 2300
            p = brain.Decide(Idle(new[] { BATTLE_OX }, settable: new[] { BATTLE_OX, MYSTICAL_ELF }), 1);
            Check("atacante fraco diante de 2300: seta o de maior DEF",
                  p.Action == "setmonster" && p.Index == 1, $"(veio {p.Action} idx {p.Index})");

            // --- o campo a' vista desmente o statline -----------------------
            //
            // O relato: o NPC tributava dois corpos para SETAR um Ryu-Ran
            // (2200/2600) diante de um campo que ele atropelava inteiro — e
            // deixava de pe, do outro lado, justamente os monstros que no turno
            // seguinte viravam o tributo de algo maior que ele.
            campo.Clear(); campo.Add(MYSTERY_SHELL_DRAGON);   // 2000 em campo
            p = brain.Decide(Idle(new[] { RYU_RAN }, settable: new[] { RYU_RAN }), 1);
            Check("Ryu-Ran (2200/2600) contra 2000: INVOCA em ataque (nao seta a parede)",
                  p.Action == "summon", $"(veio {p.Action} — {p.Why})");

            // O caso do relato ao pe da letra: DOIS corpos do outro lado, os
            // dois abaixo do meu ATK. Bater derruba um deles, que e' um tributo
            // a menos para o corpo grande do turno seguinte.
            campo.Clear(); campo.Add(MYSTERY_SHELL_DRAGON); campo.Add(CELTIC);
            p = brain.Decide(Idle(new[] { RYU_RAN }, settable: new[] { RYU_RAN }), 1);
            Check("Ryu-Ran contra DOIS corpos que ele vence: bate (nega o tributo do proximo turno)",
                  p.Action == "summon", $"(veio {p.Action} — {p.Why})");

            // Campo dele vazio: o ataque direto de 2200 vale muito mais que os
            // 400 de defesa que ele deixaria na mesa.
            campo.Clear();
            p = brain.Decide(Idle(new[] { RYU_RAN }, settable: new[] { RYU_RAN }), 1);
            Check("Ryu-Ran com o campo dele vazio: entra de pe para bater direto",
                  p.Action == "summon", $"(veio {p.Action} — {p.Why})");

            // O contrario continua valendo: com 2600 do outro lado ele nao
            // supera nada de pe, e a parede volta a ser a jogada.
            campo.Clear(); campo.Add(GAIA_CHAMPION);          // 2600
            p = brain.Decide(Idle(new[] { RYU_RAN }, settable: new[] { RYU_RAN }), 1);
            Check("Ryu-Ran contra 2600: volta a SETAR (de pe seria atropelado)",
                  p.Action == "setmonster", $"(veio {p.Action} — {p.Why})");

            // --- posicao da Invocacao Especial (Regras Antigas / ritual) -----
            // O mesmo furo entrava pela porta do MSG_SELECT_POSITION: o corpo
            // grande chegava em campo DEITADO.
            campo.Clear(); campo.Add(MYSTERY_SHELL_DRAGON);
            Check("posicao: Ryu-Ran invocado especialmente contra 2000 nasce em ATAQUE",
                  brain.DecidePosicao(RYU_RAN, 0x5, 1) == 0x1,
                  $"(veio {brain.DecidePosicao(RYU_RAN, 0x5, 1):X})");

            campo.Clear(); campo.Add(GAIA_CHAMPION);
            Check("posicao: contra 2600 ele continua nascendo em DEFESA",
                  brain.DecidePosicao(RYU_RAN, 0x5, 1) == 0x4,
                  $"(veio {brain.DecidePosicao(RYU_RAN, 0x5, 1):X})");

            campo.Clear();
            Check("posicao: parede fraca (Mystical Elf 800/2000) continua deitada",
                  brain.DecidePosicao(MYSTICAL_ELF, 0x5, 1) == 0x4,
                  $"(veio {brain.DecidePosicao(MYSTICAL_ELF, 0x5, 1):X})");

            // --- LEITURA: a parede nao segura o que ele ja pode montar -------
            //
            // Aqui o ganho de bater NAO paga a defesa aberta (e' o mesmo Aqua
            // Madoor de cima, que segue setando). O que vira a decisao e' saber
            // que o corpo em campo dele ja e' o tributo de um 2500 na mao —
            // contra esse 2500 a DEF 2000 nao segura nada, e derrubar o corpo
            // agora e' o unico jeito de atrasar a jogada.
            var maoDele = new List<uint>();
            var brainLe = new NpcBrain(db, p2 => p2 == 0 ? campo : new List<uint>(),
                                       log: _ => { },
                                       handOf: p2 => p2 == 0 ? maoDele : new List<uint>());

            campo.Clear(); campo.Add(ISLAND_TURTLE);          // 1100 — o tributo dele
            maoDele.Clear(); maoDele.Add(SUMMONED_SKULL_LIKE); // Nv6 2500: 1 tributo, quebra a DEF 2000
            p = brainLe.Decide(Idle(new[] { AQUA_MADOOR }, settable: new[] { AQUA_MADOOR }), 1);
            Check("leitura: com o 2500 a um tributo de distancia, o Aqua Madoor BATE no tributo",
                  p.Action == "summon", $"(veio {p.Action} — {p.Why})");

            // Controle: a MESMA mesa, mas a mao dele nao quebra a parede. Sem
            // isso o teste acima nao provaria nada — poderia ser a regra geral.
            campo.Clear(); campo.Add(ISLAND_TURTLE);
            maoDele.Clear(); maoDele.Add(BATTLE_OX);          // 1700 < DEF 2000
            p = brainLe.Decide(Idle(new[] { AQUA_MADOOR }, settable: new[] { AQUA_MADOOR }), 1);
            Check("controle: sem nada que quebre a DEF 2000 na mao dele, o Aqua Madoor SETA",
                  p.Action == "setmonster", $"(veio {p.Action} — {p.Why})");

            // --- tributo: quem vale DOIS nao se gasta a' toa -----------------
            //
            // Double Coston (DARK), Kaiser Sea Horse (LIGHT) e os Effigy contam
            // como 2 tributos. Quem manda nisso e' o motor, que ja' devolve
            // `release = 2` na opcao — o cerebro so' precisa nao desperdicar.
            // Como esses corpos sao FRACOS de proposito (o Earth Effigy tem 100
            // de ATK), a ordem por ATK os escolhia primeiro e eles viravam
            // tributo comum de uma invocacao que qualquer monstro pagaria.
            InteractiveDuel.Question Tributo(int precisa, params (uint code, int release)[] ops)
            {
                var qq = new InteractiveDuel.Question { kind = "selecttribute", player = 1, selMin = precisa };
                int i = 0;
                foreach (var (code, rel) in ops)
                    qq.choices.Add(new InteractiveDuel.Sel { code = code, index = i++, release = (byte)rel });
                return qq;
            }

            // precisa de 1, e um corpo comum paga: o que vale dois fica.
            var escolha = brain.DecideSelect(Tributo(1, (DOUBLE_COSTON, 2), (BATTLE_OX, 1)), 1);
            Check("tributo de 1: guarda o Double Coston e paga com o corpo comum",
                  escolha.Count == 1 && escolha[0] == 1, $"(escolheu {string.Join(",", escolha)})");

            // precisa de 2 e SO' o que vale dois existe: usa ele, com uma carta so'.
            escolha = brain.DecideSelect(Tributo(2, (DOUBLE_COSTON, 2)), 1);
            Check("tributo de 2 com so' o Coston: paga com UMA carta",
                  escolha.Count == 1 && escolha[0] == 0, $"(escolheu {string.Join(",", escolha)})");

            // precisa de 2 e ha' dois corpos comuns: paga com eles, na ordem do
            // ATK, e o que vale dois continua guardado.
            escolha = brain.DecideSelect(Tributo(2, (DOUBLE_COSTON, 2), (BATTLE_OX, 1), (CELTIC, 1)), 1);
            Check("tributo de 2 com dois corpos comuns: nao encosta no Coston",
                  escolha.Count == 2 && !escolha.Contains(0),
                  $"(escolheu {string.Join(",", escolha)})");

            // mao vazia
            campo.Clear();
            p = brain.Decide(Idle(Array.Empty<uint>()), 1);
            Check("sem jogada possivel: encerra o turno", p.Action == "endturn");
        }

        // ------------------------------------------------------------------
        // Regra de batalha: monta o SELECT_BATTLECMD na mão e confere a decisão.
        // ------------------------------------------------------------------
        /// <summary>
        /// Dois relatos de duelo real, virados em teste:
        ///   1. o NPC atacou uma Mystical Elf (800/2000) DEITADA com um Battle Ox
        ///      (1700) — comparava com a ATK dela em vez da DEF;
        ///   2. o NPC gastou um Dust Tornado sobre uma magia de ritual que já
        ///      estava resolvendo, em vez de guardar para uma carta setada.
        /// </summary>
        static void PosicaoECorrente(string sa)
        {
            var db = new DatabaseManager(sa);

            // Campo do oponente COM posição, que é a informação que faltava.
            var campoPos = new List<(uint code, int pos)>();
            int setStDoOponente = 0;
            var stAbertasDoOponente = new List<uint>();
            const int ATAQUE = 0x1, DEFESA = 0x4;

            var brain = new NpcBrain(
                db,
                fieldOf: p => p == 0 ? campoPos.Select(x => x.code).ToList() : new List<uint>(),
                log: _ => { },
                handOf: null, stCountOf: null,
                fieldPosOf: p => p == 0 ? campoPos : new List<(uint, int)>(),
                setStCountOf: _ => setStDoOponente,
                faceUpStOf: _ => stAbertasDoOponente);

            InteractiveDuel.Question Batalha(params uint[] atacantes)
            {
                var q = new InteractiveDuel.Question { kind = "battle", player = 1 };
                int i = 0;
                foreach (var c in atacantes)
                    q.attackers.Add(new InteractiveDuel.Act { code = c, index = i++, canDirect = false });
                return q;
            }

            // 0. DIAGNOSTICO do relato "parou de setar armadilha": com Waboku
            //    setavel e as zonas de magia LIVRES, a regra 2 tem de disparar.
            //    Se este teste passa, a regra esta certa e o problema e' estado
            //    (zonas cheias / o motor nao oferecer), nao decisao.
            var stOcupadas = 0;
            var brainSt = new NpcBrain(
                db,
                fieldOf: p => p == 0 ? campoPos.Select(x => x.code).ToList() : new List<uint>(),
                log: _ => { },
                handOf: null,
                stCountOf: _ => stOcupadas,
                fieldPosOf: p => p == 0 ? campoPos : new List<(uint, int)>(),
                setStCountOf: _ => 0,
                faceUpStOf: _ => new List<uint>());

            InteractiveDuel.Question ComTrap(int zonas, params uint[] invocaveis)
            {
                stOcupadas = zonas;
                var qq = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in invocaveis) qq.summonable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                foreach (var c in invocaveis) qq.settable.Add(new InteractiveDuel.Act { code = c, index = 0 });
                qq.settableST.Add(new InteractiveDuel.Act { code = WABOKU, index = 0 });
                return qq;
            }

            campoPos.Clear(); campoPos.Add((GAIA, ATAQUE));    // ameaca 2300
            var ps = brainSt.Decide(ComTrap(0, MYSTICAL_ELF), 1);
            Check("com zonas livres, SETA a Waboku antes de por monstro",
                  ps.Action == "setspell", $"(veio {ps.Action})");

            // com as zonas cheias ele nao tem como setar — e' o estado, nao a regra
            ps = brainSt.Decide(ComTrap(4, MYSTICAL_ELF), 1);
            Check("com 4 zonas de magia ocupadas ele PARA de setar (regra do >=1 livre)",
                  ps.Action != "setspell", $"(veio {ps.Action})");

            // --- Mago do Tempo: a moeda -------------------------------------
            InteractiveDuel.Question ComMago(params uint[] ativaveis)
            {
                var qq = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in ativaveis) qq.activatable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                return qq;
            }

            // atras: o oponente tem 2300 e eu nao tenho campo -> arrisca
            campoPos.Clear(); campoPos.Add((GAIA, ATAQUE));
            var pm = brain.Decide(ComMago(TIME_WIZARD), 1);
            Check("ARRISCA a moeda quando esta atras",
                  pm.Action == "activate", $"(veio {pm.Action} — {pm.Why})");

            // oponente sem monstro: cara nao destroi nada -> nao arrisca
            campoPos.Clear();
            pm = brain.Decide(ComMago(TIME_WIZARD), 1);
            Check("NAO arrisca com o oponente sem monstro",
                  pm.Action != "activate", $"(veio {pm.Action} — {pm.Why})");

            // fusao pronta na mao -> material vale mais que a moeda
            campoPos.Clear(); campoPos.Add((GAIA, ATAQUE));
            pm = brain.Decide(ComMago(TIME_WIZARD, POLYMERIZATION), 1);
            Check("NAO arrisca a moeda tendo fusao pronta (usa a fusao)",
                  pm.Action == "activate" && pm.Why.StartsWith("Fusao"),
                  $"(veio {pm.Action} — {pm.Why})");

            // DIAGNOSTICO: com ameaca em campo e o Mago do Tempo NA MAO,
            // o NPC chega a invoca-lo? O efeito dele e' LOCATION_MZONE, entao
            // sem estar em campo a regra da moeda nunca tem chance de rodar.
            InteractiveDuel.Question IdleLocal(uint[] invoc, uint[] setav = null)
            {
                var qq = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in invoc) qq.summonable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                i = 0;
                foreach (var c in setav ?? Array.Empty<uint>())
                    qq.settable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                return qq;
            }

            // Relato de duelo: o NPC SETAVA o Mago do Tempo (500/400) como parede
            // tres turnos seguidos. Setado ele fica VIRADO, e carta virada nao
            // ativa efeito — a moeda nunca tinha chance de acontecer.
            campoPos.Clear(); campoPos.Add((GAIA, ATAQUE));   // ameaca 2300
            var ptw = brain.Decide(IdleLocal(new[] { TIME_WIZARD },
                                             new[] { TIME_WIZARD, MYSTICAL_ELF }), 1);
            Check("estando atras, INVOCA o Mago do Tempo (nao seta)",
                  ptw.Action == "summon", $"(veio {ptw.Action} — {ptw.Why})");

            // E nunca o usa como parede, nem quando ha outra opcao de defesa.
            campoPos.Clear(); campoPos.Add((GAIA, ATAQUE));
            ptw = brain.Decide(IdleLocal(Array.Empty<uint>(), new[] { TIME_WIZARD }), 1);
            Check("NUNCA seta o Mago do Tempo como parede",
                  ptw.Action != "setmonster", $"(veio {ptw.Action} — {ptw.Why})");

            // Sem ameaca, a regra nao atrapalha: continua invocando o melhor ATK.
            campoPos.Clear();
            ptw = brain.Decide(IdleLocal(new[] { TIME_WIZARD, BATTLE_OX }), 1);
            Check("sem ameaca, continua invocando o de maior ATK (Battle Ox)",
                  ptw.Action == "summon" && ptw.Index == 1, $"(veio {ptw.Action} idx {ptw.Index})");

            // 1. o caso relatado: parede deitada de 2000 DEF
            campoPos.Clear(); campoPos.Add((MYSTICAL_ELF, DEFESA));   // 800/2000 em DEFESA
            var b = brain.DecideBattle(Batalha(BATTLE_OX), 1);        // 1700 de ATK
            Check("NAO ataca a Mystical Elf deitada (DEF 2000) com o Battle Ox (1700)",
                  !b.Attack, $"(veio attack={b.Attack} — {b.Why})");

            // a MESMA carta em ataque vale 800: aí o ataque e' correto
            campoPos.Clear(); campoPos.Add((MYSTICAL_ELF, ATAQUE));
            b = brain.DecideBattle(Batalha(BATTLE_OX), 1);
            Check("ATACA a mesma Elfa quando ela esta em ATAQUE (vale 800)",
                  b.Attack, $"(veio attack={b.Attack} — {b.Why})");

            // parede que da' para vencer continua sendo alvo
            campoPos.Clear(); campoPos.Add((CELTIC, DEFESA));         // 1400/1200 deitado
            b = brain.DecideBattle(Batalha(BATTLE_OX), 1);
            Check("ataca parede fraca deitada (DEF 1200 < 1700)",
                  b.Attack, $"(veio attack={b.Attack} — {b.Why})");

            // com varios alvos, basta UM que eu venca
            campoPos.Clear();
            campoPos.Add((MYSTICAL_ELF, DEFESA));   // vale 2000
            campoPos.Add((CELTIC, DEFESA));         // vale 1200
            b = brain.DecideBattle(Batalha(BATTLE_OX), 1);
            Check("com um alvo vencivel entre varios, ataca",
                  b.Attack, $"(veio attack={b.Attack} — {b.Why})");

            // 2. Dust Tornado: sem carta setada do outro lado, GUARDA
            var chain = new InteractiveDuel.Question { kind = "chain", player = 1 };
            chain.choices.Add(new InteractiveDuel.Sel { code = DUST_TORNADO, index = 0 });
            setStDoOponente = 0;
            brain.ResetCadeia();
            int idx = brain.DecideChain(chain, 1);
            Check("NAO queima o Dust Tornado sem carta setada do oponente",
                  idx == -1, $"(veio idx {idx})");

            // com carta setada, usa
            setStDoOponente = 1;
            brain.ResetCadeia();
            idx = brain.DecideChain(chain, 1);
            Check("USA o Dust Tornado quando o oponente tem carta setada",
                  idx == 0, $"(veio idx {idx})");

            // armadilha que nao e' remocao de S/T continua sendo ativada na hora
            var chain2 = new InteractiveDuel.Question { kind = "chain", player = 1 };
            chain2.choices.Add(new InteractiveDuel.Sel { code = 44095762, index = 0 }); // Mirror Force
            setStDoOponente = 0;
            brain.ResetCadeia();
            idx = brain.DecideChain(chain2, 1);
            Check("Mirror Force continua sendo ativada na corrente",
                  idx == 0, $"(veio idx {idx})");

            // 4. UMA carta por cadeia. Relato: numa Invocacao-Normal o NPC ativava
            //    DOIS Trap Hole seguidos — o primeiro ja destroi o monstro, o
            //    segundo resolve sem alvo e vai para o lixo.
            var trapHoles = new InteractiveDuel.Question { kind = "chain", player = 1 };
            trapHoles.choices.Add(new InteractiveDuel.Sel { code = TRAP_HOLE, index = 0 });
            trapHoles.choices.Add(new InteractiveDuel.Sel { code = TRAP_HOLE, index = 1 });

            brain.ResetCadeia();
            int primeiro = brain.DecideChain(trapHoles, 1);
            Check("o primeiro Trap Hole e' ativado", primeiro == 0, $"(veio idx {primeiro})");

            // segunda janela da MESMA cadeia: o motor pergunta de novo
            int segundo = brain.DecideChain(trapHoles, 1);
            Check("o SEGUNDO Trap Hole nao e' gasto na mesma cadeia",
                  segundo == -1, $"(veio idx {segundo})");

            // cadeia nova (o host avisa): volta a poder encadear
            brain.ResetCadeia();
            int novaCadeia = brain.DecideChain(trapHoles, 1);
            Check("numa cadeia NOVA ele volta a ativar",
                  novaCadeia == 0, $"(veio idx {novaCadeia})");

            // se o motor OBRIGAR (chainForced), a regra sai da frente
            brain.ResetCadeia();
            brain.DecideChain(trapHoles, 1);
            trapHoles.chainForced = true;
            int forcado = brain.DecideChain(trapHoles, 1);
            Check("com chainForced ele ativa mesmo ja tendo encadeado",
                  forcado == 0, $"(veio idx {forcado})");
            trapHoles.chainForced = false;
            brain.ResetCadeia();

            // 3. Call of the Haunted ABERTA vale a remocao mesmo sem carta setada:
            //    destrui-la leva junto o monstro que ela reviveu (2-por-1).
            setStDoOponente = 0;
            stAbertasDoOponente.Clear(); stAbertasDoOponente.Add(CALL_HAUNTED);
            brain.ResetCadeia();
            idx = brain.DecideChain(chain, 1);
            Check("USA o Dust Tornado no Call of the Haunted aberto (leva o monstro junto)",
                  idx == 0, $"(veio idx {idx})");

            // ...mas uma continua qualquer nao justifica: so' o que SUSTENTA algo.
            stAbertasDoOponente.Clear(); stAbertasDoOponente.Add(55144522); // Pote (magia normal)
            brain.ResetCadeia();
            idx = brain.DecideChain(chain, 1);
            Check("NAO gasta a remocao numa magia comum aberta",
                  idx == -1, $"(veio idx {idx})");
            stAbertasDoOponente.Clear();
        }

        static void BatalhaIsolada(string sa)
        {
            var db = new DatabaseManager(sa);
            var campo = new List<uint>();                       // campo do oponente (jogador 0)
            var brain = new NpcBrain(db, p => p == 0 ? campo : new List<uint>());

            InteractiveDuel.Question Battle(IEnumerable<(uint code, bool direct)> atacantes)
            {
                var q = new InteractiveDuel.Question { kind = "battle", player = 1 };
                int i = 0;
                foreach (var (code, direct) in atacantes)
                    q.attackers.Add(new InteractiveDuel.Act { code = code, index = i++, canDirect = direct });
                return q;
            }

            // campo vazio: ataque direto, com o de maior ATK
            campo.Clear();
            var b = brain.DecideBattle(Battle(new[] { (CELTIC, true), (BATTLE_OX, true) }), 1);
            Check("battle: campo vazio -> ataque direto com o de maior ATK (Battle Ox idx 1)",
                  b.Attack && b.Index == 1, $"(veio attack={b.Attack} idx {b.Index})");

            // oponente com monstro fraco: ataca (1700 > 1400)
            campo.Clear(); campo.Add(CELTIC);                   // 1400
            b = brain.DecideBattle(Battle(new[] { (BATTLE_OX, false) }), 1);
            Check("battle: 1700 supera o 1400 do oponente -> ataca", b.Attack, $"(veio {b.Attack})");

            // oponente com monstro forte: nao entrega o monstro
            campo.Clear(); campo.Add(GAIA);                     // 2300
            b = brain.DecideBattle(Battle(new[] { (BATTLE_OX, false) }), 1);
            Check("battle: 1700 nao supera 2300 -> encerra o combate", !b.Attack, $"(veio {b.Attack})");

            // dois atacantes, escolhe o maior que ainda supera a ameaca
            campo.Clear(); campo.Add(CELTIC);                   // 1400
            b = brain.DecideBattle(Battle(new[] { (MYSTICAL_ELF, false), (BATTLE_OX, false) }), 1);
            Check("battle: com ameaca 1400, ataca com o Battle Ox (1700, idx 1)",
                  b.Attack && b.Index == 1, $"(veio attack={b.Attack} idx {b.Index})");

            // sem atacantes: nada a fazer
            campo.Clear();
            b = brain.DecideBattle(Battle(Array.Empty<(uint, bool)>()), 1);
            Check("battle: sem atacantes -> nao ataca", !b.Attack);
        }

        // ------------------------------------------------------------------
        // Duelo real: o NPC precisa jogar sozinho enquanto passamos os turnos.
        // ------------------------------------------------------------------
        static void DueloReal(string sa)
        {
            // Deck do NPC: Pote + um Nv7 + beaters Nv4.
            var deckNpc = new List<uint>();
            for (int i = 0; i < 6; i++) deckNpc.Add(POT);
            for (int i = 0; i < 3; i++) deckNpc.Add(GAIA);
            uint[] lv4 = { BATTLE_OX, MYSTICAL_ELF, CELTIC };
            while (deckNpc.Count < 40) deckNpc.Add(lv4[deckNpc.Count % lv4.Length]);

            // Deck do JOGADOR: só Nv4 de 2000 ATK. Isto é deliberado — a regra 2
            // exige uma ameaça que o NPC não supere, e antes os dois lados usavam
            // o MESMO deck: bastava o NPC abrir bem para ele nunca ficar em
            // desvantagem e a regra jamais disparar. Com 2000 do outro lado e no
            // máximo 1700 entre os Nv4 dele, a ameaça é garantida sem depender
            // de sorte de compra.
            var deckJogador = new List<uint>();
            while (deckJogador.Count < 40) deckJogador.Add(MYSTERY_SHELL_DRAGON);

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), 13579UL, 0x1000000UL,
                                                 npc: true, npcDeck: deckNpc.ToArray());
            var r = duel.Advance();

            var acoes = new List<string>();

            void Colher(InteractiveDuel.Result res)
            {
                foreach (var e in res.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "npc") continue;
                    string act = t.GetProperty("action")?.GetValue(e) as string;
                    string why = t.GetProperty("why")?.GetValue(e) as string;
                    acoes.Add(act);
                    Log.Info($"  NPC: {act}  ({why})");
                }
            }

            int guard = 0;
            while (!r.ended && guard++ < 120)
            {
                Colher(r);
                var q = r.question;
                if (q == null) break;

                // O jogador 0 invoca o mais forte que puder — sem uma ameaça em
                // campo a regra 2 nunca teria como disparar.
                r = q.kind switch
                {
                    "idle" => JogadaDoJogador(duel, q),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "battle" => duel.Respond("endbattle", 0),
                    _ => duel.Respond("endturn", 0),
                };
                // Segue até a regra 2 aparecer: ela só pode disparar depois que o
                // jogador acumular tributos e invocar algo mais forte, o que leva
                // alguns turnos.
                if (acoes.Contains("setmonster") && acoes.Contains("activate")) break;
            }
            Colher(r);   // o último resultado também conta

            Log.Info($"\n  acoes do NPC: [{string.Join(", ", acoes)}]");
            Check("o duelo nao travou em laco fechado",
                  !r.events.Any(e => (e.GetType().GetProperty("reason")?.GetValue(e) as string) == "guard"));
            Check("regra 2 disparou num duelo real (setou em defesa sob ameaca)",
                  acoes.Contains("setmonster"),
                  "(o jogador precisa ter posto um monstro mais forte em campo)");
            Check("o NPC jogou (nao ficou so passando o turno)",
                  acoes.Any(a => a is "summon" or "setmonster"),
                  $"(acoes: {string.Join(",", acoes)})");
            Check("o NPC usou o Pote da Ganancia", acoes.Contains("activate"),
                  "(nao apareceu 'activate')");
        }
    }
}

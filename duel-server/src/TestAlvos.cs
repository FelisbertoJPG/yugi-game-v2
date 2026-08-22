using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **De QUEM é a carta que o NPC escolheu** — `--test-alvos`.
    ///
    /// Três erros do mesmo relato de duelo, e os três erram CALADOS: o motor
    /// aceita a resposta, o duelo continua, e só quem está jogando percebe que
    /// o adversário se sabotou.
    ///
    ///   1. **Remoção mirando o próprio campo.** O `DecideSelect` genérico
    ///      ordenava os alvos por ATK sem perguntar de quem era a carta. O
    ///      Inseto Devorador de Homens (Man-Eater Bug) virou com dois monstros
    ///      do jogador de pé do outro lado e destruiu o inseto do PRÓPRIO
    ///      Wevil — que estava com o maior ATK da mesa justamente porque ele
    ///      acabara de equipá-lo.
    ///
    ///   2. **Equipamento num monstro DEITADO.** A tabela só guardava o bônus
    ///      de ATK, e a regra nunca olhava a posição do alvo. Um equipamento do
    ///      ciclo por atributo (+400 ATK / −200 DEF) num monstro em defesa não
    ///      reforça nada: tira 200 do único número que aquela batalha vai usar.
    ///
    ///   3. **Posição decidida sem contar o equipamento da mão.** A posição é
    ///      escolhida ANTES de a regra do equipamento rodar, e a regra do
    ///      equipamento só reforça quem está de pé — então o corpo entrava
    ///      deitado e o reforço que estava reservado para ele nunca chegava.
    ///      No relato: o inseto entrou em DEFESA, ganhou o equipamento assim
    ///      mesmo, e ficou com ATK maior que o do monstro do jogador (número
    ///      que a batalha nem usou) e DEF abaixo do ATK dele.
    ///
    /// De quebra, o custo da Insect Imitation: ele chega como
    /// `MSG_SELECT_CARD` (é `Duel.SelectReleaseGroupCost`), não como
    /// `MSG_SELECT_TRIBUTE`, então caía na mesma regra genérica de "o mais
    /// forte" — e ela tributava o MAIOR monstro do campo. O comentário da regra
    /// 5.4 sempre disse o contrário.
    ///
    /// Cada caso tem par CONTROLE: sem ele, "não equipou" e "não ativou" não
    /// provariam nada — bastaria a regra ter parado de funcionar.
    /// </summary>
    public static class TestAlvos
    {
        // Monstros — vanilla, para o statline ser previsível.
        const uint BASIC_INSECT = 89091579;  // Inseto / TERRA — Nv2  500/700
        const uint BATTLE_OX    = 5053103;   // Besta-Guerreira / TERRA — Nv4 1700/1000
        const uint GEMINI_ELF   = 69140098;  // Mago / TERRA  — Nv4 1900/900
        const uint MYSTICAL_ELF = 15025844;  // Mago / LUZ    — Nv4  800/2000
        const uint MAN_EATER_BUG = 54652250; // Inseto / TERRA — Nv2 450/600, efeito de VIRAR

        // Equipamentos, escolhidos pelo que fazem com a DEF.
        const uint INVIGORATION = 98374133;  // +400 ATK / −200 DEF, TERRA
        const uint LASER_ARMOR  = 77007920;  // +300 ATK / +300 DEF, Inseto
        const uint INSECT_ARMOR = 3492538;   // +700 ATK /    0 DEF, Inseto

        const uint INSECT_IMITATION = 96965364;
        const uint PETIT_MOTH = 58192742;    // Inseto / TERRA — Nv1 300/200 (o do jogador)

        const int POS_ATAQUE = 0x1, POS_DEFESA = 0x4;
        const byte MZONE = 0x4;

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== Remocao: de quem e' o alvo (decisao isolada) ===\n");
            AlvoDaRemocao(sa);
            Log.Info("\n=== Equipamento: a posicao do alvo (decisao isolada) ===\n");
            EquipEPosicao(sa);
            Log.Info("\n=== Posicao de entrada conta o equipamento da mao ===\n");
            PosicaoContaOEquip(sa);
            Log.Info("\n=== Insect Imitation: o corpo que sai ===\n");
            CustoDaImitation(sa);
            Log.Info("\n=== Duelo real: a armadura vai no inseto de QUEM ===\n");
            DueloDaArmadura(sa);
            Log.Info("\n=== Duelo real: o Inseto Devorador vira e escolhe ===\n");
            DueloDoDevorador(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------- fixture
        //
        // O NPC é sempre o jogador 1; o humano, o 0. `meuCampo`/`campoDele` são
        // listas de (código, posição), porque metade destes testes é justamente
        // sobre a POSIÇÃO — o campo montado só com códigos não separaria nada.

        sealed class Mesa
        {
            public readonly List<(uint code, int pos, int seq)> Meu = new();
            public readonly List<(uint code, int pos, int seq)> Dele = new();
            public readonly List<uint> MinhaMao = new();
            public NpcBrain Brain;

            public List<(uint code, int pos, int seq)> De(int p) => p == 1 ? Meu : Dele;

            public void Por(int p, params (uint code, int pos)[] cartas)
            {
                var alvo = De(p);
                alvo.Clear();
                for (int i = 0; i < cartas.Length; i++)
                    alvo.Add((cartas[i].code, cartas[i].pos, i));
            }
        }

        static Mesa NovaMesa(DatabaseManager db)
        {
            var m = new Mesa();
            m.Brain = new NpcBrain(db,
                fieldOf: p => m.De(p).Select(c => c.code).ToList(),
                log: s => Log.Info($"    [npc] {s}"),
                handOf: p => p == 1 ? m.MinhaMao : new List<uint>(),
                todoFieldPosOf: p => m.De(p));
            return m;
        }

        static InteractiveDuel.Question Idle(params uint[] ativaveis)
        {
            var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
            for (int i = 0; i < ativaveis.Length; i++)
                q.activatable.Add(new InteractiveDuel.Act { code = ativaveis[i], index = i });
            return q;
        }

        /// <summary>Uma seleção de cartas EM CAMPO, com o dono de cada uma — que
        /// é a informação que faltava ser lida.</summary>
        static InteractiveDuel.Question EmCampo(int min, params (uint code, byte dono, int seq)[] opcoes)
        {
            var q = new InteractiveDuel.Question { kind = "selectcard", player = 1, selMin = min, selMax = min };
            for (int i = 0; i < opcoes.Length; i++)
                q.choices.Add(new InteractiveDuel.Sel
                {
                    code = opcoes[i].code,
                    index = i,
                    location = MZONE,
                    controller = opcoes[i].dono,
                    sequence = opcoes[i].seq,
                });
            return q;
        }

        // --------------------------------------------------------- 1. remoção
        static void AlvoDaRemocao(string sa)
        {
            using var db = new DatabaseManager(sa);
            var m = NovaMesa(db);

            // O campo do relato: o inseto do NPC é o MAIOR ATK da mesa (ele
            // acabou de equipá-lo), e o jogador tem dois corpos de pé.
            m.Por(1, (BASIC_INSECT, POS_ATAQUE));
            m.Por(0, (BATTLE_OX, POS_ATAQUE), (MYSTICAL_ELF, POS_ATAQUE));

            // O Man-Eater Bug oferece os dois lados (`LOCATION_MZONE,
            // LOCATION_MZONE` no `SelectTarget` do Lua). O inseto do NPC entra na
            // lista com 2400 — é ele que o critério de "maior ATK" levava.
            var q = EmCampo(1,
                (GEMINI_ELF, 1, 0),      // meu, 1900 — o maior ATK da mesa
                (BATTLE_OX, 0, 0),       // dele, 1700
                (MYSTICAL_ELF, 0, 1));   // dele,  800
            m.Por(1, (GEMINI_ELF, POS_ATAQUE));
            var esc = m.Brain.DecideSelect(q, 1);
            Check("nao destroi o proprio monstro, mesmo sendo o maior ATK da mesa",
                  esc.Count == 1 && esc[0] != 0, $"(escolheu indice {string.Join(",", esc)})");
            Check("mira o corpo mais perigoso do OUTRO lado (Battle Ox, 1700)",
                  esc.Count == 1 && esc[0] == 1, $"(escolheu indice {string.Join(",", esc)})");

            // A ordem é pelo numero que a BATALHA usa: o Battle Ox DEITADO vale a
            // DEF (1000), e ai' quem ameaca de verdade e' a Mystical Elf... nao —
            // deitada ela vale 2000. E' esse o ponto: posicao muda quem e' o
            // alvo, e o SELECT_CARD nao carrega posicao nenhuma.
            m.Por(0, (BATTLE_OX, POS_DEFESA), (MYSTICAL_ELF, POS_DEFESA));
            esc = m.Brain.DecideSelect(q, 1);
            Check("deitados, mede pela DEF: tira a parede de 2000, nao o Ox de 1000",
                  esc.Count == 1 && esc[0] == 2, $"(escolheu indice {string.Join(",", esc)})");

            // CONTROLE: sem carta minha na lista nao ha' o que separar — a regra
            // nao deve mudar o resultado de uma remocao que ja' so' via o outro
            // lado.
            m.Por(0, (BATTLE_OX, POS_ATAQUE), (MYSTICAL_ELF, POS_ATAQUE));
            esc = m.Brain.DecideSelect(EmCampo(1, (BATTLE_OX, 0, 0), (MYSTICAL_ELF, 0, 1)), 1);
            Check("so' com cartas dele na lista, continua levando o mais forte",
                  esc.Count == 1 && esc[0] == 0, $"(escolheu {string.Join(",", esc)})");

            // TRAVA DO TAMANHO: pedindo DUAS cartas com um alvo so' do lado dele,
            // a resposta tem de vir com duas — responder menos que o `selMin` faz
            // o core repetir a pergunta e o duelo trava sem erro nenhum.
            m.Por(0, (BATTLE_OX, POS_ATAQUE));
            esc = m.Brain.DecideSelect(EmCampo(2, (GEMINI_ELF, 1, 0), (BATTLE_OX, 0, 0)), 1);
            Check("pedindo 2 com 1 alvo dele, responde 2 mesmo assim (nao trava o duelo)",
                  esc.Count == 2, $"(veio {esc.Count} escolha(s))");
        }

        // ------------------------------------------------------- 2. equipamento
        static void EquipEPosicao(string sa)
        {
            using var db = new DatabaseManager(sa);
            var m = NovaMesa(db);

            // Inseto DEITADO. O Invigoration (+400 ATK / −200 DEF) so' tiraria
            // 200 do numero que a batalha dele usa.
            m.Por(1, (BASIC_INSECT, POS_DEFESA));
            var p = m.Brain.Decide(Idle(INVIGORATION), 1);
            Check("nao gasta o equipamento de +400 ATK / −200 DEF num monstro deitado",
                  p.Action != "activate", $"(veio {p.Action}: {p.Why})");

            // O MESMO monstro deitado, com um equipamento que sobe a DEF: agora
            // vale. E' a prova de que a regra le' a carta, e nao "nunca equipa
            // quem esta' deitado".
            p = m.Brain.Decide(Idle(LASER_ARMOR), 1);
            Check("mas equipa o de +300 ATK / +300 DEF, que reforca quem esta' deitado",
                  p.Action == "activate", $"(veio {p.Action}: {p.Why})");

            // CONTROLE: o mesmo inseto DE PE' — o +400 tem de sair.
            m.Por(1, (BASIC_INSECT, POS_ATAQUE));
            p = m.Brain.Decide(Idle(INVIGORATION), 1);
            Check("de pe', o mesmo equipamento de +400 e' ativado",
                  p.Action == "activate", $"(veio {p.Action}: {p.Why})");

            // O ALVO. Dois monstros meus: o grande deitado, o pequeno de pe'.
            // O criterio antigo (maior ATK impresso) escolheria o Gemini Elf
            // deitado — para quem os +400 de ATK nao valem nada.
            m.Por(1, (GEMINI_ELF, POS_DEFESA), (BASIC_INSECT, POS_ATAQUE));
            p = m.Brain.Decide(Idle(INVIGORATION), 1);
            Check("com um grande deitado e um pequeno de pe', ainda ativa",
                  p.Action == "activate", $"(veio {p.Action}: {p.Why})");
            var esc = m.Brain.DecideSelect(
                EmCampo(1, (GEMINI_ELF, 1, 0), (BASIC_INSECT, 1, 1)), 1);
            Check("e equipa em quem esta' DE PE', nao no de maior ATK impresso",
                  esc.Count == 1 && esc[0] == 1, $"(escolheu indice {string.Join(",", esc)})");

            // Sem nenhum alvo que renda, a carta fica na mao para quando houver
            // atacante — nao e' desperdicada.
            m.Por(1, (GEMINI_ELF, POS_DEFESA));
            p = m.Brain.Decide(Idle(INVIGORATION), 1);
            Check("so' com alvo deitado, guarda a carta em vez de gasta-la",
                  p.Action != "activate", $"(veio {p.Action}: {p.Why})");
        }

        // ---------------------------------------------------------- 3. posição
        static void PosicaoContaOEquip(string sa)
        {
            using var db = new DatabaseManager(sa);
            var m = NovaMesa(db);
            const byte MASCARA = 0x1 | 0x4;   // o motor aceita ataque e defesa aberta

            // Basic Insect 500/700 diante de uma Mystical Elf de 800 de pe':
            // ATK < DEF e o ATK nao supera a ameaca — deita, e esta' certo.
            m.Por(0, (MYSTICAL_ELF, POS_ATAQUE));
            m.Por(1);
            m.MinhaMao.Clear();
            int pos = m.Brain.DecidePosicao(BASIC_INSECT, MASCARA, 1);
            Check("CONTROLE: sem equipamento na mao, o 500/700 entra em DEFESA",
                  pos == POS_DEFESA, $"(veio 0x{pos:x})");

            // Com o Insect Armor with Laser Cannon (+700 ATK) na mao, o mesmo
            // corpo vale 1200/700 — ATK > DEF, e ele atropela os 800 dela.
            m.MinhaMao.Add(INSECT_ARMOR);
            pos = m.Brain.DecidePosicao(BASIC_INSECT, MASCARA, 1);
            Check("com o equipamento de +700 na mao, o mesmo corpo entra em ATAQUE",
                  pos == POS_ATAQUE, $"(veio 0x{pos:x})");

            // E o equipamento que nao serve nele nao entra na conta: o
            // Invigoration e' TERRA e serve, mas o Cyber Shield (Alado) nao —
            // usar o bonus de um equipamento que o Lua recusaria seria decidir
            // pela posicao com um numero que nunca vai existir.
            m.MinhaMao.Clear();
            m.MinhaMao.Add(63224564);   // Cyber Shield: so' Alado
            pos = m.Brain.DecidePosicao(BASIC_INSECT, MASCARA, 1);
            Check("equipamento que nao serve no corpo nao entra na conta da posicao",
                  pos == POS_DEFESA, $"(veio 0x{pos:x})");
        }

        // ------------------------------------------------- 4. custo da Imitation
        static void CustoDaImitation(string sa)
        {
            using var db = new DatabaseManager(sa);
            var m = NovaMesa(db);

            // Dois corpos meus. O custo tem de sair do mais BARATO.
            m.Por(1, (GEMINI_ELF, POS_ATAQUE), (BASIC_INSECT, POS_ATAQUE));
            m.Por(0);
            var p = m.Brain.Decide(Idle(INSECT_IMITATION), 1);
            Check("com dois corpos, ativa a Insect Imitation",
                  p.Action == "activate", $"(veio {p.Action}: {p.Why})");
            var esc = m.Brain.DecideSelect(
                EmCampo(1, (GEMINI_ELF, 1, 0), (BASIC_INSECT, 1, 1)), 1);
            Check("e paga com o corpo mais barato (o 500), nao com o de 1900",
                  esc.Count == 1 && esc[0] == 1, $"(escolheu indice {string.Join(",", esc)})");

            // O corpo unico que ja' segura a ameaca nao vira custo: quem vem do
            // deck e' um Inseto de nivel +1, nao um mais FORTE.
            m.Por(1, (GEMINI_ELF, POS_ATAQUE));
            m.Por(0, (BATTLE_OX, POS_ATAQUE));    // 1700 < 1900: o meu segura
            p = m.Brain.Decide(Idle(INSECT_IMITATION), 1);
            Check("nao tributa o unico corpo que ja' segura a ameaca",
                  p.Action != "activate", $"(veio {p.Action}: {p.Why})");

            // CONTROLE: com a ameaca acima dele, o corpo nao esta' segurando
            // nada e a troca volta a valer.
            m.Por(0, (GEMINI_ELF, POS_ATAQUE));   // 1900 vs os meus 1900... empate nao segura
            m.Por(1, (BATTLE_OX, POS_ATAQUE));    // 1700 < 1900
            p = m.Brain.Decide(Idle(INSECT_IMITATION), 1);
            Check("CONTROLE: com a ameaca acima do meu corpo, ativa",
                  p.Action == "activate", $"(veio {p.Action}: {p.Why})");
        }

        // ------------------------------------------------------- 5. duelo real
        //
        // A decisão isolada prova a REGRA; o duelo real prova que a pergunta
        // chega até ela com os dois lados dentro e com o `controller` certo. O
        // `SELECT_CARD` é montado pelo core a partir do Lua da carta — se ele
        // chegasse com o dono trocado, as regras acima continuariam verdes e o
        // NPC voltaria a se comer em campo.
        //
        // O roteiro é o do relato, reduzido ao mínimo: o NPC só tem insetos
        // pequenos e a armadura de +700; o jogador só tem um Petit Moth (300).
        // Sem atacante, o NPC baixa os insetos virados — e o ataque do jogador
        // vira o Man-Eater Bug, que então tem de escolher um alvo com os dois
        // lados na lista.
        //
        // A segunda metade do teste foi descoberta AQUI, não no relato: o Lua do
        // Insect Armor with Laser Cannon (`AddEquipProcedure` com o jogador em
        // `nil`) aceita equipar um Inseto do OUTRO lado. O NPC equipava quatro
        // cópias no Petit Moth do jogador e o levava de 300 a 3800 de ATK, com o
        // log dizendo "+700 ATK no melhor atacante" as quatro vezes.
        static void DueloDaArmadura(string sa)
        {
            var deckJogador = new List<uint>();
            for (int i = 0; i < 40; i++) deckJogador.Add(PETIT_MOTH);

            var deckNpc = new List<uint>();
            for (int i = 0; i < 20; i++) deckNpc.Add(BASIC_INSECT);
            for (int i = 0; i < 20; i++) deckNpc.Add(INSECT_ARMOR);

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), 20260821UL, 0x1000000UL,
                                                 npc: true, npcDeck: deckNpc.ToArray(),
                                                 extra: null, npcExtra: null);
            var r = duel.Advance();

            bool reforcouODoJogador = false;
            int maiorAtkDoJogador = 0;
            var escolhidas = new List<string>();
            var mortosDoNpc = new List<uint>();

            for (int guard = 0; guard < 400 && !r.ended; guard++)
            {
                foreach (var ev in r.events)
                {
                    var t = ev.GetType();
                    string kind = t.GetProperty("type")?.GetValue(ev) as string;
                    string s = System.Text.Json.JsonSerializer.Serialize(ev);

                    if (kind == "npc" && s.Contains("\"action\":\"select\"")) escolhidas.Add(s);

                    // O ATK de verdade, vindo do motor: o reforço do NPC nunca
                    // pode aparecer num monstro do jogador (controller 0).
                    if (kind == "stats")
                    {
                        int dono = Convert.ToInt32(t.GetProperty("controller")?.GetValue(ev) ?? 0);
                        int atk = Convert.ToInt32(t.GetProperty("atk")?.GetValue(ev) ?? 0);
                        int baseAtk = Convert.ToInt32(t.GetProperty("baseAtk")?.GetValue(ev) ?? 0);
                        if (dono == 0)
                        {
                            maiorAtkDoJogador = Math.Max(maiorAtkDoJogador, atk);
                            if (atk > baseAtk) reforcouODoJogador = true;
                        }
                    }

                    // Monstro do NPC indo para o cemitério: é assim que se vê a
                    // remoção virada contra o próprio campo.
                    if (kind == "move")
                    {
                        int loc = Convert.ToInt32(t.GetProperty("loc")?.GetValue(ev) ?? 0);
                        int dono = Convert.ToInt32(t.GetProperty("controller")?.GetValue(ev) ?? 0);
                        int deOnde = Convert.ToInt32(t.GetProperty("fromLoc")?.GetValue(ev) ?? 0);
                        if (loc == 0x10 /* GRAVE */ && dono == 1 && deOnde == MZONE)
                            mortosDoNpc.Add(Convert.ToUInt32(t.GetProperty("code")?.GetValue(ev) ?? 0u));
                    }
                }
                if (escolhidas.Count >= 3) break;

                var q = r.question;
                if (q == null) break;

                r = q.kind switch
                {
                    // Corre para a batalha: é o ataque do jogador que vira o
                    // Man-Eater Bug baixado.
                    "idle" => q.canBattle ? duel.Respond("battle", 0)
                            : q.summonable.Count > 0 ? duel.Respond("summon", q.summonable[0].index)
                            : duel.Respond("endturn", 0),
                    "battle" => q.attackers.Count > 0 ? duel.Respond("attack", q.attackers[0].index)
                              : duel.Respond("endbattle", 0),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "chain" => duel.Respond("chain", -1),
                    "yesno" => duel.Respond("yesno", 1),
                    "selectcard" or "selecttribute" or "selectsum" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    "selectunselect" => q.canFinish && q.choices.Count == 0
                        ? duel.Respond("finishselect", 0)
                        : duel.Respond("pick", q.choices[0].index),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Log.Info($"  escolhas do NPC no duelo: {escolhidas.Count}");
            foreach (var e in escolhidas) Log.Info($"    {e}");
            Log.Info($"  maior ATK que o monstro do jogador chegou a ter: {maiorAtkDoJogador}");

            Check("o NPC fez alguma escolha de carta no duelo", escolhidas.Count > 0);
            Check("o NPC nunca reforcou um monstro do JOGADOR",
                  !reforcouODoJogador,
                  $"(o Petit Moth dele chegou a {maiorAtkDoJogador} de ATK)");
            Check("o Petit Moth do jogador ficou nos 300 impressos",
                  maiorAtkDoJogador <= 300, $"(chegou a {maiorAtkDoJogador})");
            Check("nenhum monstro do NPC saiu do campo por efeito dele mesmo",
                  !mortosDoNpc.Contains(BASIC_INSECT),
                  $"(foram ao cemiterio: {string.Join(", ", mortosDoNpc)})");
        }
        // O SEGUNDO duelo real: o Inseto Devorador de Homens, que é onde o
        // relato começou.
        //
        // O NPC só tem Man-Eater Bug (450/600). Diante de um Battle Ox de 1700
        // ele não tem atacante, então baixa os insetos VIRADOS — e o ataque do
        // jogador vira um deles. A partir daí a pergunta do core traz os dois
        // lados na mesma lista, com o próprio inseto do NPC dentro: é a lista
        // que ele destruía a si mesmo.
        static void DueloDoDevorador(string sa)
        {
            var deckJogador = new List<uint>();
            for (int i = 0; i < 40; i++) deckJogador.Add(BATTLE_OX);

            var deckNpc = new List<uint>();
            for (int i = 0; i < 40; i++) deckNpc.Add(MAN_EATER_BUG);

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), 777001UL, 0x1000000UL,
                                                 npc: true, npcDeck: deckNpc.ToArray(),
                                                 extra: null, npcExtra: null);
            var r = duel.Advance();

            bool virou = false;
            var escolhidas = new List<string>();
            var mortosDoNpc = new List<uint>();

            for (int guard = 0; guard < 400 && !r.ended; guard++)
            {
                foreach (var ev in r.events)
                {
                    var t = ev.GetType();
                    string kind = t.GetProperty("type")?.GetValue(ev) as string;
                    string s = System.Text.Json.JsonSerializer.Serialize(ev);
                    if (kind == "pos" && s.Contains(MAN_EATER_BUG.ToString())) virou = true;
                    if (kind == "npc" && s.Contains("\"action\":\"select\"")) escolhidas.Add(s);
                    if (kind == "move")
                    {
                        int loc = Convert.ToInt32(t.GetProperty("loc")?.GetValue(ev) ?? 0);
                        int dono = Convert.ToInt32(t.GetProperty("controller")?.GetValue(ev) ?? 0);
                        if (loc == 0x10 /* GRAVE */ && dono == 1)
                            mortosDoNpc.Add(Convert.ToUInt32(t.GetProperty("code")?.GetValue(ev) ?? 0u));
                    }
                }
                if (virou && escolhidas.Count > 0) break;

                var q = r.question;
                if (q == null) break;

                r = q.kind switch
                {
                    "idle" => q.canBattle ? duel.Respond("battle", 0)
                            : q.summonable.Count > 0 ? duel.Respond("summon", q.summonable[0].index)
                            : duel.Respond("endturn", 0),
                    "battle" => q.attackers.Count > 0 ? duel.Respond("attack", q.attackers[0].index)
                              : duel.Respond("endbattle", 0),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "chain" => duel.Respond("chain", -1),
                    "yesno" => duel.Respond("yesno", 1),
                    "selectcard" or "selecttribute" or "selectsum" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    "selectunselect" => q.canFinish && q.choices.Count == 0
                        ? duel.Respond("finishselect", 0)
                        : duel.Respond("pick", q.choices[0].index),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Log.Info($"  escolhas do NPC no duelo: {escolhidas.Count}");
            foreach (var e in escolhidas) Log.Info($"    {e}");

            Check("o Man-Eater Bug do NPC chegou a ser virado pelo ataque do jogador", virou);
            Check("virado, ele escolheu um alvo", escolhidas.Count > 0);
            Check("e o alvo foi o Battle Ox do JOGADOR, nao um inseto do proprio NPC",
                  escolhidas.Any(s => s.Contains(BATTLE_OX.ToString()))
                  && escolhidas.All(s => !s.Contains(MAN_EATER_BUG.ToString())),
                  $"({string.Join(" | ", escolhidas)})");
        }
    }
}

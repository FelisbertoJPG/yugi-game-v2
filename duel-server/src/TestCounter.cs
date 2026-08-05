using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste das ARMADILHAS DE CONTRA do NPC — `--test-counter`.
    ///
    /// Negar é a única decisão do NpcBrain que depende de saber o que ACABOU de
    /// acontecer: a janela de corrente (SELECT_CHAIN) lista só as cartas que o
    /// NPC pode ativar, nunca a invocação/magia a que elas responderiam. Esse
    /// contexto vem das mensagens anteriores (MSG_SUMMONING / MSG_CHAINING) e
    /// chega ao cérebro em `Question.chainTrigger*`.
    ///
    /// Por isso o teste tem duas metades, e as duas importam:
    ///   • decisão isolada — as regras (o que vale negar, com qual carta, a que
    ///     preço), montadas na mão;
    ///   • duelo de verdade — prova que o CONTEXTO chega mesmo. Se o offset da
    ///     mensagem estiver errado, o NPC simplesmente para de negar e nenhuma
    ///     regra acusa nada: o sintoma seria "ele nunca usa Solemn Judgment",
    ///     turnos depois e sem erro nenhum. É exatamente o tipo de falha muda
    ///     que o DUEL-TRAINING-HANDOFF descreve.
    /// </summary>
    public static class TestCounter
    {
        // as quatro de contra
        const uint SOLEMN = 41420027;   // metade dos LP: nega invocacao OU magia/armadilha
        const uint JAMMER = 77414722;   // descarta 1: nega Magia
        const uint SEVEN = 3819470;     // 1000 LP: nega Armadilha
        const uint HORN = 98069388;     // tributa 1 monstro: nega invocacao

        // gatilhos
        const uint CELTIC = 91152256;         // Nv4 1400/1200 — invocacao que nao assusta
        const uint GAIA = 6368038;            // Nv7 2300/2100 — invocacao que assusta
        const uint MYSTERY_SHELL = 18108166;  // Nv4 2000/0 — beater sem tributo
        const uint SUMMONED_SKULL = 70781052; // Nv6 2500/1200 — campo que ja supera o Gaia
        const uint MYSTICAL_ELF = 15025844;   // Nv4 800/2000 — o tributo barato
        const uint RAIGEKI = 12580477;        // magia da lista de perigo
        const uint HEAVY_STORM = 19613556;    // idem
        const uint POT = 55144522;            // magia inofensiva (nao vale negar)
        const uint MIRROR = 44095762;         // armadilha da lista de perigo
        const uint WABOKU = 12607053;         // armadilha fora da lista
        const uint TRAP_HOLE = 4206964;       // armadilha COMUM (regra antiga)

        const byte LOC_GRAVE = 0x10;

        static int _pass, _fail;

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== armadilhas de contra: decisao isolada ===\n");
            Isolado(sa);
            Log.Info("\n=== duelo real: negando uma INVOCACAO (Solemn Judgment) ===\n");
            NegaInvocacao(sa);
            Log.Info("\n=== duelo real: negando uma MAGIA (Magic Jammer x Raigeki) ===\n");
            NegaMagia(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------
        // Decisão isolada: monta a janela de corrente na mão e confere a escolha.
        // ------------------------------------------------------------------
        static void Isolado(string sa)
        {
            var db = new DatabaseManager(sa);
            var campo0 = new List<uint>();   // campo do oponente
            var campo1 = new List<uint>();   // campo do NPC
            int lp1 = 8000;

            var brain = new NpcBrain(db,
                fieldOf: p => p == 0 ? campo0 : campo1,
                log: _ => { },
                lpOf: p => p == 1 ? lp1 : 8000);

            // A janela como o motor a entrega: as MINHAS cartas ativáveis, mais o
            // contexto de quem/o que abriu a janela.
            InteractiveDuel.Question Janela(uint gatilho, string tipo, int dono, params uint[] cartas)
            {
                var q = new InteractiveDuel.Question
                {
                    kind = "chain",
                    player = 1,
                    chainTriggerCode = gatilho,
                    chainTriggerKind = tipo,
                    chainTriggerPlayer = dono,
                };
                int i = 0;
                foreach (var c in cartas) q.choices.Add(new InteractiveDuel.Sel { code = c, index = i++ });
                return q;
            }

            int Decide(InteractiveDuel.Question q) { brain.ResetCadeia(); return brain.DecideChain(q, 1); }

            // --- o que vale negar -------------------------------------------
            campo0.Clear(); campo1.Clear();
            int idx = Decide(Janela(CELTIC, "summon", 0, SOLEMN));
            Check("NAO gasta o Solemn Judgment numa invocacao de 1400", idx == -1, $"(veio idx {idx})");

            idx = Decide(Janela(GAIA, "summon", 0, SOLEMN));
            Check("NEGA a invocacao de 2300 com o Solemn Judgment", idx == 0, $"(veio idx {idx})");

            campo1.Add(SUMMONED_SKULL);   // 2500 em campo: a batalha resolve de graca
            idx = Decide(Janela(GAIA, "summon", 0, SOLEMN));
            Check("NAO nega o que meu proprio campo (2500) ja supera", idx == -1, $"(veio idx {idx})");
            campo1.Clear();

            // --- o preco ----------------------------------------------------
            lp1 = 1500;
            idx = Decide(Janela(GAIA, "summon", 0, SOLEMN));
            Check("com 1500 de LP NAO paga metade pelo Solemn (deixaria 750)", idx == -1, $"(veio idx {idx})");

            idx = Decide(Janela(MIRROR, "activation", 0, SEVEN));
            Check("com 1500 de LP NAO paga os 1000 do Seven Tools", idx == -1, $"(veio idx {idx})");
            lp1 = 8000;

            // --- a carta certa para cada gatilho (a mais barata que resolve) --
            idx = Decide(Janela(RAIGEKI, "activation", 0, SOLEMN, JAMMER));
            Check("contra magia, prefere o Magic Jammer (descarte) ao Solemn (metade dos LP)",
                  idx == 1, $"(veio idx {idx})");

            idx = Decide(Janela(MIRROR, "activation", 0, SEVEN, SOLEMN));
            Check("contra armadilha, prefere o Seven Tools (1000 LP) ao Solemn", idx == 0, $"(veio idx {idx})");

            campo1.Add(MYSTICAL_ELF);   // 800: tributo barato para o Horn
            idx = Decide(Janela(GAIA, "summon", 0, SOLEMN, HORN));
            Check("contra invocacao, prefere o Horn of Heaven (tributa 800) ao Solemn",
                  idx == 1, $"(veio idx {idx})");
            campo1.Clear();

            idx = Decide(Janela(GAIA, "summon", 0, SOLEMN, HORN));
            Check("sem monstro para tributar, o Horn sai da frente e o Solemn nega", idx == 0, $"(veio idx {idx})");

            // --- o que NAO vale negar ---------------------------------------
            idx = Decide(Janela(POT, "activation", 0, JAMMER, SOLEMN));
            Check("NAO gasta negacao num Pote da Ganancia", idx == -1, $"(veio idx {idx})");

            idx = Decide(Janela(WABOKU, "activation", 0, SEVEN, SOLEMN));
            Check("NAO gasta o Seven Tools num Waboku (fora da lista de perigo)", idx == -1, $"(veio idx {idx})");

            // --- os dois casos de "não sei" ---------------------------------
            idx = Decide(Janela(0, "", -1, SOLEMN));
            Check("sem saber o que abriu a janela, NAO nega no escuro", idx == -1, $"(veio idx {idx})");

            idx = Decide(Janela(GAIA, "summon", 1, SOLEMN));
            Check("NAO nega a propria invocacao", idx == -1, $"(veio idx {idx})");

            // --- convivência com as regras que já existiam -------------------
            idx = Decide(Janela(CELTIC, "summon", 0, TRAP_HOLE));
            Check("armadilha comum (Trap Hole) continua sendo ativada na hora", idx == 0, $"(veio idx {idx})");

            // O Trap Hole acima ja consumiu a cadeia; a negacao ainda passa por
            // cima disso, porque negar o que o oponente encadeou NAO e' o caso de
            // desperdicio que a regra de "uma carta por cadeia" existe para evitar.
            idx = brain.DecideChain(Janela(HEAVY_STORM, "activation", 0, JAMMER), 1);
            Check("a negacao fura a regra de uma carta por cadeia", idx == 0, $"(veio idx {idx})");

            idx = brain.DecideChain(Janela(CELTIC, "summon", 0, TRAP_HOLE), 1);
            Check("...mas uma armadilha comum continua barrada na mesma cadeia", idx == -1, $"(veio idx {idx})");

            // Motor obrigando (chainForced) e nenhuma regra querendo: gastar a
            // carta e' melhor que devolver -1 e travar o duelo num MSG_RETRY.
            var forcada = Janela(CELTIC, "summon", 0, SOLEMN);
            forcada.chainForced = true;
            idx = Decide(forcada);
            Check("com chainForced, ativa mesmo sem querer (nao trava o duelo)", idx == 0, $"(veio idx {idx})");
        }

        // ------------------------------------------------------------------
        // Duelo real 1: o jogador invoca um beater de 2000 e o NPC nega.
        // ------------------------------------------------------------------
        static void NegaInvocacao(string sa)
        {
            var jogador = new List<uint>();
            for (int i = 0; i < 40; i++) jogador.Add(MYSTERY_SHELL);   // 2000/0, Nv4, sem tributo

            var npc = new List<uint>();
            for (int i = 0; i < 20; i++) npc.Add(SOLEMN);
            for (int i = 0; i < 20; i++) npc.Add(MYSTICAL_ELF);

            var (negou, porque, aoCemiterio, travou) = Duelar(sa, jogador, npc,
                pararQuando: why => why.Contains("nega"),
                jogarMagia: false);

            Check("o duelo nao travou em laco fechado", !travou);
            Check("o NPC negou a invocacao com o Solemn Judgment",
                  negou && porque.Contains($"{SOLEMN}"), $"(motivo: {porque})");
            Check("o motivo cita a invocacao que ele negou",
                  porque.Contains($"{MYSTERY_SHELL}"), $"(motivo: {porque})");
            Check("o monstro invocado foi para o cemiterio (a negacao resolveu de verdade)",
                  aoCemiterio.Contains(MYSTERY_SHELL),
                  $"(cemiterio: {string.Join(",", aoCemiterio.Distinct())})");
        }

        // ------------------------------------------------------------------
        // Duelo real 2: o jogador ativa Raigeki e o NPC nega com Magic Jammer.
        // Prova o outro caminho do contexto — MSG_CHAINING, não MSG_SUMMONING.
        // ------------------------------------------------------------------
        static void NegaMagia(string sa)
        {
            var jogador = new List<uint>();
            for (int i = 0; i < 20; i++) jogador.Add(RAIGEKI);
            for (int i = 0; i < 20; i++) jogador.Add(CELTIC);

            var npc = new List<uint>();
            for (int i = 0; i < 20; i++) npc.Add(JAMMER);
            for (int i = 0; i < 20; i++) npc.Add(MYSTICAL_ELF);

            var (negou, porque, aoCemiterio, travou) = Duelar(sa, jogador, npc,
                pararQuando: why => why.Contains("nega"),
                jogarMagia: true);

            Check("o duelo nao travou em laco fechado", !travou);
            Check("o NPC negou a magia com o Magic Jammer",
                  negou && porque.Contains($"{JAMMER}"), $"(motivo: {porque})");
            Check("o motivo cita o Raigeki (o contexto do MSG_CHAINING chegou)",
                  porque.Contains($"{RAIGEKI}"), $"(motivo: {porque})");
            Check("o Magic Jammer foi mesmo ativado (chegou ao cemiterio)",
                  aoCemiterio.Contains(JAMMER),
                  $"(cemiterio: {string.Join(",", aoCemiterio.Distinct())})");
        }

        /// <summary>
        /// Roda um duelo com o jogador 0 jogando simples (invoca; se `jogarMagia`,
        /// ativa a primeira magia que puder) até o NPC fazer o que se espera.
        /// Vários seeds porque a mão inicial decide se ele tem a carta a tempo.
        /// </summary>
        static (bool negou, string porque, List<uint> cemiterio, bool travou) Duelar(
            string sa, List<uint> jogador, List<uint> npc, Func<string, bool> pararQuando,
            bool jogarMagia)
        {
            bool negou = false, travou = false;
            string porque = "";
            var cemiterio = new List<uint>();

            foreach (ulong seed in new ulong[] { 7, 31337, 999, 2024, 12345, 555, 88 })
            {
                using var duel = new InteractiveDuel(sa, jogador.ToArray(), seed, 0x1000000UL,
                                                     npc: true, npcDeck: npc.ToArray());
                var r = duel.Advance();

                for (int guard = 0; guard < 600 && !r.ended && !negou; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        string tipo = t.GetProperty("type")?.GetValue(e) as string;
                        if (tipo == "end" && (t.GetProperty("reason")?.GetValue(e) as string) == "guard")
                            travou = true;
                        if (tipo == "move"
                            && Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0) == LOC_GRAVE)
                            cemiterio.Add(Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u));
                        if (tipo == "npc" && (t.GetProperty("action")?.GetValue(e) as string) == "chain")
                        {
                            string why = t.GetProperty("why")?.GetValue(e) as string ?? "";
                            Log.Info($"  NPC (corrente): {why}");
                            if (pararQuando(why)) { negou = true; porque = why; }
                        }
                    }

                    var q = r.question;
                    if (q == null) break;

                    r = q.kind switch
                    {
                        "idle" => JogadaDoJogador(duel, q, jogarMagia),
                        "battle" => q.attackers.Count > 0
                            ? duel.Respond("attack", q.attackers[0].index)
                            : duel.Respond("endbattle", 0),
                        "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                        "position" => duel.Respond("position", 0x1),
                        "chain" => duel.Respond("chain", -1),   // o jogador nunca encadeia
                        "selectcard" or "selecttribute" or "selectsum" => duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                        _ => duel.Respond("endturn", 0),
                    };
                }

                // Uma última colheita: o cemitério da jogada que encerrou o laço.
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) == "move"
                        && Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0) == LOC_GRAVE)
                        cemiterio.Add(Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u));
                }
                if (negou) break;
            }
            return (negou, porque, cemiterio, travou);
        }

        static InteractiveDuel.Result JogadaDoJogador(
            InteractiveDuel duel, InteractiveDuel.Question q, bool jogarMagia)
        {
            if (jogarMagia && q.activatable.Count > 0)
                return duel.Respond("activate", q.activatable[0].index);
            if (q.summonable.Count > 0)
                return duel.Respond("summon", q.summonable[0].index);
            return q.canBattle ? duel.Respond("battle", 0) : duel.Respond("endturn", 0);
        }
    }
}

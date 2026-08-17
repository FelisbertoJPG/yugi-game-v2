using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Inteligência do deck do Joey ("Red Eyes Burst") — `--test-joey`.
    ///
    /// Prova que a IA generalizada pega o deck: ritual reconhecido por TIPO
    /// (Zera Ritual / Fortress Whale's Oath, não só o do Kaiba), burn ativado
    /// (Ookazi etc.) e remoção com alvo (Harpie's só se o oponente tem S/T).
    /// Depois, um duelo real com o deck completo, sem travar.
    /// </summary>
    public static class TestJoey
    {
        const uint RED_EYES = 74677422, ZERA = 69123138, FORTRESS = 62337487,
                   ZERA_RITUAL = 81756897, FW_OATH = 77454922, REBORN = 83764718,
                   POT = 55144522, OOKAZI = 19523799, FINAL_FLAME = 73134081,
                   TREMENDOUS = 46918794, INFERNO = 52684508, HARPIE = 18144506,
                   MIRROR = 44095762, CYLINDER = 62279055;

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== regras do Joey (decisao isolada) ===\n");
            Isolado(sa);
            Log.Info("\n=== Joey jogando um duelo de verdade ===\n");
            DueloReal(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        static void Isolado(string sa)
        {
            var db = new DatabaseManager(sa);
            var f0 = new List<uint>();
            int stFoe = 0;
            var brain = new NpcBrain(db,
                p => p == 0 ? f0 : new List<uint>(), null,
                p => new List<uint>(),
                p => p == 0 ? stFoe : 0);

            InteractiveDuel.Question Idle(params uint[] activ)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0; foreach (var c in activ) q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                return q;
            }

            // ritual reconhecido por TIPO (Zera Ritual), não por ID do Kaiba
            var p1 = brain.Decide(Idle(ZERA_RITUAL), 1);
            Check("ativa o Ritual do Joey (Zera Ritual, por tipo)",
                  p1.Action == "activate" && p1.Why.Contains("Ritual"), $"(veio {p1.Action}: {p1.Why})");

            var p1b = brain.Decide(Idle(FW_OATH), 1);
            Check("ativa o Ritual do Joey (Fortress Whale's Oath, por tipo)",
                  p1b.Action == "activate" && p1b.Why.Contains("Ritual"), $"(veio {p1b.Action}: {p1b.Why})");

            // burn dispara sempre
            var p2 = brain.Decide(Idle(OOKAZI), 1);
            Check("ativa burn (Ookazi)", p2.Action == "activate" && p2.Why.Contains("burn"),
                  $"(veio {p2.Action}: {p2.Why})");

            var p2b = brain.Decide(Idle(INFERNO), 1);
            Check("ativa burn (Inferno Fire Blast)", p2b.Action == "activate" && p2b.Why.Contains("burn"),
                  $"(veio {p2b.Action}: {p2b.Why})");

            // Harpie's Feather Duster só quando o oponente TEM magia/armadilha
            stFoe = 0;
            var p3a = brain.Decide(Idle(HARPIE), 1);
            Check("Harpie's NAO dispara sem S/T do oponente", p3a.Action != "activate",
                  $"(veio {p3a.Action})");
            stFoe = 2;
            var p3b = brain.Decide(Idle(HARPIE), 1);
            Check("Harpie's dispara com S/T do oponente em campo",
                  p3b.Action == "activate" && p3b.Why.Contains("remocao"), $"(veio {p3b.Action}: {p3b.Why})");

            // Pote continua primeiro. A checagem e' pelo INDICE, nao pela
            // palavra "Pote" no texto: a regra deixou de conhecer a carta pelo ID
            // e passou a reconhecer QUALQUER compra limpa pelo efeito, entao o
            // log nao cita mais o nome — mas a jogada tem de ser a mesma.
            var p4 = brain.Decide(Idle(POT, OOKAZI), 1);
            Check("Pote antes do burn", p4.Action == "activate" && p4.Index == 0,
                  $"(veio {p4.Why})");
        }

        static void DueloReal(string sa)
        {
            var deck = new List<uint>();
            void Add(uint c, int n) { for (int i = 0; i < n; i++) deck.Add(c); }
            Add(RED_EYES, 3); Add(ZERA, 3); Add(FORTRESS, 3); Add(ZERA_RITUAL, 3); Add(FW_OATH, 3);
            Add(REBORN, 3); Add(POT, 3); Add(OOKAZI, 3); Add(FINAL_FLAME, 3); Add(TREMENDOUS, 3);
            Add(INFERNO, 3); Add(HARPIE, 1); Add(MIRROR, 3); Add(CYLINDER, 3);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 424242UL, 0x1000000UL, npc: true);
            var r = duel.Advance();

            var reasons = new List<string>();
            var acoes = new List<string>();
            bool travou = false;
            int guard = 0;
            while (!r.ended && guard++ < 240)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string kind = t.GetProperty("type")?.GetValue(e) as string;
                    if (kind == "end" && (t.GetProperty("reason")?.GetValue(e) as string) == "guard") travou = true;
                    if (kind == "npc")
                    {
                        acoes.Add(t.GetProperty("action")?.GetValue(e) as string);
                        string why = t.GetProperty("why")?.GetValue(e) as string;
                        reasons.Add(why);
                        Log.Info($"  NPC: {t.GetProperty("action")?.GetValue(e)}  ({why})");
                    }
                }
                var q = r.question;
                if (q == null) break;
                r = q.kind switch
                {
                    "idle" => q.summonable.Count > 0 ? duel.Respond("summon", q.summonable[0].index)
                            : q.canBattle ? duel.Respond("battle", 0)
                            : duel.Respond("endturn", 0),
                    "battle" => q.attackers.Count > 0 ? duel.Respond("attack", q.attackers[0].index)
                              : duel.Respond("endbattle", 0),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "chain" => duel.Respond("chain", -1),
                    "yesno" => duel.Respond("yesno", 1),
                    "selectcard" or "selecttribute" or "selectsum" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Log.Info($"\n  acoes do NPC: [{string.Join(", ", acoes.Distinct())}]");
            Check("o duelo nao travou", !travou);
            Check("o NPC ativou magias de efeito (ritual/burn/reborn/etc.)",
                  acoes.Count(a => a == "activate") > 0, $"(acoes: {string.Join(",", acoes.Distinct())})");
        }
    }
}

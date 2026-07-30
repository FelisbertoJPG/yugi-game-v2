using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste da inteligência do deck do Kaiba — `--test-kaiba`.
    ///
    /// Parte 1: decisões ISOLADAS (montadas na mão) confirmam as regras pedidas —
    /// descartar o maior monstro, tributar o mais fraco, mirar o mais forte, o
    /// combo Tribute→Reborn, setar armadilha mantendo zona, Burst só com 2+, ritual.
    /// Parte 2: um duelo real com o deck completo, sem travar, imprimindo o
    /// raciocínio do NPC (é assim que se confere a estratégia na prática).
    /// </summary>
    public static class TestKaiba
    {
        const uint BEWD = 89631139, HYOZAN = 62397231, TRIHORN = 39111158,
                   ALEX = 43096270, OX = 5053103, SKULL = 3627449,
                   POT = 55144522, REBORN = 83764718, TTD = 79759861,
                   BURST = 17655904, NOVOX = 43694075,
                   TRAP_HOLE = 4206964, SAKURETSU = 56120475, DUST = 60082869;

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== regras do Kaiba (decisao isolada) ===\n");
            Isolado(sa);
            Log.Info("\n=== Kaiba jogando um duelo de verdade ===\n");
            DueloReal(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ---------------------------------------------------------------- isolado
        static void Isolado(string sa)
        {
            var db = new DatabaseManager(sa);
            var f0 = new List<uint>();   // campo do oponente (jogador 0)
            var f1 = new List<uint>();   // campo do NPC (jogador 1)
            var mao1 = new List<uint>(); // mão do NPC
            int st1 = 0;
            var brain = new NpcBrain(db,
                p => p == 0 ? f0 : f1, null,
                p => p == 1 ? mao1 : new List<uint>(),
                p => p == 1 ? st1 : 0);

            InteractiveDuel.Question Idle(uint[] summon = null, uint[] setST = null,
                                          uint[] activ = null, bool canBattle = false)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1, canBattle = canBattle };
                int i = 0; foreach (var c in summon ?? Array.Empty<uint>()) q.summonable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                i = 0; foreach (var c in setST ?? Array.Empty<uint>()) q.settableST.Add(new InteractiveDuel.Act { code = c, index = i++ });
                i = 0; foreach (var c in activ ?? Array.Empty<uint>()) q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                return q;
            }

            InteractiveDuel.Question Sel(byte loc, byte ctrl, byte release, params uint[] cards)
            {
                var q = new InteractiveDuel.Question
                { kind = "selectcard", player = 1, selMin = 1, selMax = 1, selCount = cards.Length };
                for (int i = 0; i < cards.Length; i++)
                    q.choices.Add(new InteractiveDuel.Sel
                    { code = cards[i], index = i, location = loc, controller = ctrl, release = release });
                return q;
            }

            // 1. descarte: joga fora o MAIOR monstro (BEWD), não a magia
            var q1 = Sel(0x2, 1, 0, POT, BEWD, OX);   // mão (loc 0x2)
            var p1 = brain.DecideSelect(q1, 1);
            Check("descarte escolhe o maior monstro (BEWD, idx 1)",
                  p1.Count == 1 && p1[0] == 1, $"(veio [{string.Join(",", p1)}])");

            // 2. alvo de remoção: o MAIS FORTE do campo do oponente
            var q2 = Sel(0x4, 0, 0, OX, BEWD);        // MZONE do oponente
            var p2 = brain.DecideSelect(q2, 1);
            Check("alvo mira o mais forte (BEWD, idx 1)",
                  p2.Count == 1 && p2[0] == 1, $"(veio [{string.Join(",", p2)}])");

            // 3. tributo: sacrifica o mais FRACO (Battle Ox 1700 < Alexandrite 2000)
            var q3 = Sel(0x4, 1, 1, ALEX, OX);        // meus monstros, release=1
            var p3 = brain.DecideSelect(q3, 1);
            Check("tributo sacrifica o mais fraco (Battle Ox, idx 1)",
                  p3.Count == 1 && p3[0] == 1, $"(veio [{string.Join(",", p3)}])");

            // 4. Pote primeiro
            f0.Clear(); f1.Clear(); mao1.Clear(); st1 = 0;
            var p4 = brain.Decide(Idle(activ: new[] { POT, REBORN }), 1);
            Check("Pote da Ganancia primeiro", p4.Action == "activate" && p4.Index == 0,
                  $"(veio {p4.Action} idx {p4.Index})");

            // 5. combo: Tribute to The Doomed com Reborn na mão + ameaça
            f0.Clear(); f0.Add(BEWD); f1.Clear(); mao1.Clear(); mao1.Add(REBORN); st1 = 0;
            var p5 = brain.Decide(Idle(activ: new[] { TTD }), 1);
            Check("combo Tribute→Reborn dispara com Reborn na mao",
                  p5.Action == "activate" && p5.Why.Contains("combo"), $"(veio {p5.Action}: {p5.Why})");

            // 6. seta armadilha mantendo zona; com 4 zonas ocupadas, NÃO seta
            f0.Clear(); f1.Clear(); mao1.Clear();
            st1 = 0;
            var p6a = brain.Decide(Idle(setST: new[] { TRAP_HOLE }), 1);
            Check("seta a armadilha quando ha espaco", p6a.Action == "setspell",
                  $"(veio {p6a.Action})");
            st1 = 4;
            var p6b = brain.Decide(Idle(setST: new[] { TRAP_HOLE }), 1);
            Check("NAO seta a armadilha com 4 zonas ocupadas (mantem 1 livre)",
                  p6b.Action != "setspell", $"(veio {p6b.Action})");

            // 7. Burst Stream só com 2+ monstros do oponente
            f1.Clear(); f1.Add(BEWD); mao1.Clear(); st1 = 0;
            f0.Clear(); f0.Add(OX);
            var p7a = brain.Decide(Idle(activ: new[] { BURST }), 1);
            Check("Burst NAO dispara com 1 monstro do oponente", p7a.Action != "activate",
                  $"(veio {p7a.Action})");
            f0.Add(ALEX);   // agora 2 monstros
            var p7b = brain.Decide(Idle(activ: new[] { BURST }), 1);
            Check("Burst dispara com 2 monstros do oponente",
                  p7b.Action == "activate" && p7b.Why.Contains("Burst"), $"(veio {p7b.Action}: {p7b.Why})");

            // 8. ritual quando disponível
            f0.Clear(); f1.Clear(); mao1.Clear(); st1 = 0;
            var p8 = brain.Decide(Idle(activ: new[] { NOVOX }), 1);
            Check("ativa o Ritual (Novox's Prayer)", p8.Action == "activate" && p8.Why.Contains("Ritual"),
                  $"(veio {p8.Action}: {p8.Why})");
        }

        // ---------------------------------------------------------------- duelo real
        static void DueloReal(string sa)
        {
            var deck = new List<uint>();
            void Add(uint c, int n) { for (int i = 0; i < n; i++) deck.Add(c); }
            Add(BEWD, 3); Add(HYOZAN, 3); Add(TRIHORN, 3); Add(ALEX, 2); Add(OX, 2); Add(SKULL, 3);
            Add(TTD, 3); Add(REBORN, 3); Add(POT, 3); Add(BURST, 3); Add(NOVOX, 3);
            Add(TRAP_HOLE, 3); Add(SAKURETSU, 3); Add(DUST, 3);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 20260729UL, 0x1000000UL, npc: true);
            var r = duel.Advance();

            var acoes = new List<string>();
            bool travou = false;
            int guard = 0;
            while (!r.ended && guard++ < 220)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string kind = t.GetProperty("type")?.GetValue(e) as string;
                    if (kind == "end" && (t.GetProperty("reason")?.GetValue(e) as string) == "guard") travou = true;
                    if (kind == "npc")
                    {
                        string act = t.GetProperty("action")?.GetValue(e) as string;
                        acoes.Add(act);
                        Log.Info($"  NPC: {act}  ({t.GetProperty("why")?.GetValue(e)})");
                    }
                }
                var q = r.question;
                if (q == null) break;

                // Jogador 0 (humano) joga simples: invoca pra criar ameaça, senão passa.
                r = q.kind switch
                {
                    "idle" => q.summonable.Count > 0 ? duel.Respond("summon", q.summonable[0].index)
                            : q.canBattle ? duel.Respond("battle", 0)
                            : duel.Respond("endturn", 0),
                    "battle" => q.attackers.Count > 0 ? duel.Respond("attack", q.attackers[0].index)
                              : duel.Respond("endbattle", 0),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "chain" => duel.Respond("chain", -1),   // humano não encadeia neste teste
                    "selectcard" or "selecttribute" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    "selectsum" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Log.Info($"\n  acoes do NPC: [{string.Join(", ", acoes.Distinct())}]");
            Check("o duelo nao travou em laco fechado", !travou);
            Check("o NPC jogou de verdade (invocou/setou/ativou)",
                  acoes.Any(a => a is "summon" or "setspell" or "activate"),
                  $"(acoes: {string.Join(",", acoes.Distinct())})");
        }
    }
}

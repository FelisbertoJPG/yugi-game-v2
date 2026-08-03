using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação do pacote TOON (o deck do Pegasus) — `--test-toon`.
    ///
    /// Duas peças novas no `NpcBrain`, nesta ordem de prioridade dentro do
    /// Main Phase:
    ///   1. Ativa Toon World o quanto antes (logo depois do Pote) — sem ele
    ///      nada do resto funciona.
    ///   2. Invoca Especialmente (`spsummon`) um Toon "clássico" da mão
    ///      (Toon Mermaid, Toon Summoned Skull, Toon Dark Magician Girl,
    ///      Blue-Eyes Toon Dragon) assim que o motor os oferece em
    ///      `spSummonable` — o que só acontece com Toon World em campo,
    ///      exatamente como a carta pede (`EFFECT_SPSUMMON_PROC` no script
    ///      dela, ver `c65458948.lua`).
    /// Os Toons "modernos" (Gemini Elf, Cannon Soldier, Barrel Dragon etc.)
    /// não precisam de regra nenhuma: são Invocação Normal comum e a lógica
    /// de beatdown já existente (`Monstros(q.summonable)`) os pega de graça —
    /// o ataque direto e a destruição-se-Toon-World-sair vêm do Lua deles.
    ///
    /// Parte 1: decisões ISOLADAS (montadas na mão) — mesmo padrão do
    /// TestKaiba/TestJoey. Parte 2: um duelo real com Toon World + Toon
    /// Mermaid no deck, o NPC jogando sozinho, provando o motor de ponta a
    /// ponta (ativa a magia, especial-invoca o Toon, ataca).
    /// </summary>
    public static class TestToon
    {
        const uint TOON_WORLD = 15259703;
        const uint TOON_TABLE = 89997728;
        const uint TOON_MERMAID = 65458948;      // Nv4 1400/1500, sem tributo
        const uint TOON_SUMMONED_SKULL = 91842653; // Nv6 2500/1200, tributa 1
        const uint STARDUST = 44508094;          // spsummon NÃO-Toon (controle: nao deve disparar a regra)
        const uint POT = 55144522;
        const uint BATTLE_OX = 5053103;          // vanilla Nv4 1700/1000, filler/tributo

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== regras do Toon (decisao isolada) ===\n");
            Isolado(sa);
            Log.Info("\n=== Toon jogando um duelo de verdade ===\n");
            DueloReal(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ---------------------------------------------------------------- isolado
        static void Isolado(string sa)
        {
            var db = new DatabaseManager(sa);
            var f0 = new List<uint>();     // campo do oponente
            var f1 = new List<uint>();     // campo do NPC
            var mao1 = new List<uint>();   // mão do NPC
            var stAberta1 = new List<uint>(); // magia/armadilha ABERTA do NPC (Toon World, uma vez ativo)
            var brain = new NpcBrain(db,
                p => p == 0 ? f0 : f1, null,
                p => p == 1 ? mao1 : new List<uint>(),
                p => 0,
                null, null,
                p => p == 1 ? stAberta1 : new List<uint>());

            InteractiveDuel.Question Idle(uint[] activ = null, uint[] spSummon = null)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0; foreach (var c in activ ?? Array.Empty<uint>()) q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                i = 0; foreach (var c in spSummon ?? Array.Empty<uint>()) q.spSummonable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                return q;
            }

            InteractiveDuel.Question Sel(params uint[] cards)
            {
                var q = new InteractiveDuel.Question
                { kind = "selectcard", player = 1, selMin = 1, selMax = 1, selCount = cards.Length };
                for (int i = 0; i < cards.Length; i++)
                    q.choices.Add(new InteractiveDuel.Sel
                    { code = cards[i], index = i, location = 0x1 /* deck */, controller = 1, release = 0 });
                return q;
            }

            // 1. Toon World ativa mesmo sem Pote na mesa.
            f0.Clear(); f1.Clear(); mao1.Clear(); stAberta1.Clear();
            var p1 = brain.Decide(Idle(activ: new[] { TOON_WORLD }), 1);
            Check("Toon World ativa o quanto antes", p1.Action == "activate" && p1.Why.Contains("Toon World"),
                  $"(veio {p1.Action}: {p1.Why})");

            // 2. Toon World cede a vez pro Pote (a regra do Pote continua ANTES).
            var p2 = brain.Decide(Idle(activ: new[] { POT, TOON_WORLD }), 1);
            Check("Pote da Ganancia continua vindo antes de Toon World",
                  p2.Action == "activate" && p2.Index == 0, $"(veio {p2.Action} idx {p2.Index})");

            // 3. spsummon de um Toon "classico" disponivel -> a regra pega.
            f0.Clear(); f1.Clear(); mao1.Clear(); stAberta1.Clear();
            var p3 = brain.Decide(Idle(spSummon: new[] { TOON_MERMAID }), 1);
            Check("invoca especialmente o Toon disponivel em spSummonable",
                  p3.Action == "spsummon" && p3.Why.Contains("Toon"), $"(veio {p3.Action}: {p3.Why})");

            // 4. entre dois Toons especiais, escolhe o de MAIOR ATK.
            var p4 = brain.Decide(Idle(spSummon: new[] { TOON_MERMAID, TOON_SUMMONED_SKULL }), 1);
            Check("entre Toon Mermaid (1400) e Toon Summoned Skull (2500), escolhe o Skull",
                  p4.Action == "spsummon" && p4.Index == 1, $"(veio {p4.Action} idx {p4.Index})");

            // 5. controle: um spsummon NAO-Toon (Stardust) na lista não deve
            //    disparar a regra do Toon nem travar a decisão.
            var p5 = brain.Decide(Idle(spSummon: new[] { STARDUST }), 1);
            Check("spsummon nao-Toon (Stardust) NAO aciona a regra do Toon",
                  !(p5.Action == "spsummon" && p5.Why.Contains("Toon")), $"(veio {p5.Action}: {p5.Why})");

            // 6. busca (Toon Table of Contents): sem Toon World na mão/campo,
            //    entre as opções ele vem primeiro mesmo não sendo o de maior ATK.
            var q6 = Sel(TOON_SUMMONED_SKULL, TOON_WORLD);
            var s6 = brain.DecideSelect(q6, 1);
            Check("busca prioriza Toon World quando o NPC ainda nao o tem",
                  s6.Count == 1 && s6[0] == 1, $"(veio [{string.Join(",", s6)}])");

            // 7. já COM Toon World em campo (aberto), a busca segue a regra
            //    genérica (maior ATK) em vez de insistir nele de novo.
            stAberta1.Add(TOON_WORLD);
            var q7 = Sel(TOON_SUMMONED_SKULL, TOON_WORLD);
            var s7 = brain.DecideSelect(q7, 1);
            Check("com Toon World ja em campo, a busca nao o repete (pega o Skull, idx 0)",
                  s7.Count == 1 && s7[0] == 0, $"(veio [{string.Join(",", s7)}])");
        }

        // ---------------------------------------------------------------- duelo real
        static void DueloReal(string sa)
        {
            // Deck saturado de Toon World + os dois "clássicos" — mesmo padrão
            // de TestSynchro/TestXyz: o objetivo é testar a MECÂNICA (ativar a
            // magia, especial-invocar da mão) com certeza estatística, não a
            // consistência de um deck de 40 cartas de verdade.
            var deck = new List<uint>();
            void Add(uint c, int n) { for (int i = 0; i < n; i++) deck.Add(c); }
            Add(TOON_WORLD, 15); Add(TOON_MERMAID, 11); Add(TOON_SUMMONED_SKULL, 11); Add(POT, 3);
            while (deck.Count < 40) deck.Add(BATTLE_OX);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 71717171UL, 0x1000000UL, npc: true);
            var r = duel.Advance();

            var acoes = new List<string>();
            bool travou = false, ativouToonWorld = false, spsummonouToon = false;
            int guard = 0;
            while (!r.ended && guard++ < 800)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string kind = t.GetProperty("type")?.GetValue(e) as string;
                    if (kind == "end" && (t.GetProperty("reason")?.GetValue(e) as string) == "guard") travou = true;
                    if (kind == "npc")
                    {
                        string act = t.GetProperty("action")?.GetValue(e) as string;
                        string why = t.GetProperty("why")?.GetValue(e) as string ?? "";
                        acoes.Add(act);
                        if (act == "activate" && why.Contains("Toon World")) ativouToonWorld = true;
                        if (act == "spsummon" && why.Contains("Toon")) spsummonouToon = true;
                        Log.Info($"  NPC: {act}  ({why})");
                    }
                }
                if (spsummonouToon) break;
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
                    "chain" => duel.Respond("chain", -1),
                    "selectcard" or "selecttribute" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    "selectsum" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Log.Info($"\n  acoes do NPC: [{string.Join(", ", acoes.Distinct())}]");
            Check("o duelo nao travou em laco fechado", !travou);
            Check("o NPC ativou Toon World sozinho", ativouToonWorld);
            Check("o NPC invocou especialmente um Toon 'classico' (spsummon)", spsummonouToon);
        }
    }
}

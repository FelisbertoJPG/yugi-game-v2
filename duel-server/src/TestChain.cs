using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação das correntes de armadilha — `--test-chain`.
    ///
    /// Prova o caminho completo: o jogador 0 seta uma Mirror Force, o NPC invoca
    /// e ataca, o motor devolve a janela de corrente AO JOGADOR (não some mais
    /// sozinha), e ao ativar a Mirror Force o motor destrói o atacante. Nenhuma
    /// dessas regras é nossa — o Lua da Mirror Force já vem no ocgcore; o teste
    /// prova que estamos abrindo e respondendo a corrente direito.
    /// </summary>
    public static class TestChain
    {
        const uint MIRROR = 44095762;   // Mirror Force
        const uint OX = 5053103;        // Battle Ox 1700/1000
        const byte LOC_GRAVE = 0x10;

        static int _pass, _fail;

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== teste: corrente de armadilha (Mirror Force) ===\n");
            MirrorForce(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        static void MirrorForce(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) deck.Add(MIRROR);
            for (int i = 0; i < 20; i++) deck.Add(OX);

            bool viuJanela = false, ativou = false, atacanteDestruido = false;

            // Vários seeds até o jogador 0 abrir com Mirror Force na mão.
            foreach (ulong seed in new ulong[] { 7, 31337, 999, 2024, 12345, 555, 88, 41, 13 })
            {
                using var duel = new InteractiveDuel(sa, deck.ToArray(), seed, 0x1000000UL, npc: true);
                var r = duel.Advance();
                var aoCemiterio = new List<uint>();

                void Colher(InteractiveDuel.Result res)
                {
                    foreach (var e in res.events)
                    {
                        var t = e.GetType();
                        if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        if (loc == LOC_GRAVE) aoCemiterio.Add(code);
                    }
                }

                for (int guard = 0; guard < 80 && !r.ended && !aoCemiterio.Contains(OX); guard++)
                {
                    Colher(r);

                    var q = r.question;
                    if (q == null) break;

                    if (q.kind == "chain" && q.player == 0 && q.choices.Count > 0)
                    {
                        int mf = q.choices.FindIndex(c => c.code == MIRROR);
                        if (!viuJanela)
                        {
                            viuJanela = true;
                            Check("a janela de corrente traz a Mirror Force", mf >= 0,
                                  $"(codigos: {string.Join(",", q.choices.Select(c => c.code))})");
                        }
                        r = duel.Respond("chain", mf >= 0 ? q.choices[mf].index : -1);
                        ativou = true;
                        continue;
                    }

                    r = q.kind switch
                    {
                        // Jogador 0: seta Mirror Force e passa (campo vazio força o
                        // ataque direto do NPC, que abre a corrente).
                        "idle" => Idle(duel, q),
                        "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                        "position" => duel.Respond("position", 0x1),
                        "selectcard" or "selecttribute" => duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                        _ => duel.Respond("endturn", 0),
                    };
                }

                Colher(r);
                atacanteDestruido = aoCemiterio.Contains(OX);
                if (ativou) break;
            }

            Check("a corrente foi devolvida ao jogador (nao some mais sozinha)", viuJanela);
            Check("o jogador conseguiu ativar a Mirror Force", ativou);
            Check("o atacante (Battle Ox) foi destruido pela Mirror Force", atacanteDestruido);
        }

        static InteractiveDuel.Result Idle(InteractiveDuel duel, InteractiveDuel.Question q)
        {
            var mf = q.settableST.FirstOrDefault(a => a.code == MIRROR);
            if (mf.code == MIRROR) return duel.Respond("setspell", mf.index);
            return duel.Respond("endturn", 0);
        }
    }
}

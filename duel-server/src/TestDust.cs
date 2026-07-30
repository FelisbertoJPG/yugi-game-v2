using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Regressão do Dust Tornado / SELECT_YESNO (msg 13) — `--test-dust`.
    ///
    /// O Dust Tornado destrói 1 magia/armadilha e então PERGUNTA (sim/não) se você
    /// quer setar 1 magia/armadilha da mão. Antes o treino travava nessa pergunta
    /// ("acao nao suportada msg 13"). Aqui o jogador 0 ativa o Dust Tornado numa
    /// armadilha que o NPC setou, responde SIM, e confirmamos que a janela sim/não
    /// apareceu, nada ficou "unsupported", e o Dust Tornado foi ao cemitério.
    /// </summary>
    public static class TestDust
    {
        const uint DUST = 60082869;    // Dust Tornado
        const uint TRAP_HOLE = 4206964;
        const uint OX = 5053103;
        const byte LOC_GRAVE = 0x10;

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== teste: Dust Tornado / sim-nao (msg 13) ===\n");
            Dust(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        static void Dust(string sa)
        {
            // Jogador 0: Dust Tornado à vontade. NPC: armadilhas (Trap Hole) para o
            // Dust ter alvo, + beaters.
            var p0 = new List<uint>();
            for (int i = 0; i < 30; i++) p0.Add(DUST);
            for (int i = 0; i < 10; i++) p0.Add(OX);
            var npc = new List<uint>();
            for (int i = 0; i < 20; i++) npc.Add(TRAP_HOLE);
            for (int i = 0; i < 20; i++) npc.Add(OX);

            bool sawYesno = false, unsupported = false, dustGrave = false, ativouDust = false;

            foreach (ulong seed in new ulong[] { 7, 31337, 999, 2024, 123, 55 })
            {
                using var duel = new InteractiveDuel(sa, p0.ToArray(), seed, 0x1000000UL, npc: true, npcDeck: npc.ToArray());
                var r = duel.Advance();

                for (int guard = 0; guard < 160 && !r.ended && !(sawYesno && dustGrave); guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        if ((t.GetProperty("type")?.GetValue(e) as string) != "move") continue;
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        if (loc == LOC_GRAVE && code == DUST) dustGrave = true;
                    }

                    var q = r.question;
                    if (q == null) break;
                    if (q.kind == "unsupported") { unsupported = true; break; }

                    if (q.kind == "yesno" && q.player == 0)
                    {
                        sawYesno = true;
                        r = duel.Respond("yesno", 1);   // SIM: seta uma carta da mão
                        continue;
                    }

                    if (q.kind == "idle" && q.player == 0)
                    {
                        // Dust Tornado é ARMADILHA: seta primeiro; num turno seguinte,
                        // com a armadilha do NPC em campo, o Dust setado fica ativável.
                        var pronto = q.activatable.FirstOrDefault(a => a.code == DUST);
                        if (pronto.code == DUST) { ativouDust = true; r = duel.Respond("activate", pronto.index); continue; }
                        var naMao = q.settableST.FirstOrDefault(a => a.code == DUST);
                        if (naMao.code == DUST) { r = duel.Respond("setspell", naMao.index); continue; }
                        r = duel.Respond("endturn", 0);
                        continue;
                    }

                    r = q.kind switch
                    {
                        "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                        "position" => duel.Respond("position", 0x1),
                        "battle" => duel.Respond("endbattle", 0),
                        "chain" => duel.Respond("chain", -1),
                        "selectcard" or "selecttribute" => duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                        _ => duel.Respond("endturn", 0),
                    };
                }
                if (ativouDust && sawYesno) break;
            }

            Check("o jogador conseguiu ativar o Dust Tornado", ativouDust);
            Check("a pergunta sim/nao (msg 13) apareceu — nao travou", sawYesno);
            Check("nada ficou 'unsupported'", !unsupported);
            Check("o Dust Tornado resolveu e foi ao cemiterio", dustGrave);
        }
    }
}

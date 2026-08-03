using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação das magias de Equipamento — `--test-equip`.
    ///
    /// Equipa a Legendary Sword (+300 ATK/DEF a Guerreiro) num Celtic Guardian
    /// (Guerreiro 1400/1200) e ataca direto: o dano tem de ser 1700, não 1400.
    /// Se o equipamento não tivesse aplicado o bônus, o dano denunciaria. O Lua da
    /// carta já vem no ocgcore — o teste prova que o caminho ativar → escolher
    /// alvo → bônus funciona ponta a ponta.
    /// </summary>
    public static class TestEquip
    {
        const uint CELTIC = 91152256;   // Celtic Guardian (Guerreiro, 1400/1200)
        const uint SWORD = 61854111;    // Legendary Sword (+300/+300 a Guerreiro)

        static int _pass, _fail;

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== teste: magia de Equipamento (Legendary Sword) ===\n");
            Equipar(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        static void Equipar(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) deck.Add(CELTIC);
            for (int i = 0; i < 20; i++) deck.Add(SWORD);

            // npc:false — o oponente só passa o turno (campo vazio), então o Celtic
            // ataca direto e o dano revela o ATK real.
            using var duel = new InteractiveDuel(sa, deck.ToArray(), 31337UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            bool invocou = false, equipou = false, atacou = false, pediuAlvo = false;
            int danoDireto = 0, atkAtual = 0, atkBase = 0;

            for (int guard = 0; guard < 120 && !r.ended && danoDireto == 0; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string kind = t.GetProperty("type")?.GetValue(e) as string;
                    if (kind == "move")
                    {
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        if (code == SWORD) equipou = true;   // a espada entrou em campo (equipada)
                    }
                    if (kind == "lp")
                    {
                        int pl = Convert.ToInt32(t.GetProperty("player")?.GetValue(e) ?? 0);
                        int delta = Convert.ToInt32(t.GetProperty("delta")?.GetValue(e) ?? 0);
                        if (pl == 1 && delta < 0) danoDireto = -delta;
                    }
                    if (kind == "stats")
                    {
                        atkAtual = Convert.ToInt32(t.GetProperty("atk")?.GetValue(e) ?? 0);
                        atkBase = Convert.ToInt32(t.GetProperty("baseAtk")?.GetValue(e) ?? 0);
                    }
                }

                var q = r.question;
                if (q == null) break;

                if (q.kind == "selectcard" && q.player == 0)
                    pediuAlvo = q.choices.Any(c => c.code == CELTIC && c.location == 0x4);

                if (q.kind == "idle" && q.player == 0)
                {
                    var celtic = q.summonable.FirstOrDefault(a => a.code == CELTIC);
                    var sword = q.activatable.FirstOrDefault(a => a.code == SWORD);
                    if (!invocou && celtic.code == CELTIC)
                    { invocou = true; r = duel.Respond("summon", celtic.index); continue; }
                    if (!equipou && sword.code == SWORD)
                    { r = duel.Respond("activate", sword.index); continue; }
                    if (q.canBattle) { r = duel.Respond("battle", 0); continue; }
                    r = duel.Respond("endturn", 0); continue;
                }

                r = q.kind switch
                {
                    "battle" => q.attackers.Count > 0
                        ? (atacou = true) ? duel.Respond("attack", q.attackers[0].index) : r
                        : duel.Respond("endbattle", 0),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "selectcard" or "selecttribute" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Check("o Celtic Guardian foi invocado", invocou);
            Check("o motor pediu que o jogador escolhesse o alvo do equipamento", pediuAlvo);
            Check("a Legendary Sword foi equipada (entrou em campo)", equipou);
            Check("o ATK atual do Celtic foi consultado (1400 + 300)", atkAtual == 1700 && atkBase == 1400,
                  $"(atual={atkAtual}, base={atkBase})");
            Check("houve ataque direto", atacou);
            Check("o dano foi 1700 (1400 + 300 do equipamento)", danoDireto == 1700,
                  $"(veio {danoDireto})");
        }
    }
}

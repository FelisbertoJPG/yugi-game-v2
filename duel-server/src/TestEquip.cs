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

        // O outro formato do mesmo problema: um monstro cujo efeito CONTÍNUO sobe
        // o ATK dos outros. Não há alvo a escolher nem equipamento entrando em
        // campo — o bônus nasce da invocação, e o `stats` de QUEM JÁ ESTAVA no
        // campo tem de sair na mesma resposta.
        const uint STAR_BOY = 8201910;   // AQUA/WATER: todo WATER ganha +500 ATK
        const uint JELLYFISH = 14851496; // AQUA/WATER 1200/1500 — quem recebe o bônus

        public static int Run(string sa)
        {
            Log.Info("=== teste: magia de Equipamento (Legendary Sword) ===\n");
            Equipar(sa);
            Log.Info("\n=== teste: efeito continuo (Star Boy) chega na hora ===\n");
            EfeitoContinuo(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// Invoca um Jellyfish (WATER 1200) e, no turno seguinte, um Star Boy —
        /// que dá +500 a todo WATER. O `stats` do Jellyfish (1200 → 1700) tem de
        /// chegar na MESMA resposta da invocação do Star Boy: é o número que a
        /// carta na tela vai mostrar, e é por ele que o jogador decide atacar.
        /// </summary>
        static void EfeitoContinuo(string sa)
        {
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) deck.Add(JELLYFISH);
            for (int i = 0; i < 20; i++) deck.Add(STAR_BOY);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 4242UL, 0x1000000UL, npc: false);
            var r = duel.Advance();

            bool poseJelly = false, poseStar = false;
            int volta = 0, voltaStarBoy = -1, voltaBonus = -1;

            for (int guard = 0; guard < 200 && !r.ended && voltaBonus < 0; guard++)
            {
                volta++;
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string kind = t.GetProperty("type")?.GetValue(e) as string;
                    if (kind == "summoning")
                    {
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        if (code == STAR_BOY && voltaStarBoy < 0) voltaStarBoy = volta;
                    }
                    // O bônus é do JELLYFISH: 1200 impresso, 1700 com o Star Boy.
                    if (kind == "stats"
                        && Convert.ToInt32(t.GetProperty("baseAtk")?.GetValue(e) ?? 0) == 1200
                        && Convert.ToInt32(t.GetProperty("atk")?.GetValue(e) ?? 0) == 1700
                        && voltaBonus < 0) voltaBonus = volta;
                }

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle" && q.player == 0)
                {
                    var jelly = q.summonable.FirstOrDefault(a => a.code == JELLYFISH);
                    var star = q.summonable.FirstOrDefault(a => a.code == STAR_BOY);
                    if (!poseJelly && jelly.code == JELLYFISH)
                    { poseJelly = true; r = duel.Respond("summon", jelly.index); continue; }
                    if (poseJelly && !poseStar && star.code == STAR_BOY)
                    { poseStar = true; r = duel.Respond("summon", star.index); continue; }
                    r = duel.Respond("endturn", 0); continue;
                }

                r = q.kind switch
                {
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "battle" => duel.Respond("endbattle", 0),
                    "selectcard" or "selecttribute" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Check("o Star Boy entrou em campo", poseStar && voltaStarBoy > 0,
                  $"(volta {voltaStarBoy})");
            Check("o Jellyfish que JA' estava em campo virou 1700 (1200 + 500)", voltaBonus > 0,
                  "(nenhum evento stats com 1200 -> 1700)");
            Check("e o numero novo chega na MESMA resposta da invocacao do Star Boy",
                  voltaStarBoy > 0 && voltaBonus == voltaStarBoy,
                  $"(Star Boy na volta {voltaStarBoy}, stats so' na volta {voltaBonus})");
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
            // EM QUE RESPOSTA cada coisa chegou. O relato do jogador foi que o ATK
            // na carta só subia quando ele ia para a Battle Phase — ou seja, o
            // evento `stats` existia, mas chegava uma interação DEPOIS. Somar
            // "chegou em algum momento" não pega isso; a volta, sim.
            int volta = 0, voltaEquip = -1, voltaStats = -1, voltaAlvo = -1, voltaBattle = -1;

            for (int guard = 0; guard < 120 && !r.ended && danoDireto == 0; guard++)
            {
                volta++;
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string kind = t.GetProperty("type")?.GetValue(e) as string;
                    if (kind == "move")
                    {
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        if (code == SWORD) { equipou = true; if (voltaEquip < 0) voltaEquip = volta; }
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
                        if (atkAtual == 1700 && voltaStats < 0) voltaStats = volta;
                    }
                }

                var q = r.question;
                if (q == null) break;

                if (q.kind == "selectcard" && q.player == 0)
                {
                    pediuAlvo = q.choices.Any(c => c.code == CELTIC && c.location == 0x4);
                    if (voltaAlvo < 0) voltaAlvo = volta;
                }
                if (q.kind == "battle" && voltaBattle < 0) voltaBattle = volta;

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
            // O relato: "equipei e o ATK na carta só subiu quando fui pra Battle".
            // O bônus tem de chegar na MESMA resposta em que a espada entra em
            // campo — a tela desenha o que o evento traz, e o jogador decide o
            // ataque olhando esse número.
            // O relato do jogador: "equipei e o ATK na carta só subiu quando fui
            // pra Battle Phase". O evento existia — chegava tarde.
            //
            // A ordem real do motor: a espada ENTRA em campo e só então ele
            // pergunta o alvo (volta 5 aqui); o bônus passa a existir na resposta
            // a essa escolha (volta 6). Essa é a primeira volta possível, e é onde
            // ele tem de chegar. Antes chegava na 7 — uma interação inteira
            // depois, encostando na Battle Phase (volta 8), que foi exatamente o
            // que o jogador viu.
            Log.Info($"  ..    voltas: equip={voltaEquip} alvo={voltaAlvo} stats={voltaStats} battle={voltaBattle}");
            Check("o ATK novo chega na resposta em que o equipamento resolve",
                  voltaAlvo > 0 && voltaStats == voltaAlvo + 1,
                  $"(alvo escolhido na volta {voltaAlvo}, stats 1700 so' na volta {voltaStats})");
            Check("e chega ANTES da Battle Phase (o relato do jogador)",
                  voltaStats > 0 && voltaBattle > 0 && voltaStats < voltaBattle,
                  $"(stats na volta {voltaStats}, battle na volta {voltaBattle})");
            Check("houve ataque direto", atacou);
            Check("o dano foi 1700 (1400 + 300 do equipamento)", danoDireto == 1700,
                  $"(veio {danoDireto})");
        }
    }
}

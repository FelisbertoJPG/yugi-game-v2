using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação da INTELIGÊNCIA do Wevil — `--test-weevil-npc`.
    ///
    /// `--test-weevil` já prova que o Lua de cada carta roda certo quando
    /// ALGUÉM decide ativá-las na ordem certa. Este teste prova a OUTRA
    /// metade: será que o `NpcBrain`, jogando sozinho, decide ativá-las?
    ///
    /// Resposta original (antes das regras 5.15/5.2/5.3/5.4 em NpcBrain.cs):
    /// não. Cocoon of Evolution, Insect Armor with Laser Cannon e Insect
    /// Imitation não estavam em NENHUMA lista reconhecida — ficavam mortas na
    /// mão, o NPC só setava/atacava com o resto do deck. Pior: Cocoon of
    /// Evolution é um MONSTRO de efeito por baixo do pano (0/2000), então a
    /// lógica genérica de defesa ("seta o melhor DEF quando ameaçado") o
    /// queimava como parede na primeira ameaça — e o Lua do equip
    /// (`c40240595.lua`, `s.filter`) só aceita um Petit Moth com a face para
    /// CIMA como alvo, então setar o Petit Moth também matava o combo.
    ///
    /// Duas rodadas:
    ///   `ComDeckReal` — deck de verdade (`decks/npc/wevil/deck_1.ydk`), mão
    ///   aleatória. O casulo pode nem ser comprado numa partida curta (só 2
    ///   cópias em 45 cartas) — só checa o que é sempre verdade: não trava, e
    ///   ativa PELO MENOS uma carta de efeito do deck.
    ///
    ///   `ComCasuloGarantido` — deck empilhado (Petit Moth + Cocoon + as 3
    ///   mariposas), oponente PASSIVO (nunca ataca, mesmo espírito do `Auto()`
    ///   de `--test-weevil` — o alvo é isolar a decisão do NPC, não testar
    ///   sobrevivência sob pressão). Aqui sim, checa o combo inteiro de ponta
    ///   a ponta: invoca o Petit Moth em ATAQUE (não setado), equipa o casulo
    ///   no alvo certo, não desperdiça uma segunda cópia no mesmo alvo, e
    ///   chega a Invocar Especialmente uma mariposa de verdade.
    /// </summary>
    public static class TestWeevilNpc
    {
        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== Wevil: deck de verdade, mao aleatoria ===\n");
            ComDeckReal(sa);
            Log.Info("\n=== Wevil: casulo garantido (deck empilhado, oponente passivo) ===\n");
            ComCasuloGarantido(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        static void ComDeckReal(string sa)
        {
            var ydkPath = Path.Combine(AcharRaizDoProjeto(), "decks", "npc", "wevil", "deck_1.ydk");
            var (main, extra) = LerYdk(ydkPath);
            Log.Info($"deck do Wevil: {main.Count} no main, {extra.Count} no extra");

            var filler = new List<uint>();
            for (int i = 0; i < 40; i++) filler.Add(5053103); // Battle Ox, filler inerte

            using var duel = new InteractiveDuel(sa, filler.ToArray(), 909090UL, 0x1000000UL,
                npc: true, npcDeck: main.ToArray(), extra: null, npcExtra: extra.ToArray());
            var r = duel.Advance();

            var acoes = new List<string>();
            bool travou = false;
            int guard = 0;
            while (!r.ended && guard++ < 400)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string kind = t.GetProperty("type")?.GetValue(e) as string;
                    if (kind == "end" && (t.GetProperty("reason")?.GetValue(e) as string) == "guard") travou = true;
                    if (kind == "npc")
                    {
                        string action = t.GetProperty("action")?.GetValue(e) as string;
                        string why = t.GetProperty("why")?.GetValue(e) as string ?? "";
                        acoes.Add(action);
                        Log.Info($"  NPC: {action}  ({why})");
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
                    "selectcard" or "selecttribute" or "selectsum" or "selectunselect" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Log.Info($"  acoes distintas do NPC: [{string.Join(", ", acoes.Distinct())}]");
            Check("o duelo nao travou", !travou);
            Check("o NPC ativou pelo menos uma carta de efeito (nao so setou/atacou)",
                  acoes.Contains("activate") || acoes.Contains("spsummon"), $"(acoes: {string.Join(",", acoes.Distinct())})");
        }

        static void ComCasuloGarantido(string sa)
        {
            var deck = new List<uint>();
            void Add(uint c, int n) { for (int i = 0; i < n; i++) deck.Add(c); }
            Add(58192742, 10); // Petit Moth
            Add(40240595, 10); // Cocoon of Evolution
            Add(87756343, 7);  // Larvae Moth
            Add(14141448, 7);  // Great Moth
            Add(48579379, 6);  // Perfectly Ultimate Great Moth

            var filler = new List<uint>();
            for (int i = 0; i < 40; i++) filler.Add(5053103); // Battle Ox, filler inerte

            using var duel = new InteractiveDuel(sa, filler.ToArray(), 424242UL, 0x1000000UL,
                npc: true, npcDeck: deck.ToArray(), extra: null, npcExtra: null);
            var r = duel.Advance();

            bool petitFaceUp = false, equipouCocoon = false, equipouDuasVezes = false, spSummonMariposa = false;
            int equipCount = 0;
            int guard = 0;
            while (!r.ended && guard++ < 600)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string kind = t.GetProperty("type")?.GetValue(e) as string;
                    if (kind == "npc")
                    {
                        string action = t.GetProperty("action")?.GetValue(e) as string;
                        string why = t.GetProperty("why")?.GetValue(e) as string ?? "";
                        Log.Info($"  NPC: {action}  ({why})");
                        if (action == "summon" && why.Contains("Petit Moth")) petitFaceUp = true;
                        if (why.Contains("Cocoon of Evolution: equipa")) { equipouCocoon = true; equipCount++; }
                    }
                    if (kind == "move")
                    {
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        if (loc == 4 && (code == 87756343 || code == 14141448 || code == 48579379))
                            spSummonMariposa = true;
                    }
                }
                if (equipCount > 1) equipouDuasVezes = true;

                var q = r.question;
                if (q == null) break;
                r = q.kind switch
                {
                    "idle" => duel.Respond("endturn", 0),
                    // Nunca ataca, igual o `Auto()` do --test-weevil: o alvo é isolar
                    // se a IA do Wevil executa o combo sozinha, nao testar
                    // sobrevivencia sob pressao (isso seria outro teste).
                    "battle" => duel.Respond("endbattle", 0),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "chain" => duel.Respond("chain", -1),
                    "yesno" => duel.Respond("yesno", 1),
                    "selectcard" or "selecttribute" or "selectsum" or "selectunselect" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Check("o duelo nao travou", guard < 600, $"(guard={guard})");
            Check("o Petit Moth foi Invocado em ATAQUE (nao setado) pra virar alvo valido do casulo", petitFaceUp);
            Check("equipou o Cocoon of Evolution", equipouCocoon);
            Check("NAO desperdicou uma segunda copia no mesmo alvo (reseta o contador de turnos)",
                  !equipouDuasVezes, $"(equipou {equipCount}x)");
            Check("a evolucao completou: Invocacao Especial de uma mariposa (Larvae/Great/Perfect)",
                  spSummonMariposa);
        }

        /// <summary>Sobe de `AppContext.BaseDirectory` (bin/Debug/...) até achar
        /// a raiz do repositório — mesmo truque de `Program.FindProjectRoot`,
        /// duplicado aqui pra não depender de expor esse método privado.</summary>
        static string AcharRaizDoProjeto()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                if (Directory.Exists(Path.Combine(dir.FullName, "decks")) &&
                    Directory.Exists(Path.Combine(dir.FullName, "duel_academy")))
                    return dir.FullName;
                dir = dir.Parent;
            }
            throw new DirectoryNotFoundException("nao achei a raiz do projeto (procurei por decks/ + duel_academy/)");
        }

        static (List<uint> main, List<uint> extra) LerYdk(string relPath)
        {
            var main = new List<uint>();
            var extra = new List<uint>();
            var target = main;
            foreach (var raw in File.ReadAllLines(relPath))
            {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                if (line == "#main") { target = main; continue; }
                if (line == "#extra") { target = extra; continue; }
                if (line == "!side") break;
                if (line.StartsWith("#")) continue;
                if (uint.TryParse(line, out var code)) target.Add(code);
            }
            return (main, extra);
        }
    }
}

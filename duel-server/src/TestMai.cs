using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação do deck de HARPIAS da Mai Valentine — `--test-mai`.
    ///
    /// O deck (`decks/npc/mai_valentine/deck_1.ydk`) trouxe 14 cartas com efeito
    /// para a Lista 1. Como sempre, nenhum efeito foi escrito aqui: o que este
    /// arquivo prova é que o Lua que já vem no ocgcore roda de verdade para cada
    /// uma, e que o `NpcBrain` decide usá-las sozinho.
    ///
    /// As duas metades, e por que as duas precisam existir:
    ///
    ///   • **as cartas** — cada ATK conferido NO MOTOR, pelo evento `stats` (o
    ///     mesmo que acende o destaque de ATK em `duel.html`), nunca por uma
    ///     conta nossa. Uma carta pode estar na lista, ser comprável e não fazer
    ///     nada — foi o caso de De-Spell e companhia (`--test-cartas-booster`).
    ///
    ///   • **o cérebro** — `--test-weevil` já provava que as cartas rodam quando
    ///     ALGUÉM manda ativar; que o NPC decida sozinho é outra coisa, e é o
    ///     que faz a Mai ser um adversário em vez de um deck parado.
    ///
    /// O que o deck de Harpia tem de particular:
    ///
    ///   1. **Harpie Lady 1** dá +300 a todo monstro WIND — um contínuo que
    ///      alcança quem JÁ está em campo, o mesmo caso do Star Boy em
    ///      `--test-equip`.
    ///   2. **Harpie's Pet Dragon** ganha 300 por "Harpie Lady" no campo.
    ///   3. **Cyber Shield** (+500 numa "Harpie Lady") e **Gust Fan** (+400 num
    ///      WIND) são os equipamentos temáticos.
    ///   4. **Mountain** é a magia de campo: +200 para Alado/Dragão/Trovão.
    ///
    /// Harpie Lady 1/2/3 e Cyber Harpie Lady só existem aqui porque o gerador do
    /// dataset passou a distinguir ARTE ALTERNATIVA de CARTA DISTINTA: as quatro
    /// têm `alias` para "Harpie Lady" (o NOME é tratado como o dela), mas efeito
    /// e Lua próprios — e ficavam escondidas do editor de listas.
    /// </summary>
    public static class TestMai
    {
        const uint HARPIE_LADY = 76812113;      // Normal Nv4 1300/1400 (vanilla, WIND/Alado)
        const uint HARPIE_LADY_1 = 91932350;    // Effect — +300 ATK a todo WIND
        const uint PET_DRAGON = 52040216;       // Harpie's Pet Dragon — +300 por Harpie Lady
        const uint CYBER_SHIELD = 63224564;     // Equip: +500 em "Harpie Lady"
        const uint GUST_FAN = 55321970;         // Equip: WIND +400 / −200
        const uint MOUNTAIN = 50913601;         // Campo: Alado/Dragão/Trovão +200
        const uint BATTLE_OX = 5053103;         // filler inerte do outro lado

        const byte MZONE = 0x4;                 // LOCATION_MZONE

        static int _pass, _fail;
        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== Harpie Lady 1: +300 a todo WIND, inclusive quem ja' estava em campo ===\n");
            Cenario(sa, "Harpie Lady 1", HARPIE_LADY, HARPIE_LADY_1, viaSummon: true,
                    atkBase: 1300, atkEsperado: 1600, seed: 4242UL);

            Log.Info("\n=== Cyber Shield: +500 na Harpie Lady ===\n");
            Cenario(sa, "Cyber Shield", HARPIE_LADY, CYBER_SHIELD, viaSummon: false,
                    atkBase: 1300, atkEsperado: 1800, seed: 31337UL);

            Log.Info("\n=== Gust Fan: +400 num monstro WIND ===\n");
            Cenario(sa, "Gust Fan", HARPIE_LADY, GUST_FAN, viaSummon: false,
                    atkBase: 1300, atkEsperado: 1700, seed: 999UL);

            Log.Info("\n=== Mountain: +200 num Alado ===\n");
            Cenario(sa, "Mountain", HARPIE_LADY, MOUNTAIN, viaSummon: false,
                    atkBase: 1300, atkEsperado: 1500, seed: 5150UL);

            // Com o deck real, o duelo acaba antes de a mão trazer certas
            // cartas — provar que o cérebro as usa exige garanti-las na mão.
            // É o mesmo motivo do `ComCasuloGarantido` em `--test-weevil-npc`.
            Log.Info("\n=== o cerebro EQUIPA sozinho (Cyber Shield / Gust Fan) ===\n");
            CerebroUsa(sa, "equipamento", new[] { HARPIE_LADY, CYBER_SHIELD, GUST_FAN },
                       esperado: "activate", pista: "equipa");

            Log.Info("\n=== o cerebro ativa a MAGIA DE CAMPO que reforca os dele ===\n");
            CerebroUsa(sa, "Mountain", new[] { HARPIE_LADY, MOUNTAIN },
                       esperado: "activate", pista: "magia de campo");

            Log.Info("\n=== a Mountain NAO sai quando so' o outro lado ganharia ===\n");
            MountainNaoSaiSemAlvo(sa);

            Log.Info("\n=== o NpcBrain jogando o deck REAL da Mai ===\n");
            CerebroComDeckReal(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        /// <summary>
        /// Põe `alvo` em campo, mede o ATK dele, depois faz entrar `segunda` — por
        /// invocação (`viaSummon`) ou ativando da mão — e mede de novo.
        ///
        /// A ORDEM é o teste inteiro: o alvo entra PRIMEIRO. Invertido, ele já
        /// nasceria com o bônus e não se provaria que o efeito alcança quem já
        /// estava no campo — que é justamente onde a `VarrerStats` falhava antes
        /// (ver `--test-equip`).
        /// </summary>
        static void Cenario(string sa, string nome, uint alvo, uint segunda, bool viaSummon,
                            int atkBase, int atkEsperado, ulong seed)
        {
            var deck = new List<uint>();
            void Add(uint c, int n) { for (int i = 0; i < n; i++) deck.Add(c); }
            Add(alvo, 20);
            Add(segunda, 20);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), seed, 0x1000000UL, npc: false);
            var r = duel.Advance();

            int seqAlvo = -1;
            bool alvoEmCampo = false, segundaEntrou = false;
            var atks = new List<int>();          // todo `stats` do alvo, em ordem

            for (int guard = 0; guard < 250 && !r.ended; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    var tipo = t.GetProperty("type")?.GetValue(e) as string;
                    if (tipo == "move")
                    {
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        int seq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? -1);
                        if (loc == MZONE && code == alvo && !alvoEmCampo) { alvoEmCampo = true; seqAlvo = seq; }
                        if (code == segunda && loc != 0x2) segundaEntrou = true;   // saiu da mão
                    }
                    else if (tipo == "stats")
                    {
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        int seq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? -1);
                        int evAtk = Convert.ToInt32(t.GetProperty("atk")?.GetValue(e) ?? -1);
                        if (loc == MZONE && seq == seqAlvo && alvoEmCampo) atks.Add(evAtk);
                    }
                }

                if (alvoEmCampo && segundaEntrou && atks.Count > 0 &&
                    atks[atks.Count - 1] == atkEsperado) break;

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle")
                {
                    if (!alvoEmCampo)
                    {
                        // `Act` e' struct: `FirstOrDefault` devolveria um Act zerado
                        // (code 0) em vez de null, e o teste mandaria invocar o
                        // indice 0 — outra carta qualquer. FindIndex diz -1.
                        int i = q.summonable.FindIndex(x => x.code == alvo);
                        if (i >= 0) { r = duel.Respond("summon", q.summonable[i].index); continue; }
                    }
                    else if (!segundaEntrou)
                    {
                        if (viaSummon)
                        {
                            int i = q.summonable.FindIndex(x => x.code == segunda);
                            if (i >= 0) { r = duel.Respond("summon", q.summonable[i].index); continue; }
                        }
                        else
                        {
                            int i = q.activatable.FindIndex(x => x.code == segunda);
                            if (i >= 0) { r = duel.Respond("activate", q.activatable[i].index); continue; }
                        }
                    }
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                r = Padrao(duel, q);
            }

            int primeiro = atks.Count > 0 ? atks[0] : -1;
            int ultimo = atks.Count > 0 ? atks[atks.Count - 1] : -1;
            Log.Info($"  ATK do alvo ao longo do duelo: [{string.Join(", ", atks)}]");

            Check($"{nome}: o alvo entrou em campo", alvoEmCampo);
            Check($"{nome}: a carta chegou a sair da mao", segundaEntrou);
            Check($"{nome}: o motor emitiu stats do alvo", atks.Count > 0);
            if (atks.Count > 0)
            {
                Check($"{nome}: o alvo comeca com {atkBase} de ATK", primeiro == atkBase, $"(veio {primeiro})");
                Check($"{nome}: o ATK final e' {atkEsperado}", ultimo == atkEsperado, $"(veio {ultimo})");
            }
        }

        /// <summary>
        /// O CÉREBRO com o deck real. `--test-weevil` prova que as cartas rodam
        /// quando alguém manda ativar; isto prova que a Mai decide sozinha.
        /// </summary>
        static void CerebroComDeckReal(string sa)
        {
            var ydk = Path.Combine(AcharRaizDoProjeto(), "decks", "npc", "mai_valentine", "deck_1.ydk");
            var (main, extra) = LerYdk(ydk);
            Log.Info($"deck da Mai: {main.Count} no main, {extra.Count} no extra");
            Check("o deck da Mai tem 40 cartas no main", main.Count == 40, $"(tem {main.Count})");

            var filler = Enumerable.Repeat(BATTLE_OX, 40).ToArray();
            using var duel = new InteractiveDuel(sa, filler, 909090UL, 0x1000000UL,
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
                    _ => Padrao(duel, q),
                };
            }

            Log.Info($"  acoes distintas do NPC: [{string.Join(", ", acoes.Distinct())}]");
            Check("o duelo nao travou", !travou);
            Check("a Mai poe monstro em campo", acoes.Contains("summon") || acoes.Contains("spsummon"),
                  $"(acoes: {string.Join(",", acoes.Distinct())})");
            Check("a Mai usa carta de efeito sozinha",
                  acoes.Contains("activate") || acoes.Contains("spsummon"),
                  $"(acoes: {string.Join(",", acoes.Distinct())})");
        }

        /// <summary>
        /// Roda o NPC com um deck ENXUTO (só as cartas que interessam, embaralhadas
        /// em cópias) e conta o que ele fez. Sem isto o duelo com o deck real acaba
        /// antes de a mão trazer a carta, e "não ativou" não distingue "o cérebro
        /// não sabe" de "a carta nem apareceu".
        /// </summary>
        static void CerebroUsa(string sa, string nome, uint[] cartas, string esperado, string pista)
        {
            var deck = new List<uint>();
            foreach (var c in cartas)
                for (int i = 0; i < 40 / cartas.Length + 1; i++) deck.Add(c);

            var filler = Enumerable.Repeat(BATTLE_OX, 40).ToArray();
            using var duel = new InteractiveDuel(sa, filler, 20260818UL, 0x1000000UL,
                npc: true, npcDeck: deck.ToArray(), extra: null, npcExtra: null);
            var r = duel.Advance();

            var acoes = new List<string>();
            var porques = new List<string>();
            int guard = 0;

            while (!r.ended && guard++ < 300)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "npc") continue;
                    string action = t.GetProperty("action")?.GetValue(e) as string;
                    string why = t.GetProperty("why")?.GetValue(e) as string ?? "";
                    acoes.Add(action);
                    porques.Add(why);
                    Log.Info($"  NPC: {action}  ({why})");
                }
                var q = r.question;
                if (q == null) break;
                r = q.kind switch
                {
                    "idle" => q.canBattle ? duel.Respond("battle", 0) : duel.Respond("endturn", 0),
                    _ => Padrao(duel, q),
                };
            }

            bool fez = acoes.Contains(esperado) && porques.Any(p => p.Contains(pista));
            Check($"o cerebro usa {nome} sozinho", fez,
                  $"(acoes: {string.Join(",", acoes.Distinct())})");
        }

        /// <summary>
        /// O par CONTROLE da magia de campo: sem monstro da raça certa do MEU
        /// lado, a Mountain não pode sair — ativá-la daria +200 só ao adversário.
        /// Sem este caso, "ativou a Mountain" não provaria decisão nenhuma.
        /// </summary>
        static void MountainNaoSaiSemAlvo(string sa)
        {
            // O NPC só tem Mountain e um monstro que ela NÃO reforça (Battle Ox
            // é Beast-Warrior; a Mountain pega Dragão/Alado/Trovão).
            var deck = new List<uint>();
            for (int i = 0; i < 20; i++) { deck.Add(MOUNTAIN); deck.Add(BATTLE_OX); }

            var filler = Enumerable.Repeat(BATTLE_OX, 40).ToArray();
            using var duel = new InteractiveDuel(sa, filler, 4711UL, 0x1000000UL,
                npc: true, npcDeck: deck.ToArray(), extra: null, npcExtra: null);
            var r = duel.Advance();

            bool ativouCampo = false;
            var acoes = new List<string>();
            int guard = 0;
            while (!r.ended && guard++ < 200)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    if ((t.GetProperty("type")?.GetValue(e) as string) != "npc") continue;
                    acoes.Add(t.GetProperty("action")?.GetValue(e) as string);
                    string why = t.GetProperty("why")?.GetValue(e) as string ?? "";
                    if (why.Contains("magia de campo")) ativouCampo = true;
                }
                var q = r.question;
                if (q == null) break;
                r = q.kind switch
                {
                    "idle" => q.canBattle ? duel.Respond("battle", 0) : duel.Respond("endturn", 0),
                    _ => Padrao(duel, q),
                };
            }

            // Sem esta primeira checagem o caso passaria à toa: um NPC que não
            // jogou nada também "não ativou a Mountain". Metade do deck é
            // Mountain, então ele a teve na mão — recusar foi decisão, e o log
            // do cérebro diz o motivo ("ativaria so' para o outro lado").
            Check("o NPC jogou de verdade neste cenario", acoes.Count > 0,
                  "(nenhuma acao — o caso de controle nao provaria nada)");
            Check("a Mountain NAO e' ativada sem monstro meu da raca que ela reforca",
                  !ativouCampo);
        }

        // ------------------------------------------------------------------ apoio

        static InteractiveDuel.Result Padrao(InteractiveDuel duel, InteractiveDuel.Question q) => q.kind switch
        {
            "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
            "position" => duel.Respond("position", 0x1),
            "chain" => duel.Respond("chain", -1),
            "yesno" => duel.Respond("yesno", 1),
            "battle" => q.attackers.Count > 0 ? duel.Respond("attack", q.attackers[0].index)
                      : duel.Respond("endbattle", 0),
            "selectcard" or "selecttribute" or "selectsum" or "selectunselect" =>
                duel.Respond("select", 0, q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
            _ => duel.Respond("endturn", 0),
        };

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
            throw new DirectoryNotFoundException("nao achei a raiz do projeto");
        }

        static (List<uint> main, List<uint> extra) LerYdk(string path)
        {
            var main = new List<uint>();
            var extra = new List<uint>();
            var target = main;
            foreach (var raw in File.ReadAllLines(path))
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

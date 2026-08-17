using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste das cartas de COMPRA — `--test-compra`.
    ///
    /// O NPC conhecia UMA carta de compra: o Pote da Ganância, pelo id. Toda
    /// outra — Graceful Charity, Dark World Dealings, Trade-In, Jar of Greed —
    /// ficava parada na mão o duelo inteiro, e cada carta nova exigiria uma
    /// linha nova no cérebro.
    ///
    /// Agora quem responde "esta carta compra?" é o PRÓPRIO jogo: a `category`
    /// do `cards.cdb` mais o Lua da carta (`DatabaseManager.Perfil`). Este teste
    /// existe para provar as duas metades disso:
    ///
    ///   1. **a leitura** — o perfil bate com o que cada carta realmente faz,
    ///      inclusive nas que separam compra limpa de compra COM CUSTO (a
    ///      categoria não registra o descarte: Graceful Charity é `0x100` e nada
    ///      mais, embora mande descartar 2);
    ///   2. **a decisão** — compra limpa vem antes de tudo; compra com descarte
    ///      só sai quando vale, e o "quando vale" inclui o caso que o descarte
    ///      TRANSFORMA em ganho: um corpo grande preso na mão mais uma carta que
    ///      o traz de volta do cemitério.
    ///
    /// A metade de baixo é um duelo de verdade, porque a leitura do Lua depende
    /// de achar o arquivo no disco: com o caminho errado o perfil vem vazio, NADA
    /// é reconhecido como compra e nenhuma regra acusa — o sintoma seria só "ele
    /// nunca mais usou o Pote".
    /// </summary>
    public static class TestCompra
    {
        // --- compra limpa ---
        const uint POT_OF_GREED = 55144522;      // compra 2, sem custo
        const uint JAR_OF_GREED = 83968380;      // armadilha: compra 1
        const uint UPSTART_GOBLIN = 70368879;    // compra 1, dá 1000 LP ao oponente
        // --- compra COM descarte ---
        const uint GRACEFUL_CHARITY = 79571449;  // compra 3, descarta 2
        const uint DARK_WORLD_DEALINGS = 74117290; // cada um compra 1 e descarta 1
        // --- reanimação (o que faz o descarte valer a pena) ---
        const uint MONSTER_REBORN = 83764718;
        const uint PREMATURE_BURIAL = 70828912;
        const uint ANCIENT_RULES = 10667321;     // Invoca Especialmente, mas da MÃO
        // --- o resto ---
        const uint RAIGEKI = 12580477;
        // Busca especifica: vem ANTES da compra. E' o Reinforcement, e nao o
        // Summoner's Art — este ultimo tem regra propria (5.36) com condicao de
        // alvo, e por isso mora depois; o conjunto BUSCA_ESPECIFICA e' o das
        // buscas incondicionais.
        const uint REINFORCEMENT = 32807846;
        const uint GARNECIA = 49888191;          // 2400/2000 Nv7 — o "preso na mao"
        const uint BATTLE_OX = 5053103;          // 1700/1000 Nv4 — invocavel na hora
        const uint LA_JINN = 97590747;           // 1800/1000 Nv4
        const uint MYSTICAL_ELF = 15025844;      // 800/2000 Nv4

        static int _pass, _fail;

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== teste: o perfil que o jogo declara ===\n");
            Leitura(sa);
            Log.Info("\n=== teste: quando ativar uma carta de compra ===\n");
            Decisoes(sa);
            Log.Info("\n=== teste: o NPC comprando num duelo de verdade ===\n");
            DueloReal(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------
        // 1. A leitura: o perfil sai do banco e do Lua, sem lista de IDs.
        // ------------------------------------------------------------------
        static void Leitura(string sa)
        {
            using var db = new DatabaseManager(sa);

            void Perfil(string nome, uint code, bool compra, bool descarta, bool reanima)
            {
                var p = db.Perfil(code);
                Check($"{nome}: compra={compra} descarta={descarta} reanima={reanima}",
                      p.Compra == compra && p.Descarta == descarta && p.ReanimaDoCemiterio == reanima,
                      $"(veio compra={p.Compra} descarta={p.Descarta} reanima={p.ReanimaDoCemiterio})");
            }

            Perfil("Pote da Ganancia", POT_OF_GREED, compra: true, descarta: false, reanima: false);
            Perfil("Jar of Greed (armadilha)", JAR_OF_GREED, compra: true, descarta: false, reanima: false);
            Perfil("Upstart Goblin", UPSTART_GOBLIN, compra: true, descarta: false, reanima: false);
            // A categoria destas duas e' `0x100` e NADA MAIS — o descarte quem
            // conta e' o Lua. Sem ler o script, as duas passariam por compra
            // limpa e o NPC jogaria fora a mao achando que era de graca.
            Perfil("Graceful Charity", GRACEFUL_CHARITY, compra: true, descarta: true, reanima: false);
            Perfil("Dark World Dealings", DARK_WORLD_DEALINGS, compra: true, descarta: true, reanima: false);
            // Reanimacao: Reborn e Premature trazem do cemiterio; Ancient Rules
            // tambem Invoca Especialmente, mas da MAO — e a categoria dos tres e'
            // a mesma (`0x100000`), entao so' o Lua separa.
            Perfil("Monster Reborn", MONSTER_REBORN, compra: false, descarta: false, reanima: true);
            Perfil("Premature Burial", PREMATURE_BURIAL, compra: false, descarta: false, reanima: true);
            Perfil("Ancient Rules", ANCIENT_RULES, compra: false, descarta: false, reanima: false);
            Perfil("Raigeki", RAIGEKI, compra: false, descarta: false, reanima: false);
        }

        // ------------------------------------------------------------------
        // 2. A decisão.
        // ------------------------------------------------------------------
        static void Decisoes(string sa)
        {
            using var db = new DatabaseManager(sa);
            var meuCampo = new List<uint>();
            var minhaMao = new List<uint>();

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : new List<uint>(),
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>());

            InteractiveDuel.Question Idle(uint[] ativaveis = null, uint[] invocaveis = null)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in ativaveis ?? Array.Empty<uint>())
                    q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++, location = 0x2 });
                i = 0;
                foreach (var c in invocaveis ?? Array.Empty<uint>())
                    q.summonable.Add(new InteractiveDuel.Act { code = c, index = i++, location = 0x2 });
                return q;
            }

            // ---- compra limpa vem antes de tudo ----
            meuCampo.Clear(); minhaMao.Clear();
            var p = brain.Decide(Idle(new[] { POT_OF_GREED }, new[] { BATTLE_OX }), 1);
            Check("Pote da Ganancia antes da invocacao",
                  p.Action == "activate" && p.Index == 0, $"(veio {p.Action} idx {p.Index} — {p.Why})");

            // ...e o que prova que NAO e' lista de ID: uma carta de compra que o
            // cerebro nunca ouviu falar recebe o mesmo tratamento.
            p = brain.Decide(Idle(new[] { UPSTART_GOBLIN }, new[] { BATTLE_OX }), 1);
            Check("Upstart Goblin (nunca citado no codigo) tambem e' usado",
                  p.Action == "activate" && p.Index == 0, $"(veio {p.Action} idx {p.Index} — {p.Why})");

            p = brain.Decide(Idle(new[] { JAR_OF_GREED }, new[] { BATTLE_OX }), 1);
            Check("Jar of Greed: a regra vale para ARMADILHA tambem",
                  p.Action == "activate" && p.Index == 0, $"(veio {p.Action} idx {p.Index} — {p.Why})");

            // ...mas a busca especifica continua na frente: comprar as cegas pode
            // trazer justamente o que a busca traria, e ai a busca vira carta morta.
            p = brain.Decide(Idle(new[] { POT_OF_GREED, REINFORCEMENT }), 1);
            Check("busca especifica ainda vem antes da compra",
                  p.Action == "activate" && p.Index == 1, $"(veio {p.Action} idx {p.Index} — {p.Why})");

            // ---- compra COM descarte ----
            // Com jogada em campo e sem sinergia nenhuma, o descarte e' perda seca.
            meuCampo.Clear(); meuCampo.Add(BATTLE_OX);
            minhaMao.Clear(); minhaMao.Add(LA_JINN); minhaMao.Add(MYSTICAL_ELF);
            p = brain.Decide(Idle(new[] { GRACEFUL_CHARITY }, new[] { LA_JINN }), 1);
            Check("Graceful Charity com jogada em campo e sem reanimacao: guarda",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            // Sem NADA para fazer, comprar e' o unico caminho — a mao que eu
            // guardo parado nao vale nada.
            meuCampo.Clear();
            minhaMao.Clear(); minhaMao.Add(GARNECIA);   // Nv7: nao da' para invocar
            p = brain.Decide(Idle(new[] { GRACEFUL_CHARITY }), 1);
            Check("Graceful Charity sem monstro em campo nem invocacao possivel: ativa",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            // O caso que o descarte TRANSFORMA em ganho: corpo grande preso na
            // mao + uma carta que o traz de volta do cemiterio.
            meuCampo.Clear(); meuCampo.Add(BATTLE_OX);
            minhaMao.Clear(); minhaMao.Add(GARNECIA); minhaMao.Add(MONSTER_REBORN);
            p = brain.Decide(Idle(new[] { GRACEFUL_CHARITY }, new[] { LA_JINN }), 1);
            Check("Graceful Charity com Nv7 na mao + Monster Reborn: ativa (encher o cemiterio e' o plano)",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            // ...e o mesmo campo SEM o reanimador tem de guardar — senao a
            // checagem acima nao provaria nada.
            minhaMao.Clear(); minhaMao.Add(GARNECIA);
            p = brain.Decide(Idle(new[] { GRACEFUL_CHARITY }, new[] { LA_JINN }), 1);
            Check("...o MESMO campo sem reanimacao: guarda (controle)",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            // O Ancient Rules tambem Invoca Especialmente, mas da MAO: nao serve
            // de desculpa para descartar o corpo grande.
            minhaMao.Clear(); minhaMao.Add(GARNECIA); minhaMao.Add(ANCIENT_RULES);
            p = brain.Decide(Idle(new[] { GRACEFUL_CHARITY }, new[] { LA_JINN }), 1);
            Check("Ancient Rules na mao nao conta como reanimacao (ele invoca da MAO)",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            // A armadilha BAIXADA tambem conta: o Premature Burial que ja' esta'
            // no campo traz o descartado de volta igual.
            minhaMao.Clear(); minhaMao.Add(GARNECIA); minhaMao.Add(PREMATURE_BURIAL);
            p = brain.Decide(Idle(new[] { DARK_WORLD_DEALINGS }, new[] { LA_JINN }), 1);
            Check("Dark World Dealings (compra 1 / descarta 1) segue a mesma regra",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            // Entre as duas, a limpa primeiro: ela nao cobra nada.
            meuCampo.Clear(); minhaMao.Clear();
            p = brain.Decide(Idle(new[] { GRACEFUL_CHARITY, POT_OF_GREED }), 1);
            Check("com as duas na mao, a compra LIMPA sai antes da que cobra descarte",
                  p.Action == "activate" && p.Index == 1, $"(veio {p.Action} idx {p.Index} — {p.Why})");
        }

        // ------------------------------------------------------------------
        // 3. O duelo de verdade — prova que o Lua e' achado no disco.
        // ------------------------------------------------------------------
        static readonly uint[] MAIN = {
            POT_OF_GREED, POT_OF_GREED, POT_OF_GREED,
            GRACEFUL_CHARITY, GRACEFUL_CHARITY, GRACEFUL_CHARITY,
            UPSTART_GOBLIN, UPSTART_GOBLIN, UPSTART_GOBLIN,
            MONSTER_REBORN,
            GARNECIA, GARNECIA, GARNECIA,
            BATTLE_OX, BATTLE_OX, BATTLE_OX,
            LA_JINN, LA_JINN, LA_JINN,
            MYSTICAL_ELF, MYSTICAL_ELF, MYSTICAL_ELF,
            5053103, 15025844, 97590747, 5053103, 15025844, 97590747,
            5053103, 15025844, 97590747, 5053103, 15025844, 97590747,
            5053103, 15025844, 97590747, 5053103, 15025844, 97590747,
        };

        static void DueloReal(string sa)
        {
            var compras = new HashSet<uint>();

            foreach (ulong seed in new ulong[] { 7, 31337, 2024, 999 })
            {
                using var duel = new InteractiveDuel(sa, MAIN, seed, 0x1000000UL, npc: true,
                                                    npcDeck: MAIN);
                var r = duel.Advance();

                for (int guard = 0; guard < 200 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        string tipo = t.GetProperty("type")?.GetValue(e) as string;
                        if (tipo != "chaining") continue;
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        int ctrl = Convert.ToInt32(t.GetProperty("controller")?.GetValue(e) ?? 0);
                        if (ctrl == 1 && (code == POT_OF_GREED || code == UPSTART_GOBLIN
                                          || code == GRACEFUL_CHARITY)) compras.Add(code);
                    }

                    var q = r.question;
                    if (q == null) break;
                    r = q.kind switch
                    {
                        "idle" => duel.Respond("endturn", 0),
                        "battle" => duel.Respond("endbattle", 0),
                        "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                        "position" => duel.Respond("position", 0x1),
                        "chain" => duel.Respond("chain", -1),
                        "selectcard" or "selecttribute" => duel.Respond("select", 0,
                            q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                        _ => duel.Respond("endturn", 0),
                    };
                }
            }

            Check("o NPC comprou de verdade em duelo", compras.Count > 0,
                  "(nenhuma carta de compra foi ativada em 4 duelos — o Lua nao foi achado no disco?)");
            Log.Info($"  ..    cartas de compra usadas: {string.Join(", ", compras)}");
            Check("usou pelo menos uma carta de compra que o codigo NUNCA cita por ID",
                  compras.Contains(UPSTART_GOBLIN) || compras.Contains(GRACEFUL_CHARITY),
                  "(so' o Pote da Ganancia saiu — a generalizacao pode nao estar valendo)");
        }
    }
}

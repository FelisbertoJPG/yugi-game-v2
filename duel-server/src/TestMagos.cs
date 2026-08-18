using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste do deck **Poder dos Magos** — `--test-magos`.
    ///
    /// O deck do Yugi é o primeiro que não cabe em regra por ID: são dezoito
    /// cartas diferentes, quase todas com efeito, e escrever uma linha para cada
    /// uma repetiria o trabalho a cada deck novo. A cobertura aqui é por CLASSE
    /// DE EFEITO — quem responde "o que esta carta faz?" é o próprio jogo, pela
    /// `category` do `cards.cdb` cruzada com o Lua da carta
    /// (`DatabaseManager.Perfil`).
    ///
    /// Este arquivo prova as duas metades:
    ///
    ///   1. **a leitura** — o perfil de cada carta do deck bate com o que ela
    ///      realmente faz. É a parte que envelhece sozinha: um bit de categoria
    ///      lido errado não dá erro, só faz o NPC ignorar a carta para sempre;
    ///   2. **a decisão** — cada classe dispara na hora certa, e as travas
    ///      seguram quando não vale.
    ///
    /// A ESTRATÉGIA do deck é o Dark Magician em campo: com ele lá, o Thousand
    /// Knives e o Dark Magic Attack ficam ativáveis (quem confere a condição é o
    /// motor) e o Eye of Timaeus vira uma fusão de graça. Por isso a busca vem
    /// antes da compra e a Invocação Especial antes da batalha.
    /// </summary>
    public static class TestMagos
    {
        // monstros
        const uint DARK_MAGICIAN = 46986414;       // 2500/2100 Nv7 — Normal, o eixo do deck
        const uint DARK_MAGICIAN_GIRL = 38033121;  // 2000/1700 Nv6
        const uint MAGICIAN_DARK_ILLUSION = 35191415;
        const uint MAGICIANS_ROD = 7084129;        // busca magia/armadilha ao ser invocado
        const uint DM_OF_CHAOS = 40737112;
        // magias
        const uint POLYMERIZATION = 24094653;
        const uint DARK_MAGIC_ATTACK = 2314238;    // destroi TODAS as magias/armadilhas dele
        const uint THOUSAND_KNIVES = 63391643;     // destroi 1 monstro dele
        const uint POT_OF_GREED = 55144522;
        const uint SUMMONERS_ART = 79816536;
        const uint GRACEFUL_CHARITY = 79571449;
        const uint DARK_MAGIC_VEIL = 82404868;     // paga 1000 LP, invoca da mao/cemiterio
        const uint EYE_OF_TIMAEUS = 1784686;       // funde um Dark Magician DO CAMPO
        // armadilhas
        const uint ETERNAL_SOUL = 48680970;
        const uint MAGICIAN_NAVIGATION = 7922915;
        const uint JAR_OF_GREED = 83968380;
        const uint MAGICIANS_CIRCLE = 50755;
        const uint ESCAPE_DARK_DIMENSION = 31550470;
        // extra
        const uint THE_DARK_MAGICIANS = 50237654;
        const uint DM_DRAGON_KNIGHT = 41721210;
        // de fora do deck, para os controles
        const uint BATTLE_OX = 5053103;
        const uint LA_JINN = 97590747;

        static int _pass, _fail;

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== teste: o que o jogo declara de cada carta do deck ===\n");
            Leitura(sa);
            Log.Info("\n=== teste: cada classe de efeito na hora certa ===\n");
            Decisoes(sa);
            Log.Info("\n=== teste: o NPC jogando o Poder dos Magos ===\n");
            DueloReal(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------
        // 1. A leitura: o perfil sai do banco + do Lua, sem lista de ID.
        // ------------------------------------------------------------------
        static void Leitura(string sa)
        {
            using var db = new DatabaseManager(sa);

            void Classe(string nome, uint code, string esperado)
            {
                var p = db.Perfil(code);
                var tem = new List<string>();
                if (p.Compra) tem.Add("compra");
                if (p.Descarta) tem.Add("descarta");
                if (p.Busca) tem.Add("busca");
                if (p.DestroiMonstro) tem.Add("destroi-monstro");
                if (p.DestroiSt) tem.Add("destroi-st");
                if (p.InvocaEspecial) tem.Add("invoca");
                if (p.Fusao) tem.Add("fusao");
                if (p.ReanimaDoCemiterio) tem.Add("reanima");
                if (p.PagaLp) tem.Add("paga-lp");
                string veio = string.Join("+", tem.OrderBy(x => x));
                string quer = string.Join("+", esperado.Split('+').OrderBy(x => x));
                Check($"{nome}: {(quer.Length > 0 ? quer : "sem efeito")}", veio == quer,
                      $"(veio {(veio.Length > 0 ? veio : "nada")})");
            }

            Classe("Thousand Knives", THOUSAND_KNIVES, "destroi-monstro");
            Classe("Dark Magic Attack", DARK_MAGIC_ATTACK, "destroi-st");
            Classe("Summoner's Art", SUMMONERS_ART, "busca");
            Classe("Magician's Rod", MAGICIANS_ROD, "busca");
            Classe("Dark Magic Veil", DARK_MAGIC_VEIL, "invoca+reanima+paga-lp");
            Classe("Magician's Circle", MAGICIANS_CIRCLE, "invoca");
            // A categoria acusa destruicao porque a carta destroi o monstro que ela
            // trouxe quando sai do campo — o MEU, nao o dele. E' por isso que a
            // regra de remocao ignora quem tambem invoca.
            Classe("Escape from the Dark Dimension", ESCAPE_DARK_DIMENSION, "destroi-monstro+invoca");
            Classe("The Eye of Timaeus", EYE_OF_TIMAEUS, "fusao+invoca");
            // O script da Poly delega TUDO a `Fusion.RegisterSummonEff` e nao contem
            // marcador nenhum — a fusao dela so' e' vista pela categoria.
            Classe("Polymerization", POLYMERIZATION, "fusao");
            Classe("Pot of Greed", POT_OF_GREED, "compra");
            Classe("Graceful Charity", GRACEFUL_CHARITY, "compra+descarta");
            Classe("Jar of Greed", JAR_OF_GREED, "compra");
            // O eixo do deck e' um monstro NORMAL: sem efeito nenhum, e e' por
            // isso que o Summoner's Art (que busca Normal Nv5+) o alcanca.
            Classe("Dark Magician", DARK_MAGICIAN, "");
            Check("Dark Magician e' Normal Nv7 de 2500",
                  db.Stats(DARK_MAGICIAN).Level == 7 && db.Stats(DARK_MAGICIAN).AtkValue == 2500);
        }

        // ------------------------------------------------------------------
        // 2. A decisão.
        // ------------------------------------------------------------------
        static void Decisoes(string sa)
        {
            using var db = new DatabaseManager(sa);
            var meuCampo = new List<uint>();
            var seuCampo = new List<uint>();
            var minhaMao = new List<uint>();
            int seusSt = 0, meuLp = 8000;

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : seuCampo,
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                stCountOf: p => p == 0 ? seusSt : 0,
                lpOf: _ => meuLp);

            InteractiveDuel.Question Idle(params uint[] ativaveis)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in ativaveis)
                    q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++, location = 0x2 });
                return q;
            }

            void Zerar()
            {
                meuCampo.Clear(); seuCampo.Clear(); minhaMao.Clear(); seusSt = 0; meuLp = 8000;
            }

            // ---- destruicao de monstro: so' com alvo ----
            Zerar(); meuCampo.Add(DARK_MAGICIAN); seuCampo.Add(BATTLE_OX);
            var p = brain.Decide(Idle(THOUSAND_KNIVES), 1);
            Check("Thousand Knives com monstro do outro lado: ativa",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            seuCampo.Clear();
            p = brain.Decide(Idle(THOUSAND_KNIVES), 1);
            Check("Thousand Knives com o campo dele vazio: guarda",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            // ---- destruicao de magia/armadilha: so' se ele tiver S/T ----
            Zerar(); meuCampo.Add(DARK_MAGICIAN); seusSt = 2;
            p = brain.Decide(Idle(DARK_MAGIC_ATTACK), 1);
            Check("Dark Magic Attack com S/T do outro lado: ativa",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            seusSt = 0;
            p = brain.Decide(Idle(DARK_MAGIC_ATTACK), 1);
            Check("Dark Magic Attack sem S/T do outro lado: guarda",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            // ---- busca vem antes da compra ----
            Zerar();
            p = brain.Decide(Idle(POT_OF_GREED, MAGICIANS_ROD), 1);
            Check("busca (Magician's Rod) vem antes da compra (Pote)",
                  p.Action == "activate" && p.Index == 1, $"(veio idx {p.Index} — {p.Why})");

            // ---- invocacao especial: so' quando preciso de corpo ----
            Zerar();   // campo vazio dos dois lados
            p = brain.Decide(Idle(DARK_MAGIC_VEIL), 1);
            Check("Dark Magic Veil com o campo vazio: ativa (preciso de corpo)",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            Zerar(); meuCampo.Add(DARK_MAGICIAN); seuCampo.Add(LA_JINN);  // 2500 x 1800
            p = brain.Decide(Idle(DARK_MAGIC_VEIL), 1);
            Check("...com o campo ja' resolvido: guarda a carta",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            Zerar(); meuCampo.Add(LA_JINN); seuCampo.Add(DARK_MAGICIAN);  // 1800 x 2500
            p = brain.Decide(Idle(DARK_MAGIC_VEIL), 1);
            Check("...mas perdendo para a ameaca do outro lado: ativa",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            // ---- o custo em LP e' respeitado ----
            Zerar(); meuLp = 1500;   // 1000 de custo deixaria 500, abaixo do piso
            p = brain.Decide(Idle(DARK_MAGIC_VEIL), 1);
            Check("Dark Magic Veil com 1500 LP: guarda (o custo fura o piso de vida)",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            // ---- fusao: reconhecida pela classe, sem Polymerization ----
            Zerar(); meuCampo.Add(DARK_MAGICIAN);
            p = brain.Decide(Idle(EYE_OF_TIMAEUS), 1);
            Check("The Eye of Timaeus (funde do campo, sem Poly) e' reconhecido como fusao",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            // ---- a ordem entre as classes ----
            Zerar(); seuCampo.Add(BATTLE_OX); meuCampo.Add(DARK_MAGICIAN);
            p = brain.Decide(Idle(THOUSAND_KNIVES, MAGICIANS_ROD), 1);
            Check("com busca e remocao na mao, a BUSCA sai primeiro (nao gasta nada)",
                  p.Action == "activate" && p.Index == 1, $"(veio idx {p.Index} — {p.Why})");
        }

        // ------------------------------------------------------------------
        // 3. O deck de verdade.
        // ------------------------------------------------------------------
        static readonly uint[] MAIN = {
            DARK_MAGICIAN, DARK_MAGICIAN_GIRL,
            MAGICIAN_DARK_ILLUSION, MAGICIAN_DARK_ILLUSION, MAGICIAN_DARK_ILLUSION,
            POLYMERIZATION, DARK_MAGIC_ATTACK, DARK_MAGIC_ATTACK,
            THOUSAND_KNIVES, THOUSAND_KNIVES, THOUSAND_KNIVES,
            POT_OF_GREED, POT_OF_GREED,
            SUMMONERS_ART, SUMMONERS_ART, SUMMONERS_ART,
            GRACEFUL_CHARITY, GRACEFUL_CHARITY,
            ETERNAL_SOUL, ETERNAL_SOUL, ETERNAL_SOUL,
            MAGICIAN_NAVIGATION, MAGICIAN_NAVIGATION, MAGICIAN_NAVIGATION,
            DM_OF_CHAOS,
            MAGICIANS_CIRCLE, MAGICIANS_CIRCLE, MAGICIANS_CIRCLE,
            MAGICIANS_ROD, MAGICIANS_ROD, MAGICIANS_ROD,
            JAR_OF_GREED, JAR_OF_GREED, JAR_OF_GREED,
            DARK_MAGIC_VEIL, DARK_MAGIC_VEIL, DARK_MAGIC_VEIL,
            EYE_OF_TIMAEUS, EYE_OF_TIMAEUS, ESCAPE_DARK_DIMENSION,
        };
        static readonly uint[] EXTRA = { THE_DARK_MAGICIANS, DM_DRAGON_KNIGHT, 66889139, 5829717, 43892408 };

        static void DueloReal(string sa)
        {
            var classes = new HashSet<string>();
            int maiorAtk = 0;

            foreach (ulong seed in new ulong[] { 7, 31337, 2024, 999, 555 })
            {
                using var db = new DatabaseManager(sa);
                using var duel = new InteractiveDuel(sa, MAIN, seed, 0x1000000UL, npc: true,
                                                    npcDeck: MAIN, extra: EXTRA, npcExtra: EXTRA);
                var r = duel.Advance();

                for (int guard = 0; guard < 220 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        string tipo = t.GetProperty("type")?.GetValue(e) as string;
                        if (tipo == "chaining")
                        {
                            uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                            int ctrl = Convert.ToInt32(t.GetProperty("controller")?.GetValue(e) ?? 0);
                            if (ctrl != 1) continue;
                            // Anota a CLASSE, nao a carta: o que se quer provar e'
                            // que cada tipo de efeito e' usado, e nao que uma carta
                            // especifica saiu na mao.
                            var perfil = db.Perfil(code);
                            if (perfil.Busca) classes.Add("busca");
                            if (perfil.Compra) classes.Add("compra");
                            if (perfil.DestroiMonstro || perfil.DestroiSt) classes.Add("destruicao");
                            if (perfil.Fusao) classes.Add("fusao");
                            else if (perfil.InvocaEspecial) classes.Add("invocacao especial");
                        }
                        if (tipo == "stats")
                        {
                            int ctrl = Convert.ToInt32(t.GetProperty("controller")?.GetValue(e) ?? 0);
                            int atk = Convert.ToInt32(t.GetProperty("atk")?.GetValue(e) ?? 0);
                            if (ctrl == 1) maiorAtk = Math.Max(maiorAtk, atk);
                        }
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

            Log.Info($"  ..    classes usadas: {string.Join(", ", classes.OrderBy(x => x))}");
            Check("o NPC usou pelo menos DUAS classes de efeito diferentes", classes.Count >= 2,
                  "(o deck inteiro passou em branco)");
            Check("a busca disparou (e' o comeco do plano do deck)", classes.Contains("busca"));
            Check("um corpo grande (>= 2000 de ATK) chegou ao campo do NPC",
                  maiorAtk >= 2000, $"(o maior foi {maiorAtk})");
        }
    }
}

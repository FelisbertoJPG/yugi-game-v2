using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste de aceitação do pacote "Normal grande" do deck do Pegasus —
    /// `--test-pegasus`.
    ///
    /// Duas cartas que andam JUNTAS, e é por isso que estão no mesmo arquivo:
    ///
    ///   SUMMONER'S ART  busca 1 monstro NORMAL de Nível 5+ do deck;
    ///   ANCIENT RULES   Invoca Especialmente 1 monstro NORMAL de Nível 5+ da mão.
    ///
    /// Separadas valem pouco. Juntas, tiram um 2200 do nada — e, o que importa
    /// mais, **sem gastar a Invocação Normal do turno**, deixando o tributo livre
    /// para um segundo corpo. São elas que fazem um deck de vanilla competir na
    /// Lista 1: sem uma forma de baixar um Nv7 de graça, todo Normal grande é
    /// carta morta na mão esperando dois tributos.
    ///
    /// Mesma divisão do `TestToon`: primeiro decisões ISOLADAS (montadas na mão,
    /// determinísticas — é onde as regras são realmente afirmadas), depois um
    /// duelo REAL com o NPC jogando sozinho, que prova que a decisão chega ao
    /// motor e o monstro entra em campo de verdade.
    /// </summary>
    public static class TestPegasus
    {
        const uint ANCIENT_RULES = 10667321;   // Invoca Especialmente 1 Normal Nv5+ da mão
        const uint SUMMONERS_ART = 79816536;   // busca 1 Normal Nv5+ do deck

        const uint RYU_RAN = 2964201;          // Normal Nv7 2200/2600 — o melhor alvo
        const uint PARROT_DRAGON = 62762898;   // Normal Nv5 2000/1300 — o segundo
        const uint TOON_ALLIGATOR = 59383041;  // Normal Nv4  800/1600 — NÃO serve (Nv4)
        const uint BATTLE_OX = 5053103;        // Normal Nv4 1700/1000 — filler

        const byte DECK = 0x1, MZONE = 0x4;

        static int _pass, _fail;
        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== o que as cartas exigem (banco) ===\n");
            OsNiveisQueAsCartasExigem(sa);
            Log.Info("\n=== regras do Pegasus (decisao isolada) ===\n");
            Isolado(sa);
            Log.Info("\n=== Summoner's Art + Ancient Rules num duelo de verdade ===\n");
            DueloReal(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------- o banco

        /// <summary>
        /// Preparo, e não é formalidade: as duas cartas exigem **Normal Nv5+**, e
        /// é esse nível que `EhNormalGrande` filtra. Se um dia o banco mudar o
        /// nível de uma delas, o resto do arquivo passaria a testar outra coisa
        /// em silêncio — e o NPC pararia de jogar o combo sem ninguém entender
        /// por quê.
        /// </summary>
        static void OsNiveisQueAsCartasExigem(string sa)
        {
            using var db = new DatabaseManager(sa);
            var ryu = db.Stats(RYU_RAN);
            var parrot = db.Stats(PARROT_DRAGON);
            var gator = db.Stats(TOON_ALLIGATOR);

            Check($"Ryu-Ran e' Nv{ryu.Level} com {ryu.AtkValue} ATK (alvo valido, o melhor)",
                  ryu.Level >= 5 && ryu.AtkValue == 2200);
            Check($"Parrot Dragon e' Nv{parrot.Level} com {parrot.AtkValue} ATK (alvo valido, o segundo)",
                  parrot.Level >= 5 && parrot.AtkValue == 2000);
            Check($"Toon Alligator e' Nv{gator.Level} — NAO serve, e' o controle dos casos abaixo",
                  gator.Level < 5);
        }

        // ------------------------------------------------------------- isolado

        static void Isolado(string sa)
        {
            using var db = new DatabaseManager(sa);
            var mao1 = new List<uint>();          // mão do NPC
            var campo1 = new List<uint>();        // campo do NPC
            var registro = new List<string>();    // o que o cérebro explicou pelo log
            var brain = new NpcBrain(db,
                p => p == 1 ? campo1 : new List<uint>(),
                s => registro.Add(s),
                p => p == 1 ? mao1 : new List<uint>(),
                p => 0);

            InteractiveDuel.Question Idle(params uint[] ativaveis)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                for (int i = 0; i < ativaveis.Length; i++)
                    q.activatable.Add(new InteractiveDuel.Act { code = ativaveis[i], index = i });
                return q;
            }

            InteractiveDuel.Question Busca(params uint[] cartas)
            {
                var q = new InteractiveDuel.Question
                { kind = "selectcard", player = 1, selMin = 1, selMax = 1, selCount = cartas.Length };
                for (int i = 0; i < cartas.Length; i++)
                    q.choices.Add(new InteractiveDuel.Sel
                    { code = cartas[i], index = i, location = DECK, controller = 1, release = 0 });
                return q;
            }

            // 1. Ancient Rules com um Nv5+ na mão: ativa.
            mao1.Clear(); mao1.Add(RYU_RAN);
            var p1 = brain.Decide(Idle(ANCIENT_RULES), 1);
            Check("Ancient Rules ativa quando ha um Normal Nv5+ na mao",
                  p1.Action == "activate" && p1.Why.Contains("Ancient Rules"),
                  $"(veio {p1.Action}: {p1.Why})");

            // 2. CONTROLE, e é o caso que dá valor ao de cima: só um Nv4 na mão.
            //    Sem esta conferência o NPC queimaria a carta à toa — o Lua até
            //    recusaria, mas a magia já teria ido para o cemitério de graça.
            mao1.Clear(); mao1.Add(TOON_ALLIGATOR); mao1.Add(BATTLE_OX);
            registro.Clear();
            var p2 = brain.Decide(Idle(ANCIENT_RULES), 1);
            Check("Ancient Rules NAO e' ativada sem alvo Nv5+ na mao",
                  !(p2.Action == "activate" && p2.Why.Contains("Ancient Rules")),
                  $"(veio {p2.Action}: {p2.Why})");
            Check("e o log explica a recusa em vez de deixar a carta parada sem motivo",
                  registro.Any(l => l.Contains("guarda Ancient Rules")),
                  $"(log: [{string.Join(" | ", registro)}])");

            // 3. Summoner's Art sozinha: ativa mesmo sem as Regras na mão —
            //    é carta a mais, e o corpo buscado ainda entra por tributo.
            mao1.Clear();
            var p3 = brain.Decide(Idle(SUMMONERS_ART), 1);
            Check("Summoner's Art ativa mesmo sem Ancient Rules na mao",
                  p3.Action == "activate" && p3.Why.Contains("Summoner's Art"),
                  $"(veio {p3.Action}: {p3.Why})");

            // 4. As DUAS ativáveis e as Regras na mão: a busca vem primeiro.
            //    Na ordem inversa o NPC invocaria o que já tinha e deixaria a
            //    busca para depois, perdendo o combo do mesmo turno.
            mao1.Clear(); mao1.Add(ANCIENT_RULES); mao1.Add(RYU_RAN);
            var p4 = brain.Decide(Idle(ANCIENT_RULES, SUMMONERS_ART), 1);
            Check("com as duas na mesa, Summoner's Art vem ANTES (busca o corpo e invoca no mesmo turno)",
                  p4.Action == "activate" && p4.Index == 1 && p4.Why.Contains("Regras Antigas"),
                  $"(veio {p4.Action} idx {p4.Index}: {p4.Why})");

            // 5. A ESCOLHA. Este é o caso que o duelo real não consegue afirmar
            //    (a mão nem sempre oferece dois Nv5+): entre Ryu-Ran e Parrot
            //    Dragon, leva o de maior ATK. Sem a regra, o critério genérico
            //    empata tudo que não reconhece e leva o primeiro da lista — aqui,
            //    o Parrot, toda vez.
            var s5 = brain.DecideSelect(Busca(PARROT_DRAGON, RYU_RAN), 1);
            Check("entre Parrot Dragon (2000) e Ryu-Ran (2200), busca o Ryu-Ran",
                  s5.Count == 1 && s5[0] == 1, $"(veio [{string.Join(",", s5)}])");

            // 6. E o de menor ATK primeiro na lista não muda nada — o que decide
            //    é o ATK, não a posição.
            var s6 = brain.DecideSelect(Busca(RYU_RAN, PARROT_DRAGON), 1);
            Check("a ordem da lista nao decide: com o Ryu-Ran em primeiro, ele continua sendo o escolhido",
                  s6.Count == 1 && s6[0] == 0, $"(veio [{string.Join(",", s6)}])");
        }

        // ---------------------------------------------------------- duelo real

        /// <summary>
        /// Deck saturado das duas magias mais os dois corpos — mesmo padrão de
        /// `TestToon`/`TestSynchro`: o alvo é a MECÂNICA com certeza estatística,
        /// não a consistência de um deck de 40 de verdade.
        /// </summary>
        static void DueloReal(string sa)
        {
            var deck = new List<uint>();
            void Add(uint c, int n) { for (int i = 0; i < n; i++) deck.Add(c); }
            Add(SUMMONERS_ART, 8); Add(ANCIENT_RULES, 10);
            Add(RYU_RAN, 8); Add(PARROT_DRAGON, 6);
            while (deck.Count < 40) deck.Add(BATTLE_OX);

            using var duel = new InteractiveDuel(sa, deck.ToArray(), 20260814UL, 0x1000000UL, npc: true);
            var r = duel.Advance();

            bool travou = false, ativouArt = false, ativouRules = false;
            var normaisEmCampo = new HashSet<uint>();
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
                        if (why.Contains("Summoner's Art")) ativouArt = true;
                        if (why.Contains("Ancient Rules")) ativouRules = true;
                        Log.Info($"  NPC: {act}  ({why})");
                    }

                    // O corpo chegou mesmo na zona de monstro? É o que separa "o
                    // motor aceitou a ativação" de "a carta entrou em campo".
                    if (kind == "move")
                    {
                        uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                        byte loc = Convert.ToByte(t.GetProperty("loc")?.GetValue(e) ?? (byte)0);
                        byte ctrl = Convert.ToByte(t.GetProperty("controller")?.GetValue(e) ?? (byte)0);
                        if (loc == MZONE && ctrl == 1 && (code == RYU_RAN || code == PARROT_DRAGON))
                            normaisEmCampo.Add(code);
                    }
                }

                if (ativouArt && ativouRules && normaisEmCampo.Count > 0) break;

                var q = r.question;
                if (q == null) break;

                // O jogador 0 joga o mais simples possível: o alvo do teste é o NPC.
                r = q.kind switch
                {
                    "idle" => q.canBattle ? duel.Respond("battle", 0) : duel.Respond("endturn", 0),
                    "battle" => duel.Respond("endbattle", 0),
                    "place" => duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0),
                    "position" => duel.Respond("position", 0x1),
                    "chain" => duel.Respond("chain", -1),
                    "selectcard" or "selecttribute" or "selectsum" => duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList()),
                    _ => duel.Respond("endturn", 0),
                };
            }

            Check("o duelo nao travou em laco fechado", !travou);
            Check("o NPC ativou Summoner's Art sozinho", ativouArt,
                  "(nunca ativou — a regra 5.36 nao disparou no duelo)");
            Check("o NPC ativou Ancient Rules sozinho", ativouRules,
                  "(nunca ativou — a regra 5.37 nao disparou no duelo)");
            Check($"o Normal Nv5+ chegou ao campo de verdade ([{string.Join(", ", normaisEmCampo)}])",
                  normaisEmCampo.Count > 0,
                  "(nenhum Ryu-Ran/Parrot Dragon entrou na zona de monstro do NPC)");

            // Quem chegou importa, e este caso é a guarda de regressão do parse do
            // MSG_SELECT_CARD (`release` lido como posição em `ParseSelectCards`).
            // Com o bug, a escolha do NPC caía no ramo de TRIBUTO — que sacrifica o
            // mais FRACO — e o campo recebia o Parrot Dragon (2000) enquanto o log
            // dizia 2200. Passava em tudo: só a jogada estava errada.
            Check("e quem chegou foi o Ryu-Ran (2200), nao o Parrot Dragon (2000)",
                  normaisEmCampo.Contains(RYU_RAN),
                  "(o mais fraco entrou — a selecao voltou a ser tratada como tributo)");
        }
    }
}

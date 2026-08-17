using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// Teste do pacote **Para &amp; Dox** (o Labirinto) — `--test-paradox`.
    ///
    /// O deck dos Irmãos Paradoxo é feito de corpos que o jogo normal não deixa
    /// invocar: Nv7 aos montes e o Gate Guardian de 3750, que não tem invocação
    /// normal nenhuma. Ele vive de ATALHOS — tributa um corpo qualquer e traz um
    /// grande. Sem regra para eles, o NPC ficava com a mão cheia de Nv7 e um
    /// Labyrinth Wall de 0 de ATK em campo, que foi o que motivou este arquivo.
    ///
    /// A metade de baixo é o duelo de verdade: o `NpcBrain` jogando o deck
    /// sozinho, para provar que as regras não só existem como DISPARAM com a mão
    /// que o embaralhamento dá.
    /// </summary>
    public static class TestParadox
    {
        // --- os atalhos (as regras novas) ---
        const uint TRIBUTE_DOLL = 2903036;
        const uint MONSTER_GATE = 43040603;
        const uint METAMORPHOSIS = 46411259;
        const uint MAGICAL_LABYRINTH = 64389297;
        // --- os corpos ---
        const uint GATE_GUARDIAN = 25833572;   // 3750/3400 Nv11 — só por Invocação Especial
        const uint SANGA = 25955164;           // 2600/2200 Nv7
        const uint SUIJIN = 98434877;          // 2500/2400 Nv7
        const uint KAZEJIN = 62340868;         // 2400/2200 Nv7
        const uint STONE_DRAGON = 68171737;    // 2000/2300 Nv7 (Normal)
        const uint LABYRINTH_WALL = 67284908;  //    0/3000 Nv5 (Normal)
        const uint GUARDIAN_LAB = 89272878;    // 1000/1200 Nv4 (Normal)
        const uint JIRAI_GUMO = 94773007;      // 2200/100  Nv4
        const uint LABYRINTH_TANK = 99551425;  // 2400/2400 Nv7 (fusão, só pelo Metamorphosis)
        const uint GARNECIA = 49888191;        // 2400/2000 Nv7 (Normal)
        const uint PREY_JIRAI = 33055499;      // armadilha contínua que vira monstro 2100
        const uint ANCIENT_RULES = 10667321;
        const uint SUMMONERS_ART = 79816536;

        static int _pass, _fail;

        static void Check(string what, bool ok, string detail = "")
        {
            if (ok) { Log.Info($"  OK    {what}"); _pass++; }
            else { Log.Err($"  FALHA {what} {detail}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== teste: pacote Para & Dox (decisao isolada) ===\n");
            Decisoes(sa);
            Log.Info("\n=== teste: o NPC jogando o deck do labirinto ===\n");
            DueloReal(sa);
            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------------
        // Decisão isolada: monta a pergunta na mão e confere a escolha.
        // ------------------------------------------------------------------
        static void Decisoes(string sa)
        {
            var db = new DatabaseManager(sa);
            var meuCampo = new List<uint>();   // campo do NPC (jogador 1)
            var minhaMao = new List<uint>();   // mão do NPC

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : new List<uint>(),
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>());

            InteractiveDuel.Question Idle(
                IEnumerable<uint> ativaveis = null, IEnumerable<uint> especiais = null)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in ativaveis ?? Enumerable.Empty<uint>())
                    q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                i = 0;
                foreach (var c in especiais ?? Enumerable.Empty<uint>())
                    q.spSummonable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                return q;
            }

            // ---- Gate Guardian: o pagamento já foi conferido pelo motor ----
            meuCampo.Clear(); meuCampo.Add(SANGA); meuCampo.Add(KAZEJIN); meuCampo.Add(SUIJIN);
            minhaMao.Clear();
            var p = brain.Decide(Idle(especiais: new[] { GATE_GUARDIAN }), 1);
            Check("Gate Guardian oferecido: invoca especialmente",
                  p.Action == "spsummon", $"(veio {p.Action} — {p.Why})");

            // ...mas não troca um corpo grande por um menor. O `spSummonable` do
            // motor diz o que PODE entrar, não o que vale a pena.
            meuCampo.Clear(); meuCampo.Add(GATE_GUARDIAN);   // 3750 ja' em campo
            p = brain.Decide(Idle(especiais: new[] { LABYRINTH_TANK }), 1);
            Check("nao invoca especialmente um corpo MENOR que o que ja' esta' em campo",
                  p.Action != "spsummon", $"(veio {p.Action} — {p.Why})");

            // ---- Tribute Doll: só com Nv7 na mão ----
            meuCampo.Clear(); meuCampo.Add(GUARDIAN_LAB);
            minhaMao.Clear(); minhaMao.Add(SANGA);
            p = brain.Decide(Idle(ativaveis: new[] { TRIBUTE_DOLL }), 1);
            Check("Tribute Doll com um Nv7 na mao: ativa",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            minhaMao.Clear(); minhaMao.Add(GUARDIAN_LAB);   // Nv4, nao serve
            p = brain.Decide(Idle(ativaveis: new[] { TRIBUTE_DOLL }), 1);
            Check("Tribute Doll SEM Nv7 na mao: guarda a carta",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            // ---- Metamorphosis e Monster Gate: nunca esvaziam o campo ----
            minhaMao.Clear();
            meuCampo.Clear(); meuCampo.Add(STONE_DRAGON); meuCampo.Add(GUARDIAN_LAB);
            p = brain.Decide(Idle(ativaveis: new[] { METAMORPHOSIS }), 1);
            Check("Metamorphosis com dois corpos: ativa",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            meuCampo.Clear(); meuCampo.Add(STONE_DRAGON);
            p = brain.Decide(Idle(ativaveis: new[] { METAMORPHOSIS }), 1);
            Check("Metamorphosis com UM corpo so': guarda (tributa-lo esvaziaria o campo)",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            meuCampo.Clear(); meuCampo.Add(STONE_DRAGON); meuCampo.Add(GUARDIAN_LAB);
            p = brain.Decide(Idle(ativaveis: new[] { MONSTER_GATE }), 1);
            Check("Monster Gate com dois corpos: cava",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            meuCampo.Clear(); meuCampo.Add(STONE_DRAGON);
            p = brain.Decide(Idle(ativaveis: new[] { MONSTER_GATE }), 1);
            Check("Monster Gate com UM corpo so': guarda",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            // ---- Magical Labyrinth: o combo do muro ----
            meuCampo.Clear(); meuCampo.Add(LABYRINTH_WALL);
            p = brain.Decide(Idle(ativaveis: new[] { MAGICAL_LABYRINTH }), 1);
            Check("Magical Labyrinth com o muro em campo: equipa",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            // ---- a ordem entre os atalhos ----
            // Metamorphosis diz exatamente o que traz; Monster Gate e' aposta na
            // media do deck. Com os dois na mao, o certo sai primeiro.
            meuCampo.Clear(); meuCampo.Add(STONE_DRAGON); meuCampo.Add(GUARDIAN_LAB);
            p = brain.Decide(Idle(ativaveis: new[] { MONSTER_GATE, METAMORPHOSIS }), 1);
            Check("com os dois na mao, o Metamorphosis (certo) vem antes do Monster Gate (aposta)",
                  p.Action == "activate" && p.Index == 1, $"(veio {p.Action} idx {p.Index} — {p.Why})");

            // O pacote "Normal grande" do Pegasus continua mandando mais que os
            // atalhos: buscar/invocar de graca e' melhor que pagar um corpo.
            meuCampo.Clear(); meuCampo.Add(STONE_DRAGON); meuCampo.Add(GUARDIAN_LAB);
            minhaMao.Clear(); minhaMao.Add(GARNECIA);
            p = brain.Decide(Idle(ativaveis: new[] { MONSTER_GATE, ANCIENT_RULES }), 1);
            Check("Ancient Rules (de graca) vem antes do Monster Gate (custa um corpo)",
                  p.Action == "activate" && p.Index == 1, $"(veio {p.Action} idx {p.Index} — {p.Why})");
        }

        // ------------------------------------------------------------------
        // O deck de verdade, jogado pelo NpcBrain.
        // ------------------------------------------------------------------
        static readonly uint[] MAIN = {
            GUARDIAN_LAB, GUARDIAN_LAB, GUARDIAN_LAB,
            LABYRINTH_WALL, LABYRINTH_WALL, LABYRINTH_WALL,
            MAGICAL_LABYRINTH, MAGICAL_LABYRINTH, MAGICAL_LABYRINTH,
            63162310, 63162310,                       // Wall Shadow
            SANGA, SUIJIN, KAZEJIN, GATE_GUARDIAN,
            MONSTER_GATE, MONSTER_GATE, MONSTER_GATE,
            JIRAI_GUMO, JIRAI_GUMO, JIRAI_GUMO,
            PREY_JIRAI, PREY_JIRAI, PREY_JIRAI,
            TRIBUTE_DOLL, TRIBUTE_DOLL, TRIBUTE_DOLL,
            METAMORPHOSIS, METAMORPHOSIS, METAMORPHOSIS,
            STONE_DRAGON, STONE_DRAGON, STONE_DRAGON,
            GARNECIA, GARNECIA, GARNECIA,
            ANCIENT_RULES, ANCIENT_RULES, ANCIENT_RULES,
            SUMMONERS_ART, SUMMONERS_ART, SUMMONERS_ART,
        };
        static readonly uint[] EXTRA = { LABYRINTH_TANK, LABYRINTH_TANK, LABYRINTH_TANK };

        static void DueloReal(string sa)
        {
            var atalhos = new HashSet<uint> { TRIBUTE_DOLL, MONSTER_GATE, METAMORPHOSIS, MAGICAL_LABYRINTH };
            var usados = new HashSet<uint>();
            int maiorAtkDoNpc = 0;
            bool invocouEspecial = false;

            // Vários seeds: o que se prova é que as regras DISPARAM com a mão que
            // o embaralhamento dá, não que uma mão específica funciona.
            foreach (ulong seed in new ulong[] { 7, 31337, 2024, 999, 12345, 555 })
            {
                // O NPC joga com o deck do labirinto; o jogador 0 fica de campo
                // vazio (auto-passe), então o NPC tem espaço para montar.
                using var duel = new InteractiveDuel(sa, MAIN, seed, 0x1000000UL, npc: true,
                                                    npcDeck: MAIN, extra: EXTRA, npcExtra: EXTRA);
                var r = duel.Advance();

                for (int guard = 0; guard < 220 && !r.ended; guard++)
                {
                    foreach (var e in r.events)
                    {
                        var t = e.GetType();
                        string tipo = t.GetProperty("type")?.GetValue(e) as string;
                        if (tipo == "chaining" || tipo == "move")
                        {
                            uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                            if (atalhos.Contains(code)) usados.Add(code);
                        }
                        if (tipo == "spsummoning") invocouEspecial = true;
                        if (tipo == "stats")
                        {
                            int ctrl = Convert.ToInt32(t.GetProperty("controller")?.GetValue(e) ?? 0);
                            int atk = Convert.ToInt32(t.GetProperty("atk")?.GetValue(e) ?? 0);
                            if (ctrl == 1) maiorAtkDoNpc = Math.Max(maiorAtkDoNpc, atk);
                        }
                    }

                    var q = r.question;
                    if (q == null) break;
                    // O jogador humano não faz nada: passa tudo o que puder.
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

            Check("o NPC usou pelo menos um atalho do labirinto",
                  usados.Count > 0, "(nenhum dos quatro foi ativado em 6 duelos)");
            Log.Info($"  ..    atalhos usados: {string.Join(", ", usados)}");
            Check("o NPC fez Invocacao Especial em algum momento", invocouEspecial);
            Check("um corpo GRANDE (>= 2000 de ATK) chegou ao campo do NPC",
                  maiorAtkDoNpc >= 2000, $"(o maior foi {maiorAtkDoNpc})");
        }
    }
}

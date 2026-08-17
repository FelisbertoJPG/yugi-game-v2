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
        const uint MAUSOLEUM = 80921533;       // Magia de Campo: paga LP e invoca sem tributo
        // A conta do `aux.Stringid` deste core: `(indice & 0xfffff) | code << 20`.
        const ulong MAUSOLEU_1_TRIBUTO = ((ulong)MAUSOLEUM << 20) | 1;
        const ulong MAUSOLEU_2_TRIBUTOS = ((ulong)MAUSOLEUM << 20) | 2;
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

        static readonly HashSet<uint> PECAS = new() { SANGA, SUIJIN, KAZEJIN };

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

            var minhasSt = new List<uint>();   // magias/armadilhas minhas com a face pra cima

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meuCampo : new List<uint>(),
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                faceUpStOf: p => p == 1 ? minhasSt : new List<uint>());

            // `local` é de onde a carta é ativada — a MÃO (0x2) ou a zona de
            // magia (0x8). Não é detalhe: o Mausoléu aparece nas duas, e são
            // coisas diferentes (pôr a magia em campo × usar o efeito dela).
            InteractiveDuel.Question Idle(
                IEnumerable<uint> ativaveis = null, IEnumerable<uint> especiais = null,
                byte local = 0x2)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                int i = 0;
                foreach (var c in ativaveis ?? Enumerable.Empty<uint>())
                    q.activatable.Add(new InteractiveDuel.Act { code = c, index = i++, location = local });
                i = 0;
                foreach (var c in especiais ?? Enumerable.Empty<uint>())
                    q.spSummonable.Add(new InteractiveDuel.Act { code = c, index = i++ });
                return q;
            }

            // Pergunta de seleção de cartas (custo de descarte, tributo, alvo).
            InteractiveDuel.Question Selecao(byte onde, params uint[] cartas)
            {
                var q = new InteractiveDuel.Question { kind = "selectcard", player = 1, selMin = 1 };
                int i = 0;
                foreach (var c in cartas)
                    q.choices.Add(new InteractiveDuel.Sel { code = c, index = i++, location = onde });
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

            // ================================================================
            // O REI NAO SE JOGA FORA
            //
            // A regra de descarte joga fora o MAIOR monstro da mao, porque o
            // grande no cemiterio volta pelo Monster Reborn. O Gate Guardian e'
            // Nv11 com 3750 — sempre o maior de qualquer mao — e nao volta de
            // lugar nenhum: sem ter sido corretamente Invocado Especialmente
            // antes, nenhuma reanimacao o aceita. Descarta-lo rasga a carta.
            // ================================================================
            meuCampo.Clear(); minhaMao.Clear(); minhasSt.Clear();
            var descarte = brain.DecideSelect(Selecao(0x2, GATE_GUARDIAN, METAMORPHOSIS), 1);
            Check("descarte: joga fora a magia, nao o Gate Guardian",
                  descarte.Count == 1 && descarte[0] == 1, $"(escolheu idx {string.Join(",", descarte)})");

            descarte = brain.DecideSelect(Selecao(0x2, GATE_GUARDIAN, SANGA, GUARDIAN_LAB), 1);
            Check("descarte: entre monstros, o descartavel vai antes da peca e do rei",
                  descarte.Count == 1 && descarte[0] == 2, $"(escolheu idx {string.Join(",", descarte)})");

            descarte = brain.DecideSelect(Selecao(0x2, GATE_GUARDIAN, SANGA), 1);
            Check("descarte: obrigado a escolher entre os dois, a peca sai antes do rei",
                  descarte.Count == 1 && descarte[0] == 1, $"(escolheu idx {string.Join(",", descarte)})");

            // ================================================================
            // AS PECAS NAO SAO COMBUSTIVEL
            //
            // Sanga/Suijin/Kazejin sao o unico caminho ate o Gate Guardian, e
            // cada uma sozinha ja' e' uma parede que zera o ATK de quem ataca.
            // Gasta-las como custo de um atalho perde as duas coisas de uma vez.
            // ================================================================
            minhaMao.Clear();
            meuCampo.Clear(); meuCampo.Add(SANGA); meuCampo.Add(SUIJIN);
            p = brain.Decide(Idle(ativaveis: new[] { METAMORPHOSIS }), 1);
            Check("Metamorphosis com o campo so' de pecas: guarda a carta",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            p = brain.Decide(Idle(ativaveis: new[] { MONSTER_GATE }), 1);
            Check("Monster Gate com o campo so' de pecas: guarda a carta",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            minhaMao.Clear(); minhaMao.Add(KAZEJIN);
            p = brain.Decide(Idle(ativaveis: new[] { TRIBUTE_DOLL }), 1);
            Check("Tribute Doll com o campo so' de pecas: guarda a carta",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            // ...e com um corpo dispensavel em campo, os tres voltam a jogar.
            meuCampo.Add(GUARDIAN_LAB);
            p = brain.Decide(Idle(ativaveis: new[] { METAMORPHOSIS }), 1);
            Check("Metamorphosis com um corpo dispensavel no meio: ativa",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            // O tributo em si tambem prefere quem nao faz falta — e o caso que
            // importa e' o EMPATE de ATK, onde a ordem decidia por acaso:
            // Kazejin e Garnecia tem os mesmos 2400.
            meuCampo.Clear(); meuCampo.Add(KAZEJIN); meuCampo.Add(GARNECIA);
            var tributo = brain.DecideSelect(new InteractiveDuel.Question
            {
                kind = "selecttribute", player = 1, selMin = 1,
                choices =
                {
                    new InteractiveDuel.Sel { code = KAZEJIN, index = 0, location = 0x4, release = 1 },
                    new InteractiveDuel.Sel { code = GARNECIA, index = 1, location = 0x4, release = 1 },
                },
            }, 1);
            Check("tributo: empatados em 2400, sai o Garnecia e nao a peca",
                  tributo.Count == 1 && tributo[0] == 1, $"(escolheu idx {string.Join(",", tributo)})");

            // ================================================================
            // MAUSOLEU DO IMPERADOR
            //
            // O deck vive de Nv7 preso na mao esperando dois tributos. O
            // Mausoleu paga LP no lugar deles — e e' assim que as pecas chegam
            // ao campo sem gastar outro corpo.
            // ================================================================
            meuCampo.Clear(); minhasSt.Clear();
            minhaMao.Clear(); minhaMao.Add(SANGA);
            p = brain.Decide(Idle(ativaveis: new[] { MAUSOLEUM }, local: 0x2), 1);
            Check("Mausoleu na mao com um Nv7 esperando: poe a magia em campo",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            minhaMao.Clear(); minhaMao.Add(GUARDIAN_LAB);   // Nv4: nao precisa de tributo
            p = brain.Decide(Idle(ativaveis: new[] { MAUSOLEUM }, local: 0x2), 1);
            Check("Mausoleu sem Nv5+ na mao: guarda (ele ajuda OS DOIS lados)",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            minhaMao.Clear(); minhaMao.Add(SANGA);
            minhasSt.Add(MAUSOLEUM);
            p = brain.Decide(Idle(ativaveis: new[] { MAUSOLEUM }, local: 0x2), 1);
            Check("2a copia do Mausoleu com um ja' em campo: guarda",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");

            // Com a magia em campo, o efeito dela: a ativacao vem da zona de
            // magia (0x8), nao da mao.
            p = brain.Decide(Idle(ativaveis: new[] { MAUSOLEUM }, local: 0x8), 1);
            Check("Mausoleu em campo com Nv7 na mao: usa o efeito",
                  p.Action == "activate", $"(veio {p.Action} — {p.Why})");

            // ...e a OPCAO escolhida e' a de 2 tributos. A primeira da lista —
            // a resposta fixa de antes — e' a de 1000 LP, que so' alcanca o
            // Labyrinth Wall de 0 de ATK.
            var opcao = new InteractiveDuel.Question { kind = "option", player = 1 };
            opcao.options.Add(MAUSOLEU_1_TRIBUTO);
            opcao.options.Add(MAUSOLEU_2_TRIBUTOS);
            minhaMao.Clear(); minhaMao.Add(LABYRINTH_WALL); minhaMao.Add(SANGA);
            Check("Mausoleu: escolhe pagar 2000 pelo Nv7, nao 1000 pelo muro",
                  brain.DecideOption(opcao, 1) == 1, $"(escolheu {brain.DecideOption(opcao, 1)})");

            // ...e quem sobe e' a PECA que falta, mesmo com um Nv7 de mais ATK
            // na mao — Sanga tem 2600, mas quem completa o trio e' o Kazejin.
            meuCampo.Clear(); meuCampo.Add(SANGA); meuCampo.Add(SUIJIN);
            minhaMao.Clear(); minhaMao.Add(GARNECIA); minhaMao.Add(KAZEJIN);
            p = brain.Decide(Idle(ativaveis: new[] { MAUSOLEUM }, local: 0x8), 1);
            var sobe = brain.DecideSelect(Selecao(0x2, GARNECIA, KAZEJIN), 1);
            Check("Mausoleu: sobe a peca que falta, nao o Nv7 de ATK igual",
                  sobe.Count == 1 && sobe[0] == 1, $"(escolheu idx {string.Join(",", sobe)})");

            // Sem a magia em campo o LP nao e' gasto a toa: um custo que fura o
            // piso de vida faz o efeito ser guardado.
            meuCampo.Clear(); minhasSt.Clear(); minhasSt.Add(MAUSOLEUM);
            minhaMao.Clear(); minhaMao.Add(SANGA);
            var brainPobre = new NpcBrain(db,
                fieldOf: _ => meuCampo, log: _ => { }, handOf: _ => minhaMao,
                faceUpStOf: _ => minhasSt, lpOf: _ => 2500);
            p = brainPobre.Decide(Idle(ativaveis: new[] { MAUSOLEUM }, local: 0x8), 1);
            Check("Mausoleu: 2000 LP com 2500 de vida furaria o piso — guarda o efeito",
                  p.Action != "activate", $"(veio {p.Action} — {p.Why})");
        }

        // ------------------------------------------------------------------
        // O deck de verdade, jogado pelo NpcBrain.
        // ------------------------------------------------------------------
        // O deck DE VERDADE do Para & Dox (`decks/npc/para_dox/guardiao_do_portao.ydk`),
        // e não uma aproximação: é ele que decide quais regras têm chance de
        // disparar com a mão que o embaralhamento dá.
        const uint CANNON_SOLDIER = 11384280;
        const uint PREMATURE_BURIAL = 70828912;
        static readonly uint[] MAIN = {
            GUARDIAN_LAB, GUARDIAN_LAB, GUARDIAN_LAB,
            LABYRINTH_WALL, LABYRINTH_WALL, LABYRINTH_WALL,
            SANGA, SUIJIN, KAZEJIN, GATE_GUARDIAN,
            MONSTER_GATE, MONSTER_GATE, MONSTER_GATE,
            JIRAI_GUMO, PREY_JIRAI, PREY_JIRAI,
            TRIBUTE_DOLL, TRIBUTE_DOLL, TRIBUTE_DOLL,
            METAMORPHOSIS, METAMORPHOSIS, METAMORPHOSIS,
            GARNECIA, GARNECIA, GARNECIA,
            ANCIENT_RULES, ANCIENT_RULES, ANCIENT_RULES,
            SUMMONERS_ART, SUMMONERS_ART, SUMMONERS_ART,
            CANNON_SOLDIER, CANNON_SOLDIER, CANNON_SOLDIER,
            PREMATURE_BURIAL, PREMATURE_BURIAL,
            MAUSOLEUM, MAUSOLEUM, MAUSOLEUM,
            MAGICAL_LABYRINTH, 63162310,              // Wall Shadow
        };
        static readonly uint[] EXTRA = { LABYRINTH_TANK, LABYRINTH_TANK, LABYRINTH_TANK };

        static void DueloReal(string sa)
        {
            var atalhos = new HashSet<uint> { TRIBUTE_DOLL, MONSTER_GATE, METAMORPHOSIS, MAGICAL_LABYRINTH };
            var usados = new HashSet<uint>();
            int maiorAtkDoNpc = 0;
            bool invocouEspecial = false;
            bool ativouMausoleu = false;
            var pecasQueSubiram = new HashSet<uint>();
            bool descartouORei = false;

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
                            if (code == MAUSOLEUM) ativouMausoleu = true;
                        }
                        if (tipo == "spsummoning") invocouEspecial = true;
                        // Peça do Gate Guardian chegando ao campo do NPC, e o rei
                        // indo da MAO (0x2) para o cemiterio (0x10) — o descarte
                        // que matava a carta para sempre.
                        if (tipo == "move")
                        {
                            uint code = Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u);
                            int ctrl = Convert.ToInt32(t.GetProperty("controller")?.GetValue(e) ?? 0);
                            int loc = Convert.ToInt32(t.GetProperty("loc")?.GetValue(e) ?? 0);
                            int fromLoc = Convert.ToInt32(t.GetProperty("fromLoc")?.GetValue(e) ?? 0);
                            if (ctrl == 1 && loc == 0x4 && PECAS.Contains(code)) pecasQueSubiram.Add(code);
                            if (code == GATE_GUARDIAN && fromLoc == 0x2 && loc == 0x10) descartouORei = true;
                        }
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
            Check("o NPC ativou o Mausoleu do Imperador", ativouMausoleu,
                  "(a magia de campo nunca saiu da mao em 6 duelos)");
            Check("pelo menos uma peca do Gate Guardian chegou ao campo do NPC",
                  pecasQueSubiram.Count > 0, "(nenhuma das tres foi invocada)");
            Log.Info($"  ..    pecas que subiram: {string.Join(", ", pecasQueSubiram)}");
            Check("o Gate Guardian NUNCA foi descartado da mao", !descartouORei,
                  "(o rei do deck foi para o cemiterio pela regra de descarte)");
        }
    }
}

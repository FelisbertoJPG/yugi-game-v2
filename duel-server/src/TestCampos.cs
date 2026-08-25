using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// As MAGIAS DE CAMPO — `--test-campos`.
    ///
    /// A pergunta que originou isto foi *"o NPC sabe posicionar magia de
    /// campo?"*, e a resposta medida era: posicionar sim (a zona de campo é
    /// `SZONE seq=5`, e o `ParsePlace` a trata), ATIVAR quase não — dos seis
    /// campos básicos da Lista 1 ele usava dois. Quem dizia o que cada carta
    /// reforça era uma tabela escrita à mão com três entradas, e Forest, Yami,
    /// Sogen e Wasteland ficavam mortas na mão para sempre, sem um aviso.
    ///
    /// Hoje quem responde é o Lua da própria carta (<see cref="BonusDeCampo"/>),
    /// como já acontece com compra, busca, destruição e trava. Três metades,
    /// todas silenciosas quando erram:
    ///
    ///   1. **a LEITURA do Lua**, nas duas formas em que estes scripts aparecem —
    ///      o filtro literal (`aux.TargetBoolFunction(Card.IsRace, …)`) e a função
    ///      de valor (`if r&amp;(…)&gt;0 then return 200 elseif … return -200`). A
    ///      segunda é a que traz a PENALIDADE, que a tabela não sabia dizer;
    ///   2. **a DECISÃO**, que agora é uma diferença e não uma contagem: magia de
    ///      campo é global, então "algum monstro meu ganha" não basta — a Mountain
    ///      com um Dragão meu e dois dele reforça mais o outro lado, e eu ainda
    ///      pago a carta;
    ///   3. **o duelo real**, que é o único que prova que a carta chega a
    ///      `activatable` e que a jogada sai inteira.
    /// </summary>
    public static class TestCampos
    {
        // Os seis campos básicos da Lista 1, e o que cada um faz.
        const uint MOUNTAIN = 50913601;   // +200 Dragao / Alado / Trovao
        const uint UMI = 22702055;        // +200 Peixe/Serpente/Trovao/Aqua, -200 Maquina/Piro
        const uint YAMI = 59197169;       // +200 Demonio / Mago, -200 Fada
        const uint SOGEN = 86318356;      // +200 Guerreiro / Besta-Guerreira
        const uint FOREST = 87430998;     // +200 Inseto / Besta / Planta / Besta-Guerreira
        const uint WASTELAND = 23424603;  // +200 Dinossauro / Zumbi / Rocha
        const uint OCEANO = 295517;       // A Legendary Ocean: +200 em todo WATER

        // Corpos Normais, escolhidos pela RACA — e' so' o que a regra le' neles.
        const uint BLUE_EYES = 89631139;      // Dragao  / LIGHT
        const uint SETE_CORES = 23771716;     // Peixe   / WATER
        const uint KING_YAMIMAKAI = 69455834; // Demonio / DARK
        const uint BATTLE_OX = 5053103;       // Besta-Guerreira / EARTH
        const uint KYONSHEE = 24530661;       // Zumbi   / EARTH
        const uint GAIA = 6368038;            // Guerreiro / EARTH
        const uint MYSTICAL_ELF = 15025844;   // Mago    / LIGHT
        const uint MECHANICAL = 7359741;      // Maquina — a PENALIDADE da Umi

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== o que o LUA de cada campo diz ===\n");
            ALeitura(sa);

            Log.Info("\n=== a decisao: a DIFERENCA entre os dois lados ===\n");
            ADecisao(sa);

            Log.Info("\n=== duelo de verdade ===\n");
            NoDuelo(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ---------------------------------------------------------- a leitura

        static void ALeitura(string sa)
        {
            using var db = new DatabaseManager(sa);
            int Bonus(uint campo, uint monstro) => db.CampoDe(campo).Para(db.Stats(monstro));

            // FORMA A — filtro literal. Os quatro que a tabela nao conhecia estao
            // aqui, e sao a razao deste arquivo existir.
            Check("Mountain reforca Dragao", Bonus(MOUNTAIN, BLUE_EYES) == 200,
                  $"(veio {Bonus(MOUNTAIN, BLUE_EYES)})");
            Check("Forest reforca Besta-Guerreira", Bonus(FOREST, BATTLE_OX) == 200,
                  $"(veio {Bonus(FOREST, BATTLE_OX)})");
            Check("Sogen reforca Guerreiro", Bonus(SOGEN, GAIA) == 200,
                  $"(veio {Bonus(SOGEN, GAIA)})");
            Check("Wasteland reforca Zumbi", Bonus(WASTELAND, KYONSHEE) == 200,
                  $"(veio {Bonus(WASTELAND, KYONSHEE)})");

            // FORMA B — funcao de valor, e e' ela que traz a PENALIDADE.
            Check("Umi reforca Peixe", Bonus(UMI, SETE_CORES) == 200,
                  $"(veio {Bonus(UMI, SETE_CORES)})");
            Check("Umi PENALIZA Maquina — a metade que a tabela nao sabia dizer",
                  Bonus(UMI, MECHANICAL) == -200, $"(veio {Bonus(UMI, MECHANICAL)})");
            Check("Yami reforca Demonio", Bonus(YAMI, KING_YAMIMAKAI) == 200,
                  $"(veio {Bonus(YAMI, KING_YAMIMAKAI)})");
            Check("Yami reforca Mago tambem (a mesma clausula)",
                  Bonus(YAMI, MYSTICAL_ELF) == 200, $"(veio {Bonus(YAMI, MYSTICAL_ELF)})");

            // Por ATRIBUTO, e com a armadilha do `Clone()`: em A Legendary Ocean o
            // PRIMEIRO efeito e' um `EFFECT_UPDATE_LEVEL` de -1, e o de ATK e' o
            // clone seguinte. Um leitor que casasse "o primeiro SetTarget com o
            // primeiro SetValue" leria -1 e concluiria que a carta PIORA o proprio
            // campo — exatamente ao contrario.
            Check("A Legendary Ocean reforca por ATRIBUTO (+200 em WATER), nao -1",
                  Bonus(OCEANO, SETE_CORES) == 200, $"(veio {Bonus(OCEANO, SETE_CORES)})");

            // PARES CONTROLE: quem NAO casa recebe zero. Sem isto, um leitor que
            // devolvesse 200 para todo mundo passaria em tudo acima.
            Check("par CONTROLE: Mountain nao reforca Guerreiro", Bonus(MOUNTAIN, GAIA) == 0,
                  $"(veio {Bonus(MOUNTAIN, GAIA)})");
            Check("par CONTROLE: Wasteland nao reforca Peixe", Bonus(WASTELAND, SETE_CORES) == 0,
                  $"(veio {Bonus(WASTELAND, SETE_CORES)})");
            Check("par CONTROLE: Umi nao reforca Guerreiro", Bonus(UMI, GAIA) == 0,
                  $"(veio {Bonus(UMI, GAIA)})");

            // E o silencio seguro: carta que nao e' magia de campo nao vira uma.
            Check("par CONTROLE: um monstro nao e' magia de campo",
                  !db.CampoDe(BLUE_EYES).Conhecido);
        }

        // ---------------------------------------------------------- a decisao

        static void ADecisao(string sa)
        {
            using var db = new DatabaseManager(sa);
            var meu = new List<uint>();
            var dele = new List<uint>();

            var jaEmCampo = new List<uint>();   // magias/armadilhas MINHAS abertas

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? meu : dele,
                log: _ => { },
                handOf: _ => new List<uint>(),
                faceUpStOf: p => p == 1 ? jaEmCampo : new List<uint>());

            InteractiveDuel.Question Idle(uint code)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = code, index = 0, location = 0x2 });
                return q;
            }

            bool Ativou(NpcBrain.Play p, uint code) =>
                p.Action == "activate" && (p.Why ?? "").Contains(code.ToString());

            void Mesa(uint[] meus, uint[] deles, uint campoJaEmPe = 0)
            {
                meu.Clear(); meu.AddRange(meus);
                dele.Clear(); dele.AddRange(deles);
                jaEmCampo.Clear();
                if (campoJaEmPe != 0) jaEmCampo.Add(campoJaEmPe);
            }

            // Os quatro que ele nao sabia usar, cada um com o corpo que ele reforca.
            Mesa(new[] { BATTLE_OX }, new[] { GAIA });
            Check("Forest com a minha Besta-Guerreira: ATIVA",
                  Ativou(brain.Decide(Idle(FOREST), 1), FOREST));

            Mesa(new[] { KING_YAMIMAKAI }, new[] { BATTLE_OX });
            Check("Yami com o meu Demonio: ATIVA",
                  Ativou(brain.Decide(Idle(YAMI), 1), YAMI));

            Mesa(new[] { GAIA }, new[] { SETE_CORES });
            Check("Sogen com o meu Guerreiro: ATIVA",
                  Ativou(brain.Decide(Idle(SOGEN), 1), SOGEN));

            Mesa(new[] { KYONSHEE }, new[] { SETE_CORES });
            Check("Wasteland com o meu Zumbi: ATIVA",
                  Ativou(brain.Decide(Idle(WASTELAND), 1), WASTELAND));

            // O PAR CONTROLE QUE IMPORTA, e o que a regra antiga nao sabia fazer:
            // magia de campo e' GLOBAL. Um Guerreiro meu e DOIS dele — o Sogen
            // reforca mais o outro lado, e eu ainda pago a carta por isso.
            Mesa(new[] { GAIA }, new[] { GAIA, BATTLE_OX });
            var p1 = brain.Decide(Idle(SOGEN), 1);
            Check("par CONTROLE: com 1 Guerreiro meu contra 2 dele, GUARDA o Sogen",
                  !Ativou(p1, SOGEN), $"(veio {p1.Action} — {p1.Why})");

            // ...e o mesmo tabuleiro invertido tem de ATIVAR, senao "nao ativou"
            // seria so' a regra estar desligada.
            Mesa(new[] { GAIA, BATTLE_OX }, new[] { GAIA });
            Check("par CONTROLE invertido: 2 meus contra 1 dele, ATIVA",
                  Ativou(brain.Decide(Idle(SOGEN), 1), SOGEN));

            // Empate nao compensa a carta: +200 dos dois lados nao muda nada.
            Mesa(new[] { GAIA }, new[] { GAIA });
            var p2 = brain.Decide(Idle(SOGEN), 1);
            Check("empatado (1 e 1), GUARDA — a carta nao mudaria nada",
                  !Ativou(p2, SOGEN), $"(veio {p2.Action} — {p2.Why})");

            // A PENALIDADE entrando na conta: a Umi tira 200 da minha Maquina.
            // Com Peixe + Maquina meus a soma e' zero, e ela deixa de valer.
            Mesa(new[] { SETE_CORES, MECHANICAL }, Array.Empty<uint>());
            var p3 = brain.Decide(Idle(UMI), 1);
            Check("Umi com Peixe E Maquina meus: GUARDA (+200 -200 = 0)",
                  !Ativou(p3, UMI), $"(veio {p3.Action} — {p3.Why})");

            Mesa(new[] { SETE_CORES }, Array.Empty<uint>());
            Check("par CONTROLE: so' o Peixe, ATIVA",
                  Ativou(brain.Decide(Idle(UMI), 1), UMI));

            // Campo vazio dos dois lados: nao ha' o que reforcar.
            Mesa(Array.Empty<uint>(), Array.Empty<uint>());
            var p4 = brain.Decide(Idle(MOUNTAIN), 1);
            Check("mesa vazia: GUARDA", !Ativou(p4, MOUNTAIN), $"(veio {p4.Action} — {p4.Why})");

            // JA' TENHO CAMPO EM PE'. Ativar outra manda a que esta' la' para o
            // cemiterio — trocar por uma que rende o MESMO e' jogar carta fora.
            // Nao e' hipotese: o duelo de baixo mostrava o NPC trocando Forest por
            // Forest turno apos turno, com o comentario da regra antiga afirmando
            // que "o motor nem oferece a mesma carta".
            Mesa(new[] { BATTLE_OX }, Array.Empty<uint>(), campoJaEmPe: FOREST);
            var p5 = brain.Decide(Idle(FOREST), 1);
            Check("com uma Forest ja' em campo, GUARDA a segunda", !Ativou(p5, FOREST),
                  $"(veio {p5.Action} — {p5.Why})");

            // PAR CONTROLE: trocar por uma MELHOR continua valendo. Besta-Guerreira
            // + Guerreiro: a Forest pega so' o Ox (+200), o Sogen pega os dois
            // (+400). Sem esta metade, um guarda que recusasse SEMPRE passaria.
            Mesa(new[] { BATTLE_OX, GAIA }, Array.Empty<uint>(), campoJaEmPe: FOREST);
            var p6 = brain.Decide(Idle(SOGEN), 1);
            Check("par CONTROLE: troca por uma que rende MAIS (Forest +200 -> Sogen +400)",
                  Ativou(p6, SOGEN), $"(veio {p6.Action} — {p6.Why})");
        }

        // ------------------------------------------------------------- duelo

        /// <summary>
        /// O caminho inteiro: a carta chega a `activatable`, o NPC a ativa, e o
        /// motor pergunta a ZONA — que para Magia de Campo e' `SZONE seq=5`. As
        /// secoes acima rodam sobre uma `Question` montada aqui e nao provam
        /// nenhuma dessas tres coisas.
        /// </summary>
        static void NoDuelo(string sa)
        {
            var deckNpc = new List<uint>();
            for (int i = 0; i < 10; i++) deckNpc.Add(FOREST);
            while (deckNpc.Count < 40) deckNpc.Add(BATTLE_OX);

            var deckJogador = new List<uint>();
            while (deckJogador.Count < 40) deckJogador.Add(MYSTICAL_ELF);

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), 20260823UL, 0x1000000UL,
                                                 npc: true, npcDeck: deckNpc.ToArray());
            var r = duel.Advance();

            bool ativou = false, chegouAoCampo = false;
            string porque = null;

            for (int guard = 0; guard < 300 && !r.ended && !chegouAoCampo; guard++)
            {
                foreach (var e in r.events)
                {
                    var t = e.GetType();
                    string tipo = t.GetProperty("type")?.GetValue(e) as string;

                    if (tipo == "npc"
                        && (t.GetProperty("action")?.GetValue(e) as string) == "activate")
                    {
                        string why = t.GetProperty("why")?.GetValue(e) as string;
                        if ((why ?? "").Contains(FOREST.ToString()))
                        { ativou = true; porque = why; Log.Info($"  > {why}"); }
                    }

                    // A carta chegando na ZONA DE CAMPO: loc 0x8 com seq 5 (ou o
                    // LOCATION_FZONE 0x100, conforme a versao do core).
                    if (tipo == "move"
                        && Convert.ToUInt32(t.GetProperty("code")?.GetValue(e) ?? 0u) == FOREST)
                    {
                        // `int`, e nao `byte`: o LOCATION_FZONE e' 0x100 e NAO CABE
                        // num byte. O compilador acusou (CS0652, "comparacao com
                        // constante fora do intervalo") — o ramo do 0x100 era
                        // codigo morto, e pior: um core que mandasse esse valor
                        // faria o `Convert.ToByte` LANCAR, derrubando o teste com
                        // uma excecao em vez de uma falha legivel.
                        int loc = Convert.ToInt32(t.GetProperty("loc")?.GetValue(e) ?? 0);
                        int seq = Convert.ToInt32(t.GetProperty("seq")?.GetValue(e) ?? 0);
                        if (loc == 0x100 || (loc == 0x8 && seq == 5))
                        {
                            chegouAoCampo = true;
                            Log.Info($"  > Forest entrou na zona de campo (loc 0x{loc:x} seq {seq})");
                        }
                    }
                }
                if (chegouAoCampo) break;

                var q = r.question;
                if (q == null) break;
                if (q.kind == "idle" && q.player == 0)
                {
                    if (q.summonable.Count > 0) { r = duel.Respond("summon", q.summonable[0].index); continue; }
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                r = Padrao(duel, q);
            }

            Check("o NPC ativou a Forest sozinho", ativou,
                  "(ela nunca entrou em `activatable`, ou a regra nao disparou)");
            Check("e ela foi POSICIONADA na zona de campo", chegouAoCampo,
                  "(o `place` respondeu a zona errada — a de campo e' SZONE seq 5)");
            Check("dizendo a conta dos dois lados", porque != null && porque.Contains("para ele"),
                  $"(motivo: {porque ?? "nenhum"})");
        }

        static InteractiveDuel.Result Padrao(InteractiveDuel duel, InteractiveDuel.Question q)
        {
            switch (q.kind)
            {
                case "place": return duel.Respond("place", q.zones.Count > 0 ? q.zones[0] : 0);
                case "position": return duel.Respond("position", 0x1);
                case "yesno": return duel.Respond("yesno", 0);
                case "option": return duel.Respond("option", 0);
                case "battle": return duel.Respond("endbattle", 0);
                case "chain": return duel.Respond("chain", -1);
                case "selectcard":
                case "selecttribute":
                case "selectsum":
                    return duel.Respond("select", 0,
                        q.choices.Take(Math.Max(1, q.selMin)).Select(c => c.index).ToList());
                case "selectunselect":
                    return q.canFinish && q.choices.Count == 0
                        ? duel.Respond("finishselect", 0)
                        : duel.Respond("pick", q.choices[0].index);
                default: return duel.Respond("endturn", 0);
            }
        }
    }
}

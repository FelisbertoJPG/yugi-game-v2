using System;
using System.Collections.Generic;
using System.Linq;
using YGO;

namespace DuelServer
{
    /// <summary>
    /// **ENTERRAR PARA USAR DEPOIS** — `--test-enterro`.
    ///
    /// O pedido: *"quando ele abrir com Foolish Burial, adiantar o envio de
    /// material do deck pro cemiterio pra usar posteriormente"*, com o deck
    /// **Yugi Chaos** de exemplo — ele leva TRES Foolish Burial de proposito,
    /// para mandar os Dark Magician of Chaos ao cemiterio e alcanca-los mais
    /// rapido pelos tres Monster Reborn.
    ///
    /// Sao duas metades, e as duas erram CALADAS:
    ///
    ///   QUANDO — a regra exigia a reanimacao na MAO. Num deck de 40 com tres
    ///       Reborn, ter as duas metades juntas e' sorte e nao plano: na pratica a
    ///       carta ficava na mao a partida inteira. Hoje a segunda razao e' o
    ///       DECK — enterrar cedo e' ADIANTAR, o corpo espera a carta que vem.
    ///       O par CONTROLE e' o deck SEM reanimacao nenhuma, onde enterrar
    ///       continua sendo pagar uma carta para encher o proprio cemiterio.
    ///
    ///   O QUE — o criterio generico do `DecideSelect` e' "maior ATK impresso", e
    ///       nesse deck o maior ATK e' o **Black Luster Soldier** (3000), um
    ///       monstro de RITUAL. Ritual, fusao, sincro, xyz e os "nomi" so' saem do
    ///       cemiterio se tiverem sido corretamente invocados ANTES — e quem foi
    ///       do deck direto para la' nunca foi. A carta e' enterrada, o motor esta'
    ///       certo, o Monster Reborn seguinte simplesmente NAO A OFERECE, e nada
    ///       acusa: so' o combo que nunca fecha.
    ///
    /// A terceira secao traz o par CONTROLE que prova que a armadilha e' real: a
    /// MESMA lista, sem a marca da regra, cai no criterio generico e escolhe o
    /// Lustro Negro. Sem ele, "escolheu o Mago do Caos" nao provaria que alguem
    /// escolheu — o Mago poderia estar vindo por acaso, pela ordem da lista.
    /// </summary>
    public static class TestEnterro
    {
        const uint FOOLISH = 81439173;        // manda 1 monstro do DECK para o cemiterio
        const uint MONSTER_REBORN = 83764718; // reanima do cemiterio
        const uint POT = 55144522;            // par controle: nao reanima nada
        const uint GRACEFUL = 79571449;       // compra 3 / descarta 2 — tambem nao reanima

        // O deck do Yugi Chaos, nas cartas que decidem esta regra.
        const uint LUSTRO = 5405694;      // Black Luster Soldier  — RITUAL,  Nv8 3000
        const uint MAGO_CAOS = 30208479;  // Magician of Black Chaos — RITUAL, Nv8 2800
        const uint DMOC = 40737112;       // Dark Magician of Chaos — efeito, Nv8 2800
        const uint DARK_MAGICIAN = 46986414; // Normal, Nv7 2500
        const uint BREAKER = 71413901;    // efeito, Nv4 1600

        const uint GATE_GUARDIAN = 25833572;  // "nomi": nao volta, e nao e' do Extra
        const uint MASTER_OF_CHAOS = 85059922; // Fusao do Extra do proprio deck

        const uint BATTLE_OX = 5053103, GAIA_NV7 = 6368038;

        // As reanimacoes, que e' o que decide QUEM pode ser enterrado.
        const uint BIRTHRIGHT = 35539880;   // Armadilha: so' monstro NORMAL
        const uint SWING = 96765646;        // Magia:     so' monstro NORMAL
        const uint ETERNAL_SOUL = 48680970; // so' o Dark Magician, pelo NOME
        const uint DARK_MAGIC_VEIL = 82404868; // so' Mago (Spellcaster) DARK

        // Os corpos que provam cada uma das tres razoes.
        const uint BEWD = 89631139;         // Normal 3000/2500 — so' corpo
        const uint TOON_BARREL = 28112535;  // 2600/2200 — QUEBRA ao ser Inv. Especialmente
        const uint TOON_SORCERER = 16392422;// 900/1400  — GERA CARTA ao ser Inv. Especialmente
        const uint MYSTICAL_ELF = 15025844; // 800/2000  — a PAREDE

        const byte DECK = 0x1, HAND = 0x2, GRAVE = 0x10;

        static int _pass, _fail;

        static void Check(string oque, bool ok, string detalhe = "")
        {
            if (ok) { Log.Info($"  OK    {oque}"); _pass++; }
            else { Log.Err($"  FALHA {oque} {detalhe}"); _fail++; }
        }

        public static int Run(string sa)
        {
            Log.Info("=== quem VOLTA do cemiterio (tipo + Lua, sem lista de ids) ===\n");
            ALeitura(sa);

            Log.Info("\n=== QUANDO enterrar (a mao, o deck, e o deck sem par) ===\n");
            AsDecisoes(sa);

            Log.Info("\n=== O QUE enterrar (o corpo que volta x o maior ATK) ===\n");
            OCorpo(sa);

            Log.Info("\n=== a NECESSIDADE do momento (as tres razoes) ===\n");
            ANecessidade(sa);

            Log.Info("\n=== duelo de verdade com o deck Yugi Chaos ===\n");
            NoDuelo(sa);

            Log.Info($"\n=== {_pass} passaram, {_fail} falharam ===");
            return _fail == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------- leitura

        /// <summary>
        /// Os dois sinais de `VoltaDoCemiterio`, um de cada vez: o TIPO (que pega
        /// classes inteiras, e vale para a carta sem Lua no disco) e o
        /// `EnableReviveLimit` do script (que pega o "nomi" avulso, como o Gate
        /// Guardian — a unica carta que este projeto ja' protegia, por ID).
        /// </summary>
        static void ALeitura(string sa)
        {
            using var db = new DatabaseManager(sa);

            Check("o Dark Magician of Chaos VOLTA do cemiterio", db.VoltaDoCemiterio(DMOC),
                  "(e' ele que os tres Foolish do deck existem para enterrar)");
            Check("o Dark Magician (Normal) tambem", db.VoltaDoCemiterio(DARK_MAGICIAN));
            Check("o Breaker tambem", db.VoltaDoCemiterio(BREAKER),
                  "(dizer 'nao volta' por falta de informacao recusaria todo alvo bom)");

            // O caso que motivou tudo: os dois maiores ATK do deck sao rituais.
            Check("o Black Luster Soldier NAO volta — e' RITUAL", !db.VoltaDoCemiterio(LUSTRO),
                  "(e' o maior ATK do deck, e por isso o criterio generico o escolhia)");
            Check("o Magician of Black Chaos tambem nao — RITUAL", !db.VoltaDoCemiterio(MAGO_CAOS));

            // O segundo sinal, sozinho: o Gate Guardian nao e' ritual nem do
            // Extra Deck. Quem o pega e' o `EnableReviveLimit` do Lua dele.
            Check("o Gate Guardian NAO volta (o 'nomi' que so' o Lua acusa)",
                  !db.VoltaDoCemiterio(GATE_GUARDIAN),
                  "(este o cerebro ja' protegia por ID, uma carta de cada vez)");

            Check("uma Fusao do Extra Deck nao volta", !db.VoltaDoCemiterio(MASTER_OF_CHAOS));

            // Par CONTROLE do reconhecimento: um leitor que respondesse "sim"
            // para tudo passaria em metade das linhas acima.
            Check("par CONTROLE: o Monster Reborn nao e' monstro — nao volta",
                  !db.VoltaDoCemiterio(MONSTER_REBORN));

            Log.Info("\n  -- o que cada REANIMACAO aceita trazer de volta --");

            // A pergunta que manda: "este monstro pode ser Invocado Especialmente
            // do cemiterio pelo efeito da carta que o traz de volta?". Ela nao e'
            // sobre o monstro sozinho — e' sobre o PAR.
            Check("Monster Reborn: filtro legivel e sem exigencia",
                  db.ExigenciaDaReanimacao(MONSTER_REBORN).Legivel
                  && db.ReanimacaoAlcanca(MONSTER_REBORN, DMOC)
                  && db.ReanimacaoAlcanca(MONSTER_REBORN, DARK_MAGICIAN));

            // Birthright e Swing of Memories sao cartas de BOOSTER deste jogo, e
            // as duas so' trazem monstro NORMAL. Num deck que so' tenha elas,
            // enterrar o Dark Magician of Chaos e' rasgar o corpo e a carta.
            Check("Birthright alcanca o Dark Magician (NORMAL)",
                  db.ReanimacaoAlcanca(BIRTHRIGHT, DARK_MAGICIAN));
            Check("...e NAO alcanca o Dark Magician of Chaos (tem efeito)",
                  !db.ReanimacaoAlcanca(BIRTHRIGHT, DMOC),
                  "(era o maior ATK que volta — e o Birthright nunca o traria)");
            Check("Swing of Memories exige o mesmo NORMAL",
                  db.ReanimacaoAlcanca(SWING, BEWD) && !db.ReanimacaoAlcanca(SWING, DMOC));

            // Filtro por NOME e filtro por raca+atributo, as outras duas formas
            // que aparecem no pool de hoje.
            Check("Eternal Soul so' traz o Dark Magician, pelo nome",
                  db.ReanimacaoAlcanca(ETERNAL_SOUL, DARK_MAGICIAN)
                  && !db.ReanimacaoAlcanca(ETERNAL_SOUL, BREAKER));
            Check("Dark Magic Veil traz Mago DARK — o do Caos sim, o Boi de Batalha nao",
                  db.ReanimacaoAlcanca(DARK_MAGIC_VEIL, DMOC)
                  && !db.ReanimacaoAlcanca(DARK_MAGIC_VEIL, BATTLE_OX));

            // PAR CONTROLE do LEITOR: filtro que ele nao entende nao pode virar
            // "aceita tudo". O Master of Chaos filtra por `s.attfilter(c)`, uma
            // funcao a' parte — e uma reanimacao ilegivel nao entra no plano.
            Check("par CONTROLE: filtro que o leitor NAO entende fica ilegivel",
                  !db.ExigenciaDaReanimacao(MASTER_OF_CHAOS).Legivel,
                  "(fingir que aceita tudo enterraria um corpo que ela nunca traria)");

            // PAR CONTROLE do outro lado: mesmo sem exigencia nenhuma, o Monster
            // Reborn nao alcanca quem o MOTOR nao deixa voltar.
            Check("par CONTROLE: nem o Monster Reborn alcanca o Lustro (RITUAL)",
                  !db.ReanimacaoAlcanca(MONSTER_REBORN, LUSTRO));

            Log.Info("\n  -- o que o corpo FAZ quando volta --");

            var dmoc = db.AoVoltarDoCemiterio(DMOC);
            Check("o Dark Magician of Chaos volta GERANDO CARTA", dmoc.recurso);
            Check("o Toon Barrel Dragon volta QUEBRANDO o campo",
                  db.AoVoltarDoCemiterio(TOON_BARREL).quebra);
            Check("o Toon Masked Sorcerer volta gerando carta",
                  db.AoVoltarDoCemiterio(TOON_SORCERER).recurso);

            // PAR CONTROLE, e e' o que da' sentido a' trava: o Breaker destroi
            // uma magia AO SER INVOCADO, mas so' por `EVENT_SUMMON_SUCCESS`.
            // Revivido, ele volta MUDO — sem contador e sem efeito.
            Check("par CONTROLE: o Breaker volta MUDO (o efeito dele e' da Invocacao Normal)",
                  !db.AoVoltarDoCemiterio(BREAKER).quebra
                  && !db.AoVoltarDoCemiterio(BREAKER).recurso,
                  "(sem esta trava, o cerebro enterraria o Breaker achando que enterrava uma remocao)");
            Check("par CONTROLE: o Blue-Eyes nao faz nem uma coisa nem outra",
                  !db.AoVoltarDoCemiterio(BEWD).recurso && !db.AoVoltarDoCemiterio(BEWD).quebra);
        }

        // ------------------------------------------------------------ decisoes

        static void AsDecisoes(string sa)
        {
            using var db = new DatabaseManager(sa);
            var minhaMao = new List<uint>();
            var meuDeck = new List<uint>();

            var brain = new NpcBrain(db,
                fieldOf: _ => new List<uint>(),
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                todoFieldPosOf: _ => new List<(uint, int, int)>(),
                listaDoDeckOf: p => p == 1 ? meuDeck : new List<uint>());

            InteractiveDuel.Question Idle(uint code)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = code, index = 0, location = HAND });
                return q;
            }

            bool Ativou(NpcBrain.Play p) =>
                p.Action == "activate" && (p.Why ?? "").Contains(FOOLISH.ToString());

            void Zerar() { minhaMao.Clear(); meuDeck.Clear(); }

            // (a) O caso de sempre: o combo fecha AGORA.
            Zerar(); minhaMao.Add(FOOLISH); minhaMao.Add(MONSTER_REBORN);
            var p1 = brain.Decide(Idle(FOOLISH), 1);
            Check("com reanimacao na MAO, enterra (o caso que ja' funcionava)", Ativou(p1),
                  $"(veio {p1.Action} — {p1.Why})");

            // (b) O BUFF: a reanimacao ainda esta' no deck. E' a mao de abertura
            // do Yugi Chaos, e era exatamente aqui que a carta ficava parada.
            Zerar();
            minhaMao.Add(FOOLISH); minhaMao.Add(GRACEFUL); minhaMao.Add(BREAKER);
            meuDeck.AddRange(YugiChaos());
            var p2 = brain.Decide(Idle(FOOLISH), 1);
            Check("sem reanimacao na mao mas COM ela no deck, enterra ADIANTADO", Ativou(p2),
                  $"(veio {p2.Action} — {p2.Why})");
            Check("...e o motivo diz que foi adiantado, nao que o combo fechou",
                  (p2.Why ?? "").Contains("ADIANTADO"), $"(veio: {p2.Why})");

            // PAR CONTROLE 1: o deck nao tem reanimacao nenhuma. Aqui enterrar
            // continua sendo pagar uma carta para encher o proprio cemiterio —
            // sem esta linha, "ativou" nao provaria criterio nenhum.
            Zerar();
            minhaMao.Add(FOOLISH); minhaMao.Add(POT);
            for (int i = 0; i < 30; i++) meuDeck.Add(i % 2 == 0 ? BATTLE_OX : GRACEFUL);
            var p3 = brain.Decide(Idle(FOOLISH), 1);
            Check("par CONTROLE: deck SEM reanimacao nenhuma, GUARDA", !Ativou(p3),
                  $"(veio {p3.Action} — {p3.Why})");

            // PAR CONTROLE 2: sem quem informe o deck, nada muda em relacao ao
            // comportamento anterior. E' o que garante que os testes de decisao
            // isolada de todo o resto do projeto continuam valendo.
            Zerar(); minhaMao.Add(FOOLISH); minhaMao.Add(POT);
            var p4 = brain.Decide(Idle(FOOLISH), 1);
            Check("par CONTROLE: sem decklist informada, GUARDA (como antes)", !Ativou(p4),
                  $"(veio {p4.Action} — {p4.Why})");

            // ---- a reanimacao TEM de alcancar alguem do meu deck ----
            //
            // Deck de Normais com Birthright: a reanimacao alcanca, e ele enterra.
            Zerar();
            minhaMao.Add(FOOLISH);
            meuDeck.Add(BIRTHRIGHT); meuDeck.Add(BEWD); meuDeck.Add(BATTLE_OX);
            var p5 = brain.Decide(Idle(FOOLISH), 1);
            Check("com Birthright no deck e NORMAIS para trazer, enterra", Ativou(p5),
                  $"(veio {p5.Action} — {p5.Why})");

            // PAR CONTROLE: o mesmo Birthright, num deck sem um Normal sequer.
            // Ha' reanimacao, ha' corpo, e mesmo assim nao ha' jogada — era isto
            // que a versao anterior desta regra nao sabia perguntar.
            Zerar();
            minhaMao.Add(FOOLISH);
            meuDeck.Add(BIRTHRIGHT); meuDeck.Add(DMOC); meuDeck.Add(BREAKER);
            var p6 = brain.Decide(Idle(FOOLISH), 1);
            Check("par CONTROLE: Birthright num deck SEM Normal, GUARDA", !Ativou(p6),
                  $"(veio {p6.Action} — {p6.Why})");

            // E a reanimacao cujo filtro o leitor nao entende nao entra no plano.
            Zerar();
            minhaMao.Add(FOOLISH);
            meuDeck.Add(MASTER_OF_CHAOS); meuDeck.Add(BEWD); meuDeck.Add(DMOC);
            var p7 = brain.Decide(Idle(FOOLISH), 1);
            Check("par CONTROLE: reanimacao de filtro ilegivel nao conta, GUARDA", !Ativou(p7),
                  $"(veio {p7.Action} — {p7.Why})");
        }

        // --------------------------------------------------------------- corpo

        static void OCorpo(string sa)
        {
            using var db = new DatabaseManager(sa);
            var minhaMao = new List<uint>();
            var meuDeck = new List<uint>();

            var brain = new NpcBrain(db,
                fieldOf: _ => new List<uint>(),
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                todoFieldPosOf: _ => new List<(uint, int, int)>(),
                listaDoDeckOf: p => p == 1 ? meuDeck : new List<uint>());

            InteractiveDuel.Question Idle(uint code)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = code, index = 0, location = HAND });
                return q;
            }

            // O que o motor oferece depois do Foolish Burial: os monstros que
            // estao no DECK, todos meus.
            InteractiveDuel.Question DoDeck(params uint[] codes)
            {
                var q = new InteractiveDuel.Question
                { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
                for (int i = 0; i < codes.Length; i++)
                    q.choices.Add(new InteractiveDuel.Sel
                    { code = codes[i], index = i, controller = 1, location = DECK, sequence = i });
                return q;
            }

            uint Escolhido(InteractiveDuel.Question q, List<int> picks) =>
                picks != null && picks.Count > 0 ? q.choices[picks[0]].code : 0;

            // Os monstros do deck do Yugi Chaos, na ordem em que o maior ATK vem
            // primeiro — que e' a pior ordem possivel para o criterio generico.
            var oferta = new[] { LUSTRO, MAGO_CAOS, DMOC, DARK_MAGICIAN, BREAKER };

            // PAR CONTROLE, e vem primeiro de proposito: a MESMA lista, sem a
            // marca da regra, cai no criterio generico (maior ATK impresso). Sem
            // esta linha, "escolheu o DMoC" nao provaria que alguem escolheu.
            var qCtrl = DoDeck(oferta);
            uint semRegra = Escolhido(qCtrl, brain.DecideSelect(qCtrl, 1));
            Check("par CONTROLE: sem a marca, o criterio generico enterra o LUSTRO (3000)",
                  semRegra == LUSTRO,
                  $"(veio {semRegra} — se nao for o Lustro, a armadilha mudou de lugar)");

            // Agora com a regra: ativar o Foolish deixa a marca, e a escolha
            // seguinte passa a ser "o maior entre os que VOLTAM".
            minhaMao.Clear(); minhaMao.Add(FOOLISH);
            meuDeck.Clear(); meuDeck.AddRange(YugiChaos());
            brain.Decide(Idle(FOOLISH), 1);
            var q1 = DoDeck(oferta);
            uint comRegra = Escolhido(q1, brain.DecideSelect(q1, 1));
            Check("com a marca, enterra o DARK MAGICIAN OF CHAOS (2800, que volta)",
                  comRegra == DMOC,
                  $"(veio {comRegra}; 200 de ATK a menos e o deck inteiro a mais)");

            // A marca vale por UMA pergunta. Sobrando, a proxima selecao — um
            // alvo, um custo — seria decidida pelo criterio do enterro.
            var q2 = DoDeck(oferta);
            uint depois = Escolhido(q2, brain.DecideSelect(q2, 1));
            Check("a marca e' consumida: a selecao seguinte volta ao criterio generico",
                  depois == LUSTRO, $"(veio {depois})");

            // Nenhum dos oferecidos volta: o motor JA' pediu a resposta, e nao
            // responder trava o duelo em silencio. Enterra o maior mesmo assim.
            minhaMao.Clear(); minhaMao.Add(FOOLISH);
            brain.Decide(Idle(FOOLISH), 1);
            var q3 = DoDeck(LUSTRO, MAGO_CAOS);
            uint semSaida = Escolhido(q3, brain.DecideSelect(q3, 1));
            Check("so' ritual na oferta: enterra o maior mesmo assim, nao trava",
                  semSaida == LUSTRO, $"(veio {semSaida})");

            // E o desempate por NIVEL, com o ATK empatado: entre dois corpos que
            // voltam e valem o mesmo, o mais caro de invocar e' o que mais ganha
            // em ficar no cemiterio.
            minhaMao.Clear(); minhaMao.Add(FOOLISH);
            brain.Decide(Idle(FOOLISH), 1);
            var q4 = DoDeck(BREAKER, DMOC, DARK_MAGICIAN);
            uint melhor = Escolhido(q4, brain.DecideSelect(q4, 1));
            Check("entre os que voltam, o de maior ATK (o Nv8 antes do Nv7)",
                  melhor == DMOC, $"(veio {melhor})");

            // ---- a REANIMACAO manda no alvo, nao o ATK ----
            //
            // Com o Birthright como unica reanimacao, o Dark Magician of Chaos
            // (2800) esta' fora: ele nao e' Normal e ela nunca o traria. O alvo
            // valido e' o proximo — o Dark Magician de 2500.
            minhaMao.Clear(); minhaMao.Add(FOOLISH);
            meuDeck.Clear(); meuDeck.Add(BIRTHRIGHT); meuDeck.Add(DARK_MAGICIAN); meuDeck.Add(DMOC);
            brain.Decide(Idle(FOOLISH), 1);
            var q5 = DoDeck(DMOC, DARK_MAGICIAN, BREAKER);
            uint comBirthright = Escolhido(q5, brain.DecideSelect(q5, 1));
            Check("so' com Birthright, enterra o DARK MAGICIAN (Normal), nao o do Caos",
                  comBirthright == DARK_MAGICIAN,
                  $"(veio {comBirthright}; o do Caos tem 300 de ATK a mais e ela nunca o traria)");

            // PAR CONTROLE: o MESMO deck, trocando so' a reanimacao. Sem esta
            // linha, "escolheu o Dark Magician" nao provaria que foi o filtro.
            minhaMao.Clear(); minhaMao.Add(FOOLISH);
            meuDeck.Clear(); meuDeck.Add(MONSTER_REBORN); meuDeck.Add(DARK_MAGICIAN); meuDeck.Add(DMOC);
            brain.Decide(Idle(FOOLISH), 1);
            var q6 = DoDeck(DMOC, DARK_MAGICIAN, BREAKER);
            uint comReborn = Escolhido(q6, brain.DecideSelect(q6, 1));
            Check("par CONTROLE: trocando para Monster Reborn, volta a ser o do Caos",
                  comReborn == DMOC, $"(veio {comReborn})");
        }

        // --------------------------------------------------------- necessidade

        /// <summary>
        /// **As tres razoes, cada uma no seu momento.** Cada par abaixo usa a
        /// MESMA oferta e muda so' a mesa — e' isso que prova que quem decidiu foi
        /// a necessidade, e nao a carta. Fora da carencia dela, cada razao tem de
        /// perder para o maior ATK, senao a regra atropela: um corpo de 900 que
        /// poe uma carta na mao passaria na frente de um de 3000 numa mesa calma.
        /// </summary>
        static void ANecessidade(string sa)
        {
            using var db = new DatabaseManager(sa);
            var minhaMao = new List<uint>();
            var meuDeck = new List<uint>();
            var campoDele = new List<uint>();

            var brain = new NpcBrain(db,
                fieldOf: p => p == 1 ? new List<uint>() : campoDele,
                log: _ => { },
                handOf: p => p == 1 ? minhaMao : new List<uint>(),
                todoFieldPosOf: p => p == 1
                    ? new List<(uint, int, int)>()
                    : campoDele.Select((c, i) => (c, 0x1, i)).ToList(),
                listaDoDeckOf: p => p == 1 ? meuDeck : new List<uint>());

            InteractiveDuel.Question Idle(uint code)
            {
                var q = new InteractiveDuel.Question { kind = "idle", player = 1 };
                q.activatable.Add(new InteractiveDuel.Act { code = code, index = 0, location = HAND });
                return q;
            }

            InteractiveDuel.Question DoDeck(params uint[] codes)
            {
                var q = new InteractiveDuel.Question
                { kind = "selectcard", player = 1, selMin = 1, selMax = 1 };
                for (int i = 0; i < codes.Length; i++)
                    q.choices.Add(new InteractiveDuel.Sel
                    { code = codes[i], index = i, controller = 1, location = DECK, sequence = i });
                return q;
            }

            /// <summary>Monta a mesa, ativa o enterro e devolve o corpo escolhido.</summary>
            uint Enterra(int naMinhaMao, uint[] campo, params uint[] oferta)
            {
                minhaMao.Clear();
                minhaMao.Add(FOOLISH);
                // Cartas de enchimento so' para dar TAMANHO a' mao — o Pote nao
                // participa de decisao nenhuma aqui.
                for (int i = 1; i < naMinhaMao; i++) minhaMao.Add(POT);
                campoDele.Clear(); campoDele.AddRange(campo);
                meuDeck.Clear();
                meuDeck.Add(MONSTER_REBORN);
                meuDeck.AddRange(oferta);

                var p = brain.Decide(Idle(FOOLISH), 1);
                if (p.Action != "activate") return 0;
                var q = DoDeck(oferta);
                var picks = brain.DecideSelect(q, 1);
                return picks != null && picks.Count > 0 ? q.choices[picks[0]].code : 0;
            }

            var mesaVazia = new uint[0];
            var mesaPesada = new[] { GAIA_NV7 };   // 2300, e o meu campo esta' vazio

            // ---- 1. GERAR RECURSO: so' com a mao curta ----
            uint a1 = Enterra(1, mesaVazia, BEWD, TOON_SORCERER);
            Check("mao curta: enterra o corpo que volta GERANDO CARTA (900), nao o 3000",
                  a1 == TOON_SORCERER, $"(veio {a1})");

            uint a2 = Enterra(6, mesaVazia, BEWD, TOON_SORCERER);
            Check("par CONTROLE: mao cheia, o mesmo par escolhe o 3000",
                  a2 == BEWD, $"(veio {a2}) — fora da carencia, a razao nao pode atropelar o ATK");

            // ---- 2. QUEBRAR O CAMPO: so' sob ameaca ----
            uint b1 = Enterra(6, mesaPesada, BEWD, TOON_BARREL);
            Check("sob ameaca: enterra quem QUEBRA o campo dele (2600), nao o 3000",
                  b1 == TOON_BARREL, $"(veio {b1})");

            uint b2 = Enterra(6, mesaVazia, BEWD, TOON_BARREL);
            Check("par CONTROLE: mesa calma, o mesmo par escolhe o 3000",
                  b2 == BEWD, $"(veio {b2})");

            // ---- 3. VIRAR DEFESA: so' sob ameaca, e so' quando ninguem quebra ----
            uint c1 = Enterra(6, mesaPesada, BATTLE_OX, MYSTICAL_ELF);
            Check("sob ameaca e sem quem quebre: enterra a PAREDE (800/2000)",
                  c1 == MYSTICAL_ELF, $"(veio {c1}) — pelo ATK o Boi de Batalha (1700) venceria");

            uint c2 = Enterra(6, mesaVazia, BATTLE_OX, MYSTICAL_ELF);
            Check("par CONTROLE: mesa calma, o mesmo par escolhe o de maior ATK",
                  c2 == BATTLE_OX, $"(veio {c2})");

            // E a ordem entre as duas razoes do campo: quebrar resolve de vez,
            // segurar so' adia — a mesma ordem da regra 5.55 (remocao antes de
            // trava). Aqui a parede segura MAIS (2000) e mesmo assim perde.
            uint d1 = Enterra(6, mesaPesada, MYSTICAL_ELF, TOON_BARREL);
            Check("sob ameaca, QUEBRAR vem antes de SEGURAR",
                  d1 == TOON_BARREL, $"(veio {d1})");
        }

        // ---------------------------------------------------------------- duelo

        /// <summary>
        /// O deck Yugi Chaos de verdade, contra um jogador que so' passa a vez.
        ///
        /// As secoes acima provam o CRITERIO sobre uma mesa montada aqui; este
        /// prova o resto do caminho — que a carta chega a `activatable` sozinha,
        /// que a decklist ATRAVESSA o `InteractiveDuel` ate' o cerebro (sem ela a
        /// regra nova nao dispara e nada acusa), e que o corpo que chega ao
        /// cemiterio e' um dos que VOLTAM.
        ///
        /// **Sao VARIOS embaralhamentos, e nao um.** Qual dos dois motivos sai
        /// depende da mao: com um Monster Reborn entre as cinco primeiras cartas,
        /// quem responde e' o motivo (a) — que ja' existia antes desta mudanca e
        /// nao prova nada de novo. Fixar um seed que caia no (b) funcionaria hoje
        /// e viraria falha alheia no dia em que o embaralhamento, a ordem do deck
        /// ou uma regra anterior mudassem: o teste passaria a acusar a carta
        /// errada. Aqui a pergunta e' se o caminho EXISTE, entao basta que UM dos
        /// duelos chegue ao (b) — e a segunda assercao vale em TODOS eles.
        /// </summary>
        static void NoDuelo(string sa)
        {
            using var db = new DatabaseManager(sa);

            var motivos = new List<string>();
            var enterrados = new List<uint>();
            int comFoolish = 0;

            foreach (ulong seed in new ulong[] { 20260826UL, 7UL, 31337UL, 99UL })
            {
                var (m, ent) = UmDuelo(sa, seed);
                motivos.AddRange(m);
                enterrados.AddRange(ent);
                if (m.Any(x => x.Contains(FOOLISH.ToString()))) comFoolish++;
                Log.Info($"  seed {seed}: {m.Count} ativacoes, {ent.Count} enterrada(s)" +
                         (ent.Count > 0
                            ? $" — {string.Join(", ", ent.Select(c => $"{c} ({db.Nome(c)})"))}"
                            : ""));
            }

            bool Saiu(string trecho) => motivos.Any(m => m.Contains(trecho));

            Check("o Foolish Burial saiu sozinho nos duelos", comFoolish > 0,
                  $"(motivos: {string.Join(" | ", motivos.Distinct().Take(10))})");
            Check("...e ao menos um saiu por ADIANTAMENTO — a decklist chegou ao cerebro",
                  Saiu("ADIANTADO"),
                  "(sem o acessor do deck a regra nova nao dispara em duelo nenhum, e nada acusa)");
            Check("todo corpo enterrado VOLTA do cemiterio", enterrados.Count > 0
                  && enterrados.All(db.VoltaDoCemiterio),
                  $"(foram: {string.Join(", ", enterrados.Select(c => $"{c} ({db.Nome(c)})"))})");
        }

        /// <summary>Um duelo do Yugi Chaos contra um jogador que so' passa a vez.
        /// Devolve os motivos das ativacoes do NPC e o que ele mandou do DECK
        /// para o cemiterio.</summary>
        static (List<string> motivos, List<uint> enterrados) UmDuelo(string sa, ulong seed)
        {
            uint[] chaos = YugiChaos().ToArray();
            uint[] chaosExtra = { MASTER_OF_CHAOS, 73452089 };

            var deckJogador = new List<uint>();
            for (int i = 0; i < 40; i++) deckJogador.Add(i % 2 == 0 ? GAIA_NV7 : BATTLE_OX);

            using var duel = new InteractiveDuel(sa, deckJogador.ToArray(), seed, 0x1000000UL,
                                                 npc: true, npcDeck: chaos, npcExtra: chaosExtra);
            var r = duel.Advance();

            var motivos = new List<string>();
            var enterrados = new List<uint>();

            for (int guard = 0; guard < 400 && !r.ended; guard++)
            {
                foreach (var e in r.events)
                {
                    var (acao, why) = LerNpc(e);
                    if (acao == "activate" && why != null) motivos.Add(why);

                    var mv = LerMove(e);
                    if (mv.ok && mv.fromLoc == DECK && mv.loc == GRAVE && mv.controller == 1)
                        enterrados.Add(mv.code);
                }

                var q = r.question;
                if (q == null) break;

                if (q.kind == "idle" && q.player == 0)
                {
                    r = duel.Respond("endturn", 0);
                    continue;
                }
                r = Padrao(duel, q);
            }
            return (motivos, enterrados);
        }

        // ----------------------------------------------------------- auxiliares

        /// <summary>
        /// O main deck do `decks/npc/yugi/yugi_chaos.ydk`. Copiado aqui de
        /// proposito: o teste tem de continuar valendo mesmo quando alguem editar
        /// o deck publicado — a pergunta que ele faz e' sobre a REGRA, e um deck
        /// que mude embaixo dela trocaria uma falha de regra por um teste que
        /// simplesmente para de exercitar o caso.
        /// </summary>
        static List<uint> YugiChaos() => new()
        {
            POT, POT, POT,
            MONSTER_REBORN, MONSTER_REBORN, MONSTER_REBORN,
            76792184,                       // Black Magic Ritual
            55761792,                       // Black Luster Ritual
            LUSTRO, LUSTRO,
            MAGO_CAOS, MAGO_CAOS,
            15256925, 15256925, 15256925,   // Chaos Scepter Blast
            13048472, 13048472, 13048472,   // Pre-Preparation of Rites
            DMOC, DMOC,
            DARK_MAGICIAN,
            GRACEFUL, GRACEFUL, GRACEFUL,
            24094653, 24094653,             // Polymerization
            BREAKER, BREAKER, BREAKER,
            FOOLISH, FOOLISH, FOOLISH,
            21082832, 21082832,             // Chaos Form
            31550470, 31550470,             // Escape from the Dark Dimension
            27174286,                       // Return from the Different Dimension
            70342110, 70342110, 70342110,   // Dimensional Prison
        };

        static (string acao, string why) LerNpc(object e)
        {
            var t = e.GetType();
            if ((t.GetProperty("type")?.GetValue(e) as string) != "npc") return (null, null);
            return (t.GetProperty("action")?.GetValue(e) as string,
                    t.GetProperty("why")?.GetValue(e) as string);
        }

        static (bool ok, uint code, int fromLoc, int loc, int controller) LerMove(object e)
        {
            var t = e.GetType();
            if ((t.GetProperty("type")?.GetValue(e) as string) != "move")
                return (false, 0, 0, 0, 0);
            return (true,
                    Convert.ToUInt32(t.GetProperty("code").GetValue(e)),
                    Convert.ToInt32(t.GetProperty("fromLoc").GetValue(e)),
                    Convert.ToInt32(t.GetProperty("loc").GetValue(e)),
                    Convert.ToInt32(t.GetProperty("controller").GetValue(e)));
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

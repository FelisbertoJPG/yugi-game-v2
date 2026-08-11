using System;
using System.Collections.Generic;
using System.Linq;

namespace DuelServer
{
    /// <summary>
    /// IA do "NPC do Teste de Batalha" — o primeiro oponente que realmente joga.
    ///
    /// As regras são exatamente as pedidas, nesta ordem de prioridade:
    ///   4. Pote da Ganância vem sempre antes de qualquer invocação.
    ///   3. Se der para invocar um monstro de nível maior (com tributo), é ele.
    ///   2. Se o oponente tem em campo um monstro com ATK maior que tudo que o NPC
    ///      tem na mão, o NPC SETA o monstro de maior DEF (defesa).
    ///   1. Caso contrário, invoca em ataque o monstro de maior ATK (Nv 1-4).
    ///   0. Nada a fazer: encerra o turno.
    ///
    /// Nota sobre "por em defesa": pelas regras oficiais, Invocação Normal é
    /// sempre em ataque com a face para cima — quem coloca em defesa é o Set
    /// (face para baixo). Por isso a regra 2 vira um Set, que é a única forma
    /// legal de colocar um monstro em defesa no próprio turno.
    /// </summary>
    public sealed class NpcBrain
    {
        public const uint POT_OF_GREED = 55144522;

        // Cartas com efeito que o NPC sabe pilotar por ID.
        const uint MONSTER_REBORN = 83764718;    // reanima o mais forte do GY
        const uint TRIBUTE_TO_DOOMED = 79759861;  // descarta 1 → destrói 1 monstro
        const uint BURST_STREAM = 17655904;       // destrói todos os monstros do oponente (exige Blue-Eyes)
        const uint TIME_WIZARD = 71625222;        // moeda: cara varre o campo dele, coroa varre o meu
        const uint TOON_WORLD = 15259703;         // habilita o pacote Toon inteiro

        // Pacote do Wevil: o casulo transforma um Inseto fraco em Larvae/Great/
        // Perfectly Ultimate Great Moth depois de 2/4/6 turnos equipado — o motor
        // já faz a contagem sozinha (ver TestWeevil), o NPC só precisa: equipar
        // no inseto MAIS FRACO (não no melhor atacante — o ATK dele vira 0
        // enquanto durar), e depois Invocar Especialmente cada mariposa assim
        // que o motor a oferecer em `spSummonable`.
        const uint COCOON_OF_EVOLUTION = 40240595;
        const uint INSECT_ARMOR_LASER = 3492538;   // +700 ATK — o alvo default (maior ATK) já serve
        const uint INSECT_IMITATION = 96965364;    // tributa 1 inseto fraco, traz 1 mais forte do deck
        // O Lua do Cocoon (s.filter) só aceita Petit Moth COM A FACE PRA CIMA
        // como alvo — setado (virado) não serve nunca. Só existe 1 código.
        const uint PETIT_MOTH = 58192742;
        static readonly HashSet<uint> MARIPOSAS_CASULO = new()
        {
            87756343, // Larvae Moth
            14141448, // Great Moth
            48579379, // Perfectly Ultimate Great Moth
        };

        const byte HAND = 0x2, MZONE = 0x4, SZONE = 0x8, GRAVE = 0x10;
        const uint TYPE_SPELL = 0x2, TYPE_TRAP = 0x4, TYPE_RITUAL = 0x80;

        // ---------------- armadilhas de contra (negação) ----------------
        //
        // As quatro da Lista 1. Cada uma nega uma coisa diferente e cobra um
        // preço diferente — e é o PREÇO que faz a decisão ser difícil: a janela
        // sempre aparece, mas ativar por ativar é como jogar a carta fora (ou,
        // no caso do Solemn Judgment, jogar metade da vida fora).
        //
        // Vão por ID, e não pelo bit TYPE_COUNTER, por um motivo concreto: o
        // Negate Attack (14315573) também é Armadilha de Contra e já estava na
        // Lista 1, mas o gatilho dele é uma DECLARAÇÃO DE ATAQUE — não uma
        // invocação nem uma ativação. Pela regra genérica lá embaixo ele já é
        // ativado na hora certa (o motor só abre a janela dele durante o ataque);
        // se entrasse aqui pelo tipo, a avaliação abaixo não acharia gatilho
        // nenhum para ele e o NPC pararia de usá-lo.
        const uint SOLEMN_JUDGMENT = 41420027;  // METADE dos LP — nega invocação OU magia/armadilha
        const uint MAGIC_JAMMER = 77414722;     // descarta 1 carta — nega Magia
        const uint SEVEN_TOOLS = 3819470;       // 1000 LP — nega Armadilha
        const uint HORN_OF_HEAVEN = 98069388;   // tributa 1 monstro — nega invocação

        /// <summary>O que uma armadilha de contra nega e o que ela cobra.</summary>
        readonly struct Contra
        {
            public readonly bool Invocacao, Magia, Armadilha;
            /// <summary>Ordem de preferência: menor = mais barato, tentado primeiro.</summary>
            public readonly int Ordem;
            public readonly int LpFixo;        // LP pagos (0 = não cobra LP fixo)
            public readonly bool MetadeLp;     // cobra METADE dos LP
            public readonly bool Tributo;      // cobra 1 monstro do próprio campo
            public Contra(bool inv, bool mag, bool arm, int ordem,
                          int lpFixo = 0, bool metadeLp = false, bool tributo = false)
            { Invocacao = inv; Magia = mag; Armadilha = arm; Ordem = ordem;
              LpFixo = lpFixo; MetadeLp = metadeLp; Tributo = tributo; }
        }

        /// <summary>
        /// A tabela de negação. A `Ordem` é o que faz o NPC gastar a carta certa:
        /// tendo Magic Jammer E Solemn Judgment na mesma janela contra uma magia,
        /// descartar 1 carta é muito mais barato que perder metade da vida — e o
        /// Solemn fica guardado para o que só ele resolve.
        /// </summary>
        static readonly Dictionary<uint, Contra> CONTRA = new()
        {
            [MAGIC_JAMMER] = new Contra(inv: false, mag: true, arm: false, ordem: 1),
            [SEVEN_TOOLS] = new Contra(inv: false, mag: false, arm: true, ordem: 2, lpFixo: 1000),
            [HORN_OF_HEAVEN] = new Contra(inv: true, mag: false, arm: false, ordem: 3, tributo: true),
            [SOLEMN_JUDGMENT] = new Contra(inv: true, mag: true, arm: true, ordem: 4, metadeLp: true),
        };

        /// <summary>
        /// **A escala de ameaça.** Quanto uma magia/armadilha do oponente
        /// atrapalha, medido na mesma unidade do ATK de um monstro — é isso que
        /// permite comparar "a magia que ele acabou de ativar" com "o monstro que
        /// ainda está na mão dele" e decidir qual merece a negação.
        ///
        /// Não dá para "ler" o efeito de uma carta (quem sabe o que ela faz é o
        /// Lua), então o peso é atribuído à mão, do mesmo jeito que
        /// REMOCAO_MONSTRO e BURN aqui em cima. Quem não está na tabela pesa 0:
        /// o silêncio significa "não atrapalha", que é o erro barato — errar para
        /// menos deixa uma armadilha setada; errar para mais gasta metade dos LP
        /// num Pote da Ganância.
        /// </summary>
        static readonly Dictionary<uint, int> PESO_AMEACA = new()
        {
            // varredura: leva o campo inteiro de uma vez
            [12580477] = 3000, // Raigeki
            [53129443] = 3000, // Dark Hole
            [18144506] = 2800, // Harpie's Feather Duster (varre as MINHAS setadas)
            [19613556] = 2800, // Heavy Storm (idem)
            [44095762] = 2600, // Mirror Force — leva todos os meus atacantes
            [17655904] = 2600, // Burst Stream of Destruction (Blue-Eyes)
            // corpo grande de graça / roubo
            [4031928] = 2400,  // Change of Heart — rouba o meu melhor monstro
            [83764718] = 2300, // Monster Reborn
            [70828912] = 2300, // Premature Burial
            [72302403] = 2200, // Swords of Revealing Light — trava 3 turnos
            [97077563] = 2000, // Call of the Haunted
            [24094653] = 2000, // Polymerization — o problema é o corpo que entra
            [2314238] = 2000,  // Dark Magic Attack
            [52684508] = 2000, // Inferno Fire Blast
            [41420027] = 2000, // Solemn Judgment  ─┐ negação do outro lado: negar a
            [98069388] = 1800, // Horn of Heaven    ├─ negação salva a minha carta
            [77414722] = 1600, // Magic Jammer      │
            [3819470] = 1500,  // Seven Tools      ─┘
            // remoção pontual
            [79759861] = 1900, // Tribute to The Doomed
            [4206964] = 1800,  // Trap Hole
            [56120475] = 1800, // Sakuretsu Armor
            [62279055] = 1800, // Magic Cylinder — devolve o meu ataque como dano
            [83887306] = 1700, // Two-Pronged Attack
            [66788016] = 1600, // Fissure
            [56830749] = 1600, // Share the Pain
            [60082869] = 1500, // Dust Tornado
        };

        /// <summary>Quanto esta carta atrapalha, na escala do ATK. Monstro vale o
        /// próprio ATK; magia/armadilha, o peso da tabela (0 = não atrapalha).</summary>
        int Peso(uint code)
        {
            var st = _cards.Stats(code);
            if (st.IsMonster) return st.AtkValue;
            return PESO_AMEACA.TryGetValue(code, out int p) ? p : 0;
        }

        /// <summary>
        /// A partir daqui uma magia/armadilha é "perigosa": vale uma negação, e
        /// vale gastar uma remoção para tirá-la do caminho.
        /// </summary>
        const int PESO_PERIGOSO = 1500;

        /// <summary>
        /// Ameaça que não se segura: mesmo sabendo que vem coisa pior na mão dele,
        /// deixar passar já perde o jogo. É o teto da regra da isca (ver
        /// <see cref="EscolheNegacao"/>) — sem ele, um Raigeki guardado na mão do
        /// oponente faria o NPC segurar a negação para sempre.
        /// </summary>
        const int PESO_INEGOCIAVEL = 2500;

        /// <summary>
        /// Varredura de MONSTRO na mão do oponente. Saber disso muda uma coisa
        /// só, mas muda muito: não pôr o segundo/terceiro corpo em campo para ele
        /// levar todos de uma vez.
        /// </summary>
        static readonly HashSet<uint> VARREDURA_MONSTRO = new()
        {
            12580477, // Raigeki
            53129443, // Dark Hole
        };

        /// <summary>Varredura de MAGIA/ARMADILHA: o mesmo raciocínio, mas para
        /// não empilhar armadilhas setadas que sairiam todas juntas.</summary>
        static readonly HashSet<uint> VARREDURA_ST = new()
        {
            18144506, // Harpie's Feather Duster
            19613556, // Heavy Storm
        };

        /// <summary>
        /// Armadilhas que punem QUEM ATACA (o atacante morre ou o dano volta).
        /// Contra elas o NPC ataca com o monstro mais fraco que ainda vence a
        /// batalha, em vez do mais forte: o prejuízo é o mesmo 1-por-1, mas custa
        /// o corpo barato em vez do bom.
        /// </summary>
        static readonly HashSet<uint> PUNE_O_ATACANTE = new()
        {
            56120475, // Sakuretsu Armor — destrói o atacante
            62279055, // Magic Cylinder — devolve o ATK do atacante como dano
        };

        /// <summary>
        /// Armadilhas que punem TODO O CAMPO ao primeiro ataque. Com uma dessas
        /// baixada, atacar com vários monstros é entregar todos eles — mas nunca
        /// atacar trava o duelo. A saída é a jogada de verdade: puxá-la com UM
        /// monstro só (ver <see cref="DecideBattle"/>).
        /// </summary>
        static readonly HashSet<uint> PUNE_O_CAMPO_TODO = new()
        {
            44095762, // Mirror Force
        };

        /// <summary>
        /// Abaixo disto uma invocação não justifica negação nenhuma: é um corpo
        /// que a batalha resolve. 1800 é a faixa do beater Nv4 que os monstros do
        /// pool não superam com facilidade.
        /// </summary>
        const int AMEACA_QUE_JUSTIFICA_NEGAR = 1800;

        /// <summary>
        /// LP que o NPC se recusa a cruzar para pagar uma negação. Não é medo de
        /// perder: com 1000 ou menos, qualquer queima (Ookazi, Hinotama) vira
        /// letal, e aí a armadilha que ele negou deixa de ser o problema.
        /// </summary>
        const int LP_PISO = 1000;

        // "Ativar quando der" — decks reais além do Kaiba/Joey. Burn = dano fixo,
        // dispara sempre; remoção de monstro/ST só quando há alvo. O RITUAL é
        // reconhecido por TIPO (qualquer magia-ritual), não por ID — assim o combo
        // ritual→GY→Reborn vale pro Skull Guardian (Kaiba), Zera/Fortress (Joey) etc.
        static readonly HashSet<uint> BURN = new()
        {
            19523799, // Ookazi
            46130346, // Hinotama
            76103675, // Sparks
            73134081, // Final Flame
            46918794, // Tremendous Fire
            52684508, // Inferno Fire Blast (Red-Eyes)
        };
        static readonly HashSet<uint> REMOCAO_MONSTRO = new()
        {
            12580477, // Raigeki
            53129443, // Dark Hole
            66788016, // Fissure
        };
        static readonly HashSet<uint> REMOCAO_ST = new()
        {
            18144506, // Harpie's Feather Duster
            5318639,  // Mystical Space Typhoon
            60082869, // Dust Tornado (Armadilha Normal)
        };

        /// <summary>
        /// Magias/armadilhas que vale destruir mesmo ABERTAS no campo.
        ///
        /// O caso que motivou a lista: Call of the Haunted é contínua e fica com
        /// a face para cima. O script dela destrói o monstro revivido quando ela
        /// sai do campo — então um Dust Tornado nela é 2-por-1, e não o
        /// desperdício que seria estourar uma magia normal já resolvida.
        ///
        /// Critério para entrar aqui: a carta tem de SUSTENTAR alguma coisa
        /// enquanto está em campo. Magia normal, que resolve e vai embora, nunca
        /// entra.
        /// </summary>
        static readonly HashSet<uint> ALVO_ST_ABERTO = new()
        {
            97077563, // Call of the Haunted — leva junto o monstro que reviveu
            72302403, // Swords of Revealing Light — trava os ataques por 3 turnos
        };

        /// <summary>
        /// Magias que FUNDEM. Vão por ID, e não por tipo como o ritual, porque
        /// não existe bit de "magia de fusão": a Polymerization é uma Magia
        /// Normal comum — quem carrega a receita é o monstro fundido, no Lua
        /// dele. Sem type flag para consultar, a lista é explícita.
        /// </summary>
        static readonly HashSet<uint> FUSAO = new()
        {
            24094653, // Polymerization
        };

        /// <summary>
        /// "Adição específica": busca uma carta NOMEADA do deck para a mão
        /// (diferente da compra às cegas do Pote da Ganância).
        ///
        /// Existem para ser usadas ANTES da compra. O motivo é concreto: comprar
        /// primeiro pode trazer justamente a carta que a busca traria, e aí a
        /// busca vira carta morta. Buscar primeiro nunca desperdiça, e ainda
        /// afina o deck para a compra seguinte.
        /// </summary>
        static readonly HashSet<uint> BUSCA_ESPECIFICA = new()
        {
            26902560, // Fusion Sage — busca 1 Polymerization
            // King of the Swamp — descarta a si mesmo para buscar 1 Polymerization.
            // O descarte NÃO é perda: ele é substituto de material de fusão e o
            // `subcon` do script dele aceita HAND, ONFIELD **e GRAVE**. Ou seja,
            // vai para o cemitério e continua servindo de matéria. Buscar com ele
            // é ganho puro, e por isso entra na mesma lista da Sage.
            79109599,
            // Reinforcement of the Army — busca 1 Guerreiro Nv≤4. Não nomeia uma
            // carta como as outras duas, mas é a mesma jogada: tirar do deck em
            // vez de comprar às cegas, e por isso vale a mesma prioridade.
            32807846,
            // Toon Table of Contents — busca 1 carta "Toon" (qual, o DecideSelect
            // decide: Toon World primeiro, se ainda não estiver na mão/campo).
            89997728,
        };

        /// <summary>
        /// Toons "clássicos": não podem ser Invocados/Setados normalmente — só
        /// entram por Invocação Especial DA MÃO (`spSummonable`) enquanto o NPC
        /// controla Toon World, alguns pedindo tributo (o motor só oferece a
        /// opção quando o custo é pagável; o alvo do tributo é o DecideSelect de
        /// sempre, que já sacrifica os mais fracos). Os Toons "modernos" (Gemini
        /// Elf, Cannon Soldier, Barrel Dragon etc.) NÃO entram aqui: eles são
        /// Invocação Normal comum e a lógica de beatdown (`Monstros(q.summonable)`)
        /// já os pega de graça, sem precisar saber que são Toon.
        /// </summary>
        static readonly HashSet<uint> TOON_ESPECIAIS = new()
        {
            65458948, // Toon Mermaid — sem tributo
            91842653, // Toon Summoned Skull — tributa 1
            90960358, // Toon Dark Magician Girl — tributa 1
            53183600, // Blue-Eyes Toon Dragon — tributa 2
        };

        readonly DatabaseManager _cards;
        readonly Func<int, IReadOnlyList<uint>> _fieldOf;   // monstros face-up em campo
        readonly Func<int, IReadOnlyList<uint>> _handOf;    // cartas na mão de um jogador
        readonly Func<int, int> _stCountOf;                 // zonas de magia/armadilha ocupadas
        readonly Func<int, int> _setStCountOf;              // dessas, quantas estão VIRADAS
        readonly Func<int, IReadOnlyList<uint>> _faceUpStOf; // magias/armadilhas ABERTAS
        readonly Func<int, IReadOnlyList<(uint code, int pos)>> _fieldPosOf;
        readonly Func<int, int> _lpOf;                       // pontos de vida
        // ---- leitura (o que um humano NÃO veria) ----
        // Todos os monstros, inclusive os virados, com a sequência da zona (é ela
        // que o motor usa para identificar quem muda de posição).
        readonly Func<int, IReadOnlyList<(uint code, int pos, int seq)>> _todoFieldPosOf;
        readonly Func<int, IReadOnlyList<uint>> _setStOf;    // magias/armadilhas VIRADAS
        readonly Action<string> _log;

        const int POS_ATAQUE = 0x1, POS_DEFESA = 0x4, POS_DEFESA_VIRADA = 0x8;

        public NpcBrain(DatabaseManager cards,
                        Func<int, IReadOnlyList<uint>> fieldOf,
                        Action<string> log = null,
                        Func<int, IReadOnlyList<uint>> handOf = null,
                        Func<int, int> stCountOf = null,
                        Func<int, IReadOnlyList<(uint code, int pos)>> fieldPosOf = null,
                        Func<int, int> setStCountOf = null,
                        Func<int, IReadOnlyList<uint>> faceUpStOf = null,
                        Func<int, int> lpOf = null,
                        Func<int, IReadOnlyList<(uint code, int pos, int seq)>> todoFieldPosOf = null,
                        Func<int, IReadOnlyList<uint>> setStOf = null)
        {
            _cards = cards;
            _fieldOf = fieldOf;
            _log = log ?? (_ => { });
            _handOf = handOf ?? (_ => Array.Empty<uint>());
            _stCountOf = stCountOf ?? (_ => 0);
            _setStCountOf = setStCountOf ?? (_ => 0);
            _faceUpStOf = faceUpStOf ?? (_ => Array.Empty<uint>());
            // Sem quem informe, assume o LP inicial: é o que os testes de decisão
            // isolada montam, e mantém a regra de custo funcionando neles. Num
            // duelo de verdade o InteractiveDuel sempre passa o valor real.
            _lpOf = lpOf ?? (_ => 8000);
            // Sem quem informe, a leitura simplesmente não existe e o NPC cai no
            // comportamento antigo (só o que está com a face para cima). Nenhuma
            // regra nova dispara — elas todas exigem CONHECER a carta.
            // Sem leitura, cai no que está com a face para cima e sem sequência
            // (−1): as regras que dependem de mudar posição simplesmente não têm
            // como casar a zona, e não disparam.
            _todoFieldPosOf = todoFieldPosOf
                ?? (p => _fieldPosOf(p).Select(m => (m.code, m.pos, -1)).ToList());
            _setStOf = setStOf ?? (_ => Array.Empty<uint>());
            // Sem informação de posição, assume ATAQUE — é o comportamento
            // anterior, e mantém os testes que montam campo só com códigos.
            _fieldPosOf = fieldPosOf
                ?? (p => _fieldOf(p).Select(c => (c, POS_ATAQUE)).ToList());
        }

        /// <summary>
        /// Quanto vale ENFRENTAR este monstro: a ATK se ele está em ataque, a DEF
        /// se está deitado. É o número que a batalha realmente usa — comparar
        /// sempre pela ATK fazia o NPC atacar uma parede 800/2000 achando que
        /// enfrentava 800.
        /// </summary>
        int ValorNaBatalha((uint code, int pos) m)
        {
            var st = _cards.Stats(m.code);
            // 0x4 é defesa aberta, 0x8 é defesa VIRADA — o setado do oponente cai
            // nesta segunda, e é exatamente ele que o NPC só passou a enxergar
            // com a leitura de campo.
            return (m.pos & (POS_DEFESA | POS_DEFESA_VIRADA)) != 0 ? st.DefValue : st.AtkValue;
        }

        // ---- leitura: o que o oponente tem guardado ----

        /// <summary>
        /// Os monstros do oponente (inclusive os VIRADOS, com a DEF real), já
        /// avaliados pelo número que a batalha usa.
        /// </summary>
        List<(uint code, int valor)> MonstrosDele(int foe) =>
            _todoFieldPosOf(foe)
                .Where(m => _cards.Stats(m.code).IsMonster)
                .Select(m => (m.code, valor: ValorNaBatalha((m.code, m.pos))))
                .ToList();

        /// <summary>A carta mais ameaçadora na mão do jogador, na escala do
        /// <see cref="Peso"/>. (0,0) quando não há nada que atrapalhe.</summary>
        (uint code, int peso) MaiorAmeacaNaMao(int player)
        {
            uint melhor = 0; int peso = 0;
            foreach (uint c in _handOf(player))
            {
                int p = Peso(c);
                if (p > peso) { peso = p; melhor = c; }
            }
            return (melhor, peso);
        }

        /// <summary>Ele tem uma destas na mão? Devolve a carta (ou 0).</summary>
        uint NaMaoDele(int foe, HashSet<uint> quais) =>
            _handOf(foe).FirstOrDefault(quais.Contains);

        /// <summary>Ele tem uma destas BAIXADA (virada)? Devolve a carta (ou 0).</summary>
        uint SetadaDele(int foe, HashSet<uint> quais) =>
            _setStOf(foe).FirstOrDefault(quais.Contains);

        /// <summary>
        /// Vale gastar uma remoção de magia/armadilha agora, e em QUEM?
        ///
        /// Três respostas possíveis, e a ordem é a da regra:
        ///   • uma ABERTA que sustenta alguma coisa (Call of the Haunted, Swords)
        ///     — destruí-la leva junto o que ela sustenta. Magia aberta que já
        ///     resolveu nunca entra: estourá-la não desfaz nada;
        ///   • com leitura, a SETADA mais pesada, se ela realmente atrapalhar —
        ///     é o ganho: guardar o Dust Tornado para a Mirror Force em vez de
        ///     queimá-lo na primeira carta virada que aparecer;
        ///   • sem leitura (ninguém informou os códigos), volta ao critério
        ///     antigo de cada chamador — que NÃO é o mesmo nos dois: na corrente
        ///     vale "ele tem carta VIRADA" (estourar magia aberta que já está
        ///     resolvendo não impede nada), e na Main Phase vale "ele tem
        ///     magia/armadilha em campo". Por isso o fallback vem de fora.
        /// `alvo` 0 significa "vale, mas não sei qual" — quem escolhe é o motor.
        /// </summary>
        (bool vale, uint alvo, string porque) AlvoDaRemocaoSt(int foe, bool valeSemLeitura)
        {
            var abertaValiosa = _faceUpStOf(foe).FirstOrDefault(ALVO_ST_ABERTO.Contains);
            if (abertaValiosa != 0)
                return (true, abertaValiosa,
                    $"{abertaValiosa} aberta (leva junto o que ela sustenta)");

            var setadas = _setStOf(foe);
            if (setadas.Count == 0)
                return valeSemLeitura
                    ? (true, 0u, "magia/armadilha do oponente (sem leitura do que e')")
                    : (false, 0u, "ele nao tem alvo que valha");

            uint melhor = 0; int peso = 0;
            foreach (uint c in setadas)
            {
                int p = Peso(c);
                if (p > peso) { peso = p; melhor = c; }
            }
            return peso >= PESO_PERIGOSO
                ? (true, melhor, $"a {melhor} baixada dele (peso {peso})")
                : (false, 0u, $"as {setadas.Count} setadas dele nao valem a remocao");
        }

        // ---- atalhos de leitura da situação ----
        bool Ativavel(InteractiveDuel.Question q, uint code) => q.activatable.Any(a => a.code == code);
        int IdxAtivavel(InteractiveDuel.Question q, uint code) => q.activatable.First(a => a.code == code).index;
        bool NaMao(int me, uint code) => _handOf(me).Contains(code);
        bool EhArmadilha(uint code) => (_cards.Stats(code).Type & TYPE_TRAP) != 0;
        bool EhRitual(uint code) { var t = _cards.Stats(code).Type; return (t & TYPE_SPELL) != 0 && (t & TYPE_RITUAL) != 0; }
        int QtdMonstros(int player) => _fieldOf(player).Count(c => _cards.Stats(c).IsMonster);
        InteractiveDuel.Act AtivavelSe(InteractiveDuel.Question q, Func<uint, bool> ok) => q.activatable.FirstOrDefault(a => ok(a.code));

        /// <summary>O que o NPC decidiu fazer, já no vocabulário do InteractiveDuel.</summary>
        public readonly struct Play
        {
            public readonly string Action;   // activate | summon | setmonster | endturn
            public readonly int Index;
            public readonly string Why;
            public Play(string action, int index, string why)
            { Action = action; Index = index; Why = why; }
        }

        /// <summary>Decisão da Battle Phase: atacar (com qual monstro) ou encerrar.</summary>
        public readonly struct BattlePlay
        {
            public readonly bool Attack;
            public readonly int Index;
            public readonly string Why;
            public BattlePlay(bool attack, int index, string why)
            { Attack = attack; Index = index; Why = why; }
        }

        /// <summary>Uma carta candidata, já com os stats resolvidos.</summary>
        readonly struct Cand
        {
            public readonly InteractiveDuel.Act Act;
            public readonly DatabaseManager.CardStats St;
            public readonly bool Ok;
            public Cand(InteractiveDuel.Act act, DatabaseManager.CardStats st)
            { Act = act; St = st; Ok = true; }

            /// <summary>Statline ofensivo: só vale a pena em ataque se ATK &gt; DEF.</summary>
            public bool Ofensivo => St.AtkValue > St.DefValue;
        }

        /// <summary>
        /// Main Phase. Ordem de decisão do deck Blue-Eyes do Kaiba (a estratégia
        /// que o jogador descreveu):
        ///   0. Busca específica (Fusion Sage) — ANTES da compra, senão o Pote
        ///      pode trazer a carta buscada e matar a busca.
        ///   0.1 Pote da Ganância.
        ///   1. COMBO: Tribute to The Doomed com Monster Reborn na mão — descarta
        ///      um dragão para estourar a ameaça e revivê-lo depois.
        ///   2. Setar armadilha (mantendo SEMPRE ≥1 zona de magia/arm. livre).
        ///   3. Tribute to The Doomed sem o Reborn — ainda estoura a ameaça real.
        ///   4. Monster Reborn — reanima o mais forte do cemitério.
        ///   5. Ritual (Skull Guardian) tributando monstro de nível alto.
        ///   5.1 Fusão (Polymerization) — mesma lógica do ritual: corpo grande em
        ///      campo e materiais no cemitério, alimentando o Reborn.
        ///   6. Beatdown: sobe os dragões (sacrificando os fracos) ou beater Nv4.
        ///   7. Burst Stream of Destruction — só quando limpa 2+ monstros.
        ///   8. Batalha / encerrar o turno.
        /// As escolhas de tributo/alvo/descarte ficam no DecideSelect.
        /// </summary>
        public Play Decide(InteractiveDuel.Question q, int me)
        {
            int foe = 1 - me;

            // 0. BUSCA ESPECÍFICA antes da compra. Comprar primeiro pode trazer a
            //    carta que a busca traria — e aí a busca vira carta morta. Buscar
            //    primeiro nunca desperdiça. O Pote continua logo abaixo, então na
            //    decisão seguinte ele sai do mesmo jeito, só que com o deck já
            //    afinado.
            var buscaEsp = AtivavelSe(q, BUSCA_ESPECIFICA.Contains);
            if (buscaEsp.code != 0)
                return new Play("activate", buscaEsp.index,
                    $"busca especifica antes da compra ({buscaEsp.code})");

            // 0.1 Pote da Ganância antes de qualquer invocação.
            if (Ativavel(q, POT_OF_GREED))
                return new Play("activate", IdxAtivavel(q, POT_OF_GREED), "Pote da Ganancia primeiro");

            // 0.2 Toon World o quanto antes: sem ele os Toons "clássicos" da mão
            // não têm como entrar (spsummon) e os "modernos" em campo não atacam
            // direto. É a carta que faz o resto do pacote Toon funcionar.
            if (Ativavel(q, TOON_WORLD))
                return new Play("activate", IdxAtivavel(q, TOON_WORLD),
                    "Toon World o quanto antes — habilita invocacao especial e ataque direto dos Toons");

            int ameaca = MaiorAtkEmCampo(foe);
            int meuMelhor = MaiorAtkEmCampo(me);
            bool oponenteTemMonstro = _fieldOf(foe).Any(c => _cards.Stats(c).IsMonster);
            // "ameaça real": o oponente tem um monstro que meu campo não supera.
            bool ameacaReal = oponenteTemMonstro && (meuMelhor < 0 || ameaca >= meuMelhor);

            // 1. COMBO no topo: Tribute to The Doomed + Monster Reborn na mão.
            if (Ativavel(q, TRIBUTE_TO_DOOMED) && ameacaReal && NaMao(me, MONSTER_REBORN))
                return new Play("activate", IdxAtivavel(q, TRIBUTE_TO_DOOMED),
                    "combo: Tribute to The Doomed (descarta dragao) + Monster Reborn na mao");

            // 2. Setar armadilha — só se sobrar ≥1 zona livre (magias reciclam o slot).
            //    LEITURA DE MÃO: com Heavy Storm/Harpie's guardado do outro lado,
            //    a SEGUNDA armadilha baixada não é proteção — é a segunda carta
            //    que sai na mesma varredura. Uma só fica, para não dar 2-por-1.
            var trap = q.settableST.FirstOrDefault(a => EhArmadilha(a.code));
            var varreduraSt = NaMaoDele(foe, VARREDURA_ST);
            if (trap.code != 0 && _stCountOf(me) <= 3)
            {
                if (varreduraSt != 0 && _stCountOf(me) >= 1)
                    _log($"nao seto a 2a armadilha: ele tem {varreduraSt} na mao " +
                         "e as duas sairiam na mesma carta");
                else
                    return new Play("setspell", trap.index, $"seta armadilha {trap.code} (mantem zona p/ magias)");
            }

            // Diagnóstico: "o NPC parou de setar armadilha" foi relatado em duelo
            // e a regra acima está certa (há teste). Quando ela NÃO dispara, o
            // motivo é sempre um destes dois — e sem registrar isso a próxima
            // investigação recomeça do zero.
            if (q.settableST.Count > 0 || trap.code != 0)
                _log($"nao setou armadilha: setaveis={q.settableST.Count} " +
                     $"armadilha_entre_elas={(trap.code != 0 ? trap.code.ToString() : "nenhuma")} " +
                     $"zonas_ocupadas={_stCountOf(me)} (limite: <=3)");

            // 3. Tribute to The Doomed sem o Reborn — descarta um dragão e estoura o mais forte.
            if (Ativavel(q, TRIBUTE_TO_DOOMED) && ameacaReal)
                return new Play("activate", IdxAtivavel(q, TRIBUTE_TO_DOOMED),
                    "Tribute to The Doomed: descarta dragao e estoura o mais forte do oponente");

            // 4. Monster Reborn — reanima o mais forte do cemitério (alvo no DecideSelect).
            if (Ativavel(q, MONSTER_REBORN))
                return new Play("activate", IdxAtivavel(q, MONSTER_REBORN),
                    "Monster Reborn: revive o mais forte do cemiterio");

            // 5. Ritual (QUALQUER magia-ritual) — tributa monstro de nível alto (pra
            //    reviver depois com o Reborn). Reconhecido por tipo, não por ID.
            var ritual = AtivavelSe(q, EhRitual);
            if (ritual.code != 0)
                return new Play("activate", ritual.index,
                    $"Ritual: invoca tributando monstro de nivel alto ({ritual.code})");

            // 5.1 FUSÃO — mesma lógica do ritual, e por isso vem logo depois: põe
            //     um corpo grande em campo E manda os materiais para o cemitério,
            //     que é de onde o Monster Reborn tira o alvo. O motor só oferece a
            //     Polymerization quando existe fusão possível com a mão/campo, então
            //     não é preciso conferir receita aqui — se ela está em `activatable`,
            //     há o que fundir.
            var fusao = AtivavelSe(q, FUSAO.Contains);
            if (fusao.code != 0)
                return new Play("activate", fusao.index,
                    $"Fusao: corpo grande em campo e materiais no cemiterio p/ o Reborn ({fusao.code})");

            // 5.15 Petit Moth com a face pra CIMA: se eu tenho Cocoon of
            //      Evolution na mão, o alvo do equip PRECISA estar face para
            //      cima (exigência do próprio Lua, `s.filter`). A defesa
            //      genérica (passo 6, mais abaixo) setaria o Petit Moth virado
            //      assim que aparecesse qualquer ameaça — e virado ele fica
            //      PERMANENTEMENTE inválido como alvo daquela cópia do casulo,
            //      matando o combo antes de começar. Mesmo espírito da regra
            //      5.7 (Mago do Tempo em ataque pela moeda): força a carta pra
            //      cima na hora certa, antes que a lógica de defesa a esconda.
            var petitParaCasulo = q.summonable.FirstOrDefault(a => a.code == PETIT_MOTH);
            if (petitParaCasulo.code == PETIT_MOTH && NaMao(me, COCOON_OF_EVOLUTION))
                return new Play("summon", petitParaCasulo.index,
                    "Petit Moth em ataque (nao setado): tenho Cocoon of Evolution na mao " +
                    "e o alvo do equip precisa estar com a face para cima");

            // 5.2 Cocoon of Evolution — equipa no inseto mais FRACO em campo (o
            //     motor só oferece a ativação quando existe alvo válido, então
            //     não é preciso checar "tenho inseto em campo" aqui). Marca
            //     `_proximoAlvoEquipFraco` para o DecideSelect que vem em seguida.
            if (!_casuloJaEquipado && Ativavel(q, COCOON_OF_EVOLUTION))
            {
                _proximoAlvoEquipFraco = true;
                _casuloJaEquipado = true;
                return new Play("activate", IdxAtivavel(q, COCOON_OF_EVOLUTION),
                    "Cocoon of Evolution: equipa no inseto mais fraco, comeca a contagem da evolucao");
            }

            // 5.3 Insect Armor with Laser Cannon — +700 ATK fixo. O alvo default
            //     do DecideSelect (maior ATK) já é o que se quer aqui: reforça o
            //     melhor atacante em vez de pouco importar.
            if (Ativavel(q, INSECT_ARMOR_LASER))
                return new Play("activate", IdxAtivavel(q, INSECT_ARMOR_LASER),
                    "Insect Armor with Laser Cannon: +700 ATK no melhor atacante");

            // 5.4 Insect Imitation — tributa 1 inseto (o DecideSelect já sacrifica
            //     o de menor ATK) para trazer um Inseto de nível +1 do PRÓPRIO
            //     deck. Sempre vale: troca o inseto mais fraco por um mais forte.
            if (Ativavel(q, INSECT_IMITATION))
                return new Play("activate", IdxAtivavel(q, INSECT_IMITATION),
                    "Insect Imitation: tributa o inseto mais fraco por um mais forte do deck");

            // 5.5 Remoção e burn (decks de queima como o do Joey):
            //   • remoção de monstro (Raigeki/Dark Hole/Fissure) só com alvo;
            //   • remoção de magia/armadilha (Harpie's/MST) só se o oponente tiver S/T;
            //   • burn (dano fixo) sempre que der — é a condição de vitória do deck.
            var remMon = AtivavelSe(q, REMOCAO_MONSTRO.Contains);
            if (remMon.code != 0 && QtdMonstros(foe) >= 1)
                return new Play("activate", remMon.index, $"remocao: limpa o campo do oponente ({remMon.code})");
            var remST = AtivavelSe(q, REMOCAO_ST.Contains);
            if (remST.code != 0 && _stCountOf(foe) >= 1)
            {
                // O `if` acima já garante o critério antigo (ele tem S/T em campo).
                var alvoSt = AlvoDaRemocaoSt(foe, valeSemLeitura: true);
                if (alvoSt.vale)
                {
                    _proximoAlvoStPerigosa = alvoSt.alvo;
                    return new Play("activate", remST.index,
                        $"remocao: {remST.code} em {alvoSt.porque}");
                }
                _log($"guarda {remST.code} — {alvoSt.porque}");
            }
            var burn = AtivavelSe(q, BURN.Contains);
            if (burn.code != 0)
                return new Play("activate", burn.index, $"burn: dano fixo no oponente ({burn.code})");

            // 5.6 MAGO DO TEMPO — a moeda. Cara destrói os monstros DELE, coroa
            //     destrói os MEUS e ainda tira LP. É jogada de quem está atrás:
            //     quando o campo já está bom, arriscar só pode piorar.
            if (Ativavel(q, TIME_WIZARD))
            {
                var (arrisca, porque) = VaiArriscarAMoeda(q, me, foe, ameaca, meuMelhor);
                if (arrisca)
                    return new Play("activate", IdxAtivavel(q, TIME_WIZARD),
                        $"Mago do Tempo: {porque}");
                _log($"Mago do Tempo: NAO arrisca — {porque}");
            }

            // 5.7 PÔR O MAGO DO TEMPO EM CAMPO — com a face para cima.
            //
            // Sem isto a regra da moeda (5.6) nunca tinha chance: estar atrás é
            // exatamente a condição que faz a regra de defesa SETAR o monstro
            // mais fraco, e o Mago (500/400) é sempre o mais fraco. Setado, ele
            // fica virado — e carta virada não ativa efeito. Observado em duelo:
            // três turnos seguidos setando o Mago, que morria sem nunca jogar a
            // moeda.
            //
            // Invocar aqui é `summon` (ataque, face para cima) de propósito. Ele
            // morre fácil, mas o efeito é ignição de Main Phase: na decisão
            // seguinte a regra 5.6 já o encontra ativável.
            var mago = q.summonable.FirstOrDefault(a => a.code == TIME_WIZARD);
            if (mago.code == TIME_WIZARD && ameacaReal
                && AtivavelSe(q, FUSAO.Contains).code == 0)
                return new Play("summon", mago.index,
                    "Mago do Tempo em campo: a moeda so' existe com ele com a face para cima");

            // 5.8 TOON: Invocação Especial de um Toon "clássico" da mão. Só
            //     aparece em `spSummonable` quando o motor já confirma Toon World
            //     em campo (e tributo pagável, se pedir) — não há condição extra
            //     a checar aqui, o mesmo padrão da Sincro/Xyz (ver
            //     `ocgcore-protocolo`). Prioriza o de maior ATK disponível.
            var toonSp = Monstros(q.spSummonable)
                .Where(c => TOON_ESPECIAIS.Contains(c.Act.code))
                .OrderByDescending(c => c.St.AtkValue)
                .FirstOrDefault();
            if (toonSp.Ok)
                return new Play("spsummon", toonSp.Act.index,
                    $"Toon: invocacao especial de {toonSp.Act.code} (ATK {toonSp.St.AtkValue}) — Toon World ja habilita");

            // 5.9 MARIPOSA DO CASULO: o motor só oferece Larvae/Great/Perfectly
            //     Ultimate Great Moth em `spSummonable` depois de 2/4/6 turnos com
            //     o Cocoon of Evolution equipado (contagem do próprio Lua, ver
            //     TestWeevil) — sem esta regra elas nunca eram invocadas mesmo
            //     disponíveis, e o casulo inteiro não servia pra nada.
            var mariposaSp = Monstros(q.spSummonable)
                .Where(c => MARIPOSAS_CASULO.Contains(c.Act.code))
                .OrderByDescending(c => c.St.AtkValue)
                .FirstOrDefault();
            if (mariposaSp.Ok)
                return new Play("spsummon", mariposaSp.Act.index,
                    $"casulo evoluiu: Invocacao Especial de {mariposaSp.Act.code} (ATK {mariposaSp.St.AtkValue})");

            // 6. Beatdown: monstros grandes (sacrificando os fracos) ou beater Nv4.
            //    O filtro `TributoCompensa` impede o NPC de tributar um corpo
            //    melhor do que o que vai entrar. Vale para as DUAS listas: o Set
            //    de um Nv5+ é um Tribute Set e custa os mesmos tributos que a
            //    invocação. Filtrar só a de invocação deixava o NPC tributar uma
            //    fusão de 3200 para SETAR um Red-Eyes — o mesmo erro pela porta
            //    de trás.
            // Cocoon of Evolution é um Monstro de Efeito (0/2000) por baixo do
            // pano — DEF alta o suficiente pra essa lógica genérica de "seta o
            // melhor DEF quando ameaçado" QUEIMAR ele como parede assim que
            // aparece uma ameaça, antes da regra 5.2 (o equip de verdade) ter
            // qualquer chance. Uma vez set/invocado como monstro comum ele sai
            // da mão e o combo morre pra sempre com essa cópia. Fora das DUAS
            // listas — só entra em campo pela regra 5.2, nunca por aqui.
            // LEITURA DE MÃO: ele tem Raigeki/Dark Hole guardado?
            //
            // Então o segundo corpo em campo não é vantagem, é presente: os dois
            // saem juntos numa carta só. Segura a invocação e vai à batalha com o
            // que já está lá. Duas condições para não virar passividade: só segura
            // se JÁ tiver monstro em campo (nunca fica de campo vazio) e se esse
            // monstro der conta da ameaça atual — estando atrás, precisa arriscar.
            var varreduraNaMao = NaMaoDele(foe, VARREDURA_MONSTRO);
            bool seguraOCorpo = varreduraNaMao != 0 && QtdMonstros(me) >= 1
                                && meuMelhor >= ameaca;
            if (seguraOCorpo)
                _log($"nao invoco mais: ele tem {varreduraNaMao} na mao e eu ja tenho campo " +
                     $"({meuMelhor} contra {ameaca}) — dois corpos sairiam na mesma carta");

            var invocaveis = seguraOCorpo
                ? new List<Cand>()
                : Monstros(q.summonable).Where(c => c.Act.code != COCOON_OF_EVOLUTION).ToList();
            // Setar também é pôr um corpo: o Raigeki leva o setado junto.
            // O Mago do Tempo NUNCA entra como parede: setá-lo o vira, e virado
            // ele perde a única coisa que vale nele (a moeda). Um 500/400 também
            // não segura nada. Fora da lista de setáveis, portanto.
            var setaveis = seguraOCorpo
                ? new List<Cand>()
                : Monstros(q.settable)
                    .Where(c => c.Act.code != TIME_WIZARD && c.Act.code != COCOON_OF_EVOLUTION)
                    .ToList();
            var altasQueCompensam = invocaveis
                .Where(c => c.St.Level >= 5 && TributoCompensa(me, c.St, setando: false))
                .ToList();
            var setsQueCompensam = setaveis
                .Where(c => c.St.Level >= 5 && TributoCompensa(me, c.St, setando: true))
                .ToList();
            var jogadaAlta = Escolher(
                altasQueCompensam,
                setsQueCompensam,
                ameaca, "nivel maior");
            if (jogadaAlta.HasValue) return jogadaAlta.Value;

            var jogadaBaixa = Escolher(
                invocaveis.Where(c => c.St.Level <= 4).ToList(),
                setaveis.Where(c => c.St.Level <= 4).ToList(),
                ameaca, "nivel 1-4");
            if (jogadaBaixa.HasValue) return jogadaBaixa.Value;

            // 7. Burst Stream of Destruction — só quando limpa 2+ monstros do oponente.
            if (Ativavel(q, BURST_STREAM) && QtdMonstros(foe) >= 2)
                return new Play("activate", IdxAtivavel(q, BURST_STREAM),
                    "Burst Stream: destroi 2+ monstros do oponente");

            // 7.5 FORMAÇÃO DE ISCA contra a varredora baixada (Mirror Force).
            //     Vem depois de invocar e antes da batalha: o monstro que acabou
            //     de entrar em campo não pode mudar de posição neste turno (quem
            //     decide é o motor, e ele nem o oferece em `repositionable`), então
            //     deitar primeiro e invocar depois não adiantaria nada.
            var deitar = DeitarContraVarredora(q, me, foe);
            if (deitar.HasValue) return deitar.Value;

            // 7.6 LEVANTAR PARA ATACAR. Vem depois de deitar: contra uma
            //     varredora, proteger o campo vale mais que abrir o ataque.
            var levantar = LevantarParaAtacar(q, me, foe);
            if (levantar.HasValue) return levantar.Value;

            // 8. Nada mais no Main: vai à batalha se tiver monstro, senão encerra.
            if (q.canBattle && _fieldOf(me).Count > 0)
                return new Play("battle", 0, "ir para a Battle Phase");

            return new Play("endturn", 0, "nada a fazer");
        }

        /// <summary>
        /// Escolha inteligente numa seleção do NPC (SELECT_CARD/SELECT_TRIBUTE),
        /// pela LOCALIZAÇÃO das opções — resolve tributo, descarte, alvo e reborn:
        ///   • tributo (release&gt;0, meus monstros): sacrifica os de MENOR ATK.
        ///   • mão (custo de descarte, ex.: Tribute to The Doomed): descarta o MAIOR
        ///     monstro (pra reviver depois); sem monstro, a carta menos útil.
        ///   • campo/cemitério (alvo de remoção / Monster Reborn): o de MAIOR ATK.
        /// Devolve a lista de índices; o host codifica (EncodeSelect).
        /// </summary>
        public List<int> DecideSelect(InteractiveDuel.Question q, int me)
        {
            int need = Math.Max(1, q.selMin);
            var picks = new List<int>();
            if (q.choices.Count == 0) return picks;

            // Tributo por sacrifício: os mais FRACOS até somar os releases pedidos.
            if (q.choices[0].release > 0)
            {
                int soma = 0;
                foreach (var c in q.choices.OrderBy(c => _cards.Stats(c.code).AtkValue))
                {
                    if (soma >= need) break;
                    picks.Add(c.index);
                    soma += Math.Max(1, (int)c.release);
                }
                return picks;
            }

            // Alvo do Cocoon of Evolution: o inseto mais FRACO, não o mais forte
            // (o default logo abaixo é para remoção/reborn — o oposto do que o
            // casulo quer). `release==0` de propósito, nunca colide com o
            // tributo acima. Consome a flag numa tacada só, mesmo que a lista
            // de opções esteja vazia por algum motivo — nunca fica "presa"
            // esperando uma seleção que não vai vir.
            if (_proximoAlvoEquipFraco)
            {
                _proximoAlvoEquipFraco = false;
                if (q.choices.Count > 0)
                {
                    var maisFraco = q.choices.OrderBy(c => _cards.Stats(c.code).AtkValue).First();
                    return new List<int> { maisFraco.index };
                }
            }

            // Busca (ex.: Toon Table of Contents): se Toon World está entre as
            // opções e o NPC ainda não o tem nem na mão nem em campo, ele vem
            // em primeiro — sem ele nenhum outro Toon funciona por completo.
            // `release==0` aqui de propósito: nunca colide com o tributo acima.
            var toonWorld = q.choices.FirstOrDefault(c => c.code == TOON_WORLD);
            if (toonWorld.code == TOON_WORLD && !NaMao(me, TOON_WORLD) && !_faceUpStOf(me).Contains(TOON_WORLD))
                return new List<int> { toonWorld.index };

            byte loc = q.choices[0].location;

            // Alvo de uma remoção de magia/armadilha: o critério genérico abaixo
            // ordena por ATK, que para magia/armadilha é sempre 0 — na prática
            // ele estourava a primeira zona da lista. Com a leitura, escolhe a
            // que a regra já decidiu (ou, na falta dela, a mais pesada).
            if (loc == SZONE)
            {
                var mira = _proximoAlvoStPerigosa != 0
                    ? q.choices.FirstOrDefault(c => c.code == _proximoAlvoStPerigosa)
                    : default;
                _proximoAlvoStPerigosa = 0;
                if (mira.code != 0) return new List<int> { mira.index };
                var maisPesada = q.choices.OrderByDescending(c => Peso(c.code)).First();
                return new List<int> { maisPesada.index };
            }

            var ordem = loc == HAND
                ? q.choices.OrderByDescending(ValorDescarte)                       // descarta o maior monstro
                : q.choices.OrderByDescending(c => _cards.Stats(c.code).AtkValue); // alvo/reborn: o mais forte

            foreach (var c in ordem)
            {
                if (picks.Count >= need) break;
                picks.Add(c.index);
            }
            return picks;
        }

        /// <summary>Prioridade de DESCARTE: o monstro de maior nível/ATK primeiro
        /// (será revivido); carta que não é monstro por último.</summary>
        int ValorDescarte(InteractiveDuel.Sel c)
        {
            var st = _cards.Stats(c.code);
            if (!st.IsMonster) return -1;
            return st.Level * 10000 + st.AtkValue;
        }

        /// <summary>
        /// Regra de batalha (SELECT_BATTLECMD). O motor pergunta uma vez por
        /// atacante disponível — quem já atacou sai da lista —, então basta
        /// decidir um ataque de cada vez:
        ///
        ///   • Campo do oponente vazio: ataque DIRETO com o de maior ATK — é dano
        ///     de graça.
        ///   • Oponente com monstros: ataca com o de maior ATK só se ele SUPERAR o
        ///     maior ATK que o oponente tem com a face para cima. Assim o NPC não
        ///     entrega o próprio monstro numa troca ruim. (A escolha do alvo fica
        ///     com o host/AutoSelect; se meu ATK já supera o maior deles, qualquer
        ///     alvo com a face para cima é uma troca favorável.)
        ///   • Nenhum ataque compensa: encerra a Battle Phase.
        ///
        /// Monstros setados do oponente têm DEF desconhecida, então não entram na
        /// conta da ameaça — atacá-los é um risco assumido, igual ao de um humano.
        /// </summary>
        public BattlePlay DecideBattle(InteractiveDuel.Question q, int me)
        {
            int foe = 1 - me;

            if (q.attackers.Count == 0)
                return new BattlePlay(false, 0, "sem atacantes");

            // LEITURA: armadilha que varre o campo todo ao primeiro ataque
            // (Mirror Force). Com mais de um atacante, atacar entrega todos eles.
            // Com UM só, atacar é a jogada certa: puxa a armadilha pagando um
            // corpo. Nunca atacar seria pior — travaria o duelo até o deck acabar.
            var varredora = SetadaDele(foe, PUNE_O_CAMPO_TODO);
            if (varredora != 0 && q.attackers.Count > 1)
                return new BattlePlay(false, 0,
                    $"ele tem {varredora} baixada e eu tenho {q.attackers.Count} atacantes — " +
                    "nao entrego o campo todo; puxo a armadilha com um monstro so' depois");

            // LEITURA: armadilha que pune QUEM ataca (Sakuretsu/Cylinder). O
            // prejuízo é o mesmo 1-por-1, então que seja com o corpo mais barato.
            var punidora = SetadaDele(foe, PUNE_O_ATACANTE);

            // ataque direto: dano de graça. Só o corpo escolhido muda com a leitura.
            var diretos = q.attackers.Where(a => a.canDirect).ToList();
            if (diretos.Count > 0)
            {
                var a = Atacante(diretos, punidora != 0, 0);
                return new BattlePlay(true, a.index,
                    $"campo do oponente vazio — ataque direto com {a.code} " +
                    $"(ATK {_cards.Stats(a.code).AtkValue})" +
                    (punidora != 0 ? $" [o mais barato: ele tem {punidora} baixada]" : ""));
            }

            // O que existe do outro lado, avaliado pelo número que a BATALHA usa:
            // ATK de quem está em ataque, DEF de quem está deitado. Uma Mystical
            // Elf (800/2000) em defesa vale 2000 aqui, não 800 — era exatamente
            // essa confusão que fazia o Battle Ox (1700) se jogar contra ela.
            //
            // LEITURA: aqui entram também os monstros VIRADOS, com a DEF real.
            // Antes eles ficavam de fora ("risco assumido") e o NPC atacava uma
            // parede de 2000 setada sem ter como saber; agora ele sabe.
            var doOponente = MonstrosDele(foe);

            var maisForte = q.attackers.OrderByDescending(x => _cards.Stats(x.code).AtkValue).First();
            if (doOponente.Count == 0)
                return new BattlePlay(true, maisForte.index,
                    $"campo do oponente sem monstro — ataca com {maisForte.code}");

            // Basta UM alvo que eu vença: o motor pergunta o alvo em seguida.
            var maisFraco = doOponente.OrderBy(m => m.valor).First();
            var escolhido = Atacante(q.attackers, punidora != 0, maisFraco.valor);
            int meuAtk = _cards.Stats(escolhido.code).AtkValue;

            if (meuAtk > maisFraco.valor)
                return new BattlePlay(true, escolhido.index,
                    $"ATK {meuAtk} supera o alvo mais fraco ({maisFraco.code} vale {maisFraco.valor}) " +
                    $"— ataca com {escolhido.code}" +
                    (punidora != 0 ? $" [o mais barato que ainda vence: ele tem {punidora} baixada]" : ""));

            return new BattlePlay(false, 0,
                $"meu melhor ATK ({_cards.Stats(maisForte.code).AtkValue}) nao vence nem o alvo mais fraco " +
                $"({maisFraco.code} vale {maisFraco.valor}) — encerra o combate");
        }

        /// <summary>
        /// **A formação de isca.** Com uma varredora baixada do outro lado
        /// (Mirror Force), atacar com o campo cheio entrega todos os monstros —
        /// ela destrói TODO monstro em posição de ataque, não só quem atacou.
        /// Por isso a `DecideBattle` se recusa a atacar com vários.
        ///
        /// Só que recusar é meia jogada: a inteira é **deitar os outros e atacar
        /// com um só**. Em posição de defesa eles ficam fora do alcance da
        /// varredora, e o que sobra de pé puxa a armadilha pagando um corpo — o
        /// campo grande passa intacto e o caminho fica limpo para o turno
        /// seguinte.
        ///
        /// Quem fica de pé é a **isca**: o mais barato que ainda GANHA a batalha
        /// (o mesmo critério do <see cref="Atacante"/>). Precisa ganhar, senão a
        /// `DecideBattle` não declara ataque nenhum e a armadilha nunca sai.
        /// Deita-se um por chamada, do mais forte para o mais fraco — protege
        /// primeiro o que vale mais, e o motor volta a perguntar até acabar.
        /// </summary>
        /// <summary>
        /// Levanta para ATAQUE o monstro em defesa que já ganha a batalha.
        ///
        /// Esta regra faltava, e a falta dela travava o NPC inteiro. Ele SETA
        /// quando a ameaça supera o que tem na mão (`Escolher`), e a única outra
        /// regra de posição que existia só DEITAVA (formação de isca). Sem
        /// ninguém para levantar, monstro setado ficava em defesa para sempre:
        /// `q.attackers` vinha vazio todo turno e a `DecideBattle` respondia
        /// "sem atacantes" — por mais forte que o campo dele ficasse.
        ///
        /// Foi exatamente o que apareceu no log de um duelo real: o NPC equipava
        /// +700 no "melhor atacante" e, no mesmo instante, encerrava a batalha
        /// por não ter atacante nenhum.
        ///
        /// Critério: levanta o MAIOR ATK que supere a maior ameaça com a face
        /// para cima — o mesmo teste que a `DecideBattle` usa para decidir se
        /// vale atacar. Levantar quem não vence só entregaria o monstro (em
        /// ataque ele morre e ainda tira LP).
        ///
        /// Monstro setado do oponente NÃO entra na conta, igual ao resto do
        /// cérebro: DEF desconhecida é risco assumido, não motivo para ficar
        /// parado.
        /// </summary>
        Play? LevantarParaAtacar(InteractiveDuel.Question q, int me, int foe)
        {
            if (q.repositionable.Count == 0) return null;

            // Com uma varredora baixada do outro lado, quem manda é a formação
            // de isca — que já rodou antes desta e teria devolvido uma jogada.
            if (SetadaDele(foe, PUNE_O_CAMPO_TODO) != 0) return null;

            int ameaca = MonstrosDele(foe).Select(m => m.valor).DefaultIfEmpty(0).Max();

            // Só os que estão em DEFESA (setado ou com a face para cima): quem já
            // está em ataque não tem o que levantar.
            var emDefesa = _todoFieldPosOf(me)
                .Where(m => (m.pos & POS_ATAQUE) == 0 && _cards.Stats(m.code).IsMonster)
                .ToList();
            if (emDefesa.Count == 0) return null;

            var alvo = q.repositionable
                .Where(a => a.location == MZONE
                            && emDefesa.Any(m => m.seq == a.sequence)
                            && _cards.Stats(a.code).AtkValue > ameaca)
                .OrderByDescending(a => _cards.Stats(a.code).AtkValue)
                .FirstOrDefault();
            if (alvo.code == 0) return null;

            return new Play("reposition", alvo.index,
                $"levanta {alvo.code} (ATK {_cards.Stats(alvo.code).AtkValue}) para atacar — " +
                (ameaca > 0 ? $"supera a maior ameaca ({ameaca})" : "o campo dele esta vazio"));
        }

        Play? DeitarContraVarredora(InteractiveDuel.Question q, int me, int foe)
        {
            var varredora = SetadaDele(foe, PUNE_O_CAMPO_TODO);
            if (varredora == 0 || q.repositionable.Count == 0) return null;

            var emAtaque = _todoFieldPosOf(me)
                .Where(m => (m.pos & POS_ATAQUE) != 0 && _cards.Stats(m.code).IsMonster)
                .ToList();
            if (emAtaque.Count < 2) return null;   // com um só já estou na formação

            int alvoMaisFraco = MonstrosDele(foe).Select(m => m.valor).DefaultIfEmpty(0).Min();
            var isca = emAtaque
                .Where(m => _cards.Stats(m.code).AtkValue > alvoMaisFraco)
                .OrderBy(m => _cards.Stats(m.code).AtkValue)
                .FirstOrDefault();
            if (isca.code == 0)   // nenhum vence: não há isca, então deita todo mundo
                isca = (0, 0, -1);

            // Entre os que o motor deixa mudar de posição, o mais forte que está
            // em ataque e não é a isca. A `sequence` é o que casa a opção do motor
            // com a zona certa — dois Battle Ox iguais não se distinguem pelo código.
            var alvo = q.repositionable
                .Where(a => a.location == MZONE
                            && a.sequence != isca.seq
                            && emAtaque.Any(m => m.seq == a.sequence))
                .OrderByDescending(a => _cards.Stats(a.code).AtkValue)
                .FirstOrDefault();
            if (alvo.code == 0) return null;

            return new Play("reposition", alvo.index,
                $"formacao de isca: ele tem {varredora} baixada — deita {alvo.code} " +
                $"(ATK {_cards.Stats(alvo.code).AtkValue}) e ataca so' com " +
                (isca.code != 0 ? $"{isca.code}" : "ninguem, se nenhum vencer"));
        }

        /// <summary>
        /// Quem ataca: o de maior ATK, como sempre — ou, sabendo que existe uma
        /// armadilha que pune o atacante, o MAIS BARATO que ainda vence a batalha
        /// (`precisaSuperar`). Sem candidato barato o suficiente, volta ao de
        /// maior ATK, que é quem tem chance de resolver alguma coisa.
        /// </summary>
        InteractiveDuel.Act Atacante(List<InteractiveDuel.Act> candidatos, bool temPunidora, int precisaSuperar)
        {
            if (temPunidora)
            {
                var barato = candidatos
                    .Where(a => _cards.Stats(a.code).AtkValue > precisaSuperar)
                    .OrderBy(a => _cards.Stats(a.code).AtkValue)
                    .FirstOrDefault();
                if (barato.code != 0) return barato;
            }
            return candidatos.OrderByDescending(a => _cards.Stats(a.code).AtkValue).First();
        }

        /// <summary>
        /// O coração da decisão, em duas etapas — nesta ordem:
        ///
        ///   1. **Statline da própria carta.** Só entra em ataque quem tem
        ///      ATK &gt; DEF. Um 1200/2000 é uma parede: mesmo podendo vencer o
        ///      que está em campo, rende mais setado do que atacando.
        ///   2. **Situação do campo.** Se a ameaça do oponente supera o melhor
        ///      atacante disponível, seta o de maior DEF em vez de entregar o
        ///      monstro.
        ///
        /// Devolve null quando não há monstro nenhum nesta faixa de nível.
        /// </summary>
        Play? Escolher(List<Cand> invocaveis, List<Cand> setaveis, int ameaca, string tag)
        {
            // etapa 1: só é atacante quem tem o statline para isso
            var atacante = invocaveis
                .Where(c => c.Ofensivo)
                .OrderByDescending(c => c.St.AtkValue)
                .FirstOrDefault();

            var defensor = setaveis
                .OrderByDescending(c => c.St.DefValue)
                .FirstOrDefault();

            int meuAtk = atacante.Ok ? atacante.St.AtkValue : -1;

            // etapa 2: campo. Ameaça maior que meu melhor atacante -> defende.
            if (defensor.Ok && ameaca > meuAtk)
            {
                string motivo = atacante.Ok
                    ? $"oponente tem ATK {ameaca} > meu melhor atacante ({meuAtk})"
                    : $"oponente tem ATK {ameaca} e nao tenho atacante";
                return new Play("setmonster", defensor.Act.index,
                    $"{motivo} — setando {defensor.Act.code} " +
                    $"(ATK {defensor.St.AtkValue}/DEF {defensor.St.DefValue}) [{tag}]");
            }

            if (atacante.Ok)
            {
                return new Play("summon", atacante.Act.index,
                    $"ATK {atacante.St.AtkValue} > DEF {atacante.St.DefValue}, vale atacar" +
                    (ameaca >= 0 ? $" (campo tem {ameaca})" : "") +
                    $" — {atacante.Act.code} [{tag}]");
            }

            // Nenhum monstro com statline de ataque: os que tenho são paredes.
            if (defensor.Ok)
            {
                return new Play("setmonster", defensor.Act.index,
                    $"DEF {defensor.St.DefValue} >= ATK {defensor.St.AtkValue}, " +
                    $"melhor setado — {defensor.Act.code} [{tag}]");
            }

            return null;
        }

        /// <summary>
        /// Em que posição pôr um monstro que o motor deixa escolher (ritual e
        /// invocações especiais em geral).
        ///
        /// Usa o MESMO critério da invocação normal (`Cand.Ofensivo`): só vai
        /// para ataque quem tem ATK &gt; DEF. Um ritual 1200/2000 rende mais
        /// deitado — e agora ele PODE ficar deitado com a face para cima, que é
        /// diferente de setar.
        ///
        /// `mask` é o que o motor aceita (0x1 ataque, 0x4 defesa com a face para
        /// cima). Se a defesa não estiver na máscara, não há escolha a fazer.
        /// </summary>
        public int DecidePosicao(uint code, byte mask)
        {
            const int FACEUP_DEFESA = 0x4;
            bool podeDefesa = (mask & FACEUP_DEFESA) != 0;
            bool podeAtaque = (mask & POS_ATAQUE) != 0;
            if (!podeDefesa) return POS_ATAQUE;
            if (!podeAtaque) return FACEUP_DEFESA;

            var st = _cards.Stats(code);
            bool ofensivo = st.AtkValue > st.DefValue;
            _log($"posicao de {code} ({st.AtkValue}/{st.DefValue}): " +
                 (ofensivo ? "ataque" : "defesa (DEF >= ATK)"));
            return ofensivo ? POS_ATAQUE : FACEUP_DEFESA;
        }

        /// <summary>
        /// Setado logo antes de mandar ativar o Cocoon of Evolution — a próxima
        /// seleção (o alvo do equip) vem por aqui e não pela regra genérica de
        /// "maior ATK" (que é certa para remoção/reborn, mas errada pro casulo:
        /// ele quer o inseto mais FRACO, o melhor atacante não deve virar uma
        /// parede de 0 ATK por 6 turnos). Consumido (voltando a false) assim que
        /// `DecideSelect` usa.
        /// </summary>
        bool _proximoAlvoEquipFraco;

        /// <summary>
        /// A magia/armadilha do oponente que a próxima remoção deve mirar —
        /// decidida por `AlvoDaRemocaoSt` e consumida pelo `DecideSelect`. Mesmo
        /// padrão do `_proximoAlvoEquipFraco`: a regra sabe o alvo certo, mas quem
        /// responde a seleção é a chamada seguinte.
        /// </summary>
        uint _proximoAlvoStPerigosa;

        /// <summary>
        /// Já equipei um Cocoon of Evolution nesta partida? O Lua dele
        /// (`checkcon2`/`checkop2`) reseta a contagem de turnos quando o GRUPO
        /// de alvos "muda de identidade" entre checagens — equipar uma SEGUNDA
        /// cópia no MESMO Petit Moth (o motor deixa, `s.filter` não exclui
        /// quem já está equipado) reinicia o contador sem nenhum aviso, e a
        /// evolução nunca completa. Sem visibilidade de "quem já tem o quê"
        /// equipado, a trava é uma via só: depois do primeiro equip bem
        /// sucedido, nunca mais tenta de novo nesta partida — desperdiça
        /// cópias extras em vez de arriscar quebrar a única em andamento.
        /// </summary>
        bool _casuloJaEquipado;

        /// <summary>
        /// Já pus uma carta NESTA cadeia? O motor abre uma janela por elo, e sem
        /// esta memória o NPC tratava cada janela como se fosse a primeira.
        /// </summary>
        bool _jaEncadeou;

        /// <summary>
        /// A cadeia acabou: pode encadear de novo na próxima.
        ///
        /// Quem chama é o host, quando aparece uma pergunta que NÃO é janela de
        /// corrente — durante a montagem da cadeia só existem janelas de
        /// corrente, então qualquer outra pergunta significa que ela já resolveu.
        /// </summary>
        public void ResetCadeia() => _jaEncadeou = false;

        /// <summary>
        /// Por que o NPC ativou (ou não) a última corrente. O host usa no evento
        /// `npc` que a tela mostra — sem isto o jogador via "ativa 41420027" sem
        /// nenhuma pista do raciocínio.
        /// </summary>
        public string PorqueDaCadeia { get; private set; }

        /// <summary>
        /// Decisão de corrente (SELECT_CHAIN com opções). Três camadas, nesta
        /// ordem:
        ///
        ///   0. **Negação** (armadilhas de contra) — `EscolheNegacao`. É a única
        ///      que precisa saber A QUE está respondendo, e a única que pode
        ///      furar a regra de uma carta por cadeia.
        ///   1. **Uma carta por cadeia** — evita dois Trap Hole no mesmo monstro.
        ///   2. **Genérica**: a maioria das armadilhas da Lista 1 é reativa e o
        ///      motor só abre a janela delas no momento certo, então ativar o que
        ///      é oferecido está certo. A exceção é a REMOÇÃO DE MAGIA/ARMADILHA.
        ///
        /// Motivo da exceção, vindo de uma jogada real: o NPC gastou um Dust
        /// Tornado sobre uma magia de ritual do oponente. Destruir uma magia que
        /// **já está resolvendo** não impede nada — a carta foi queimada à toa.
        /// Ela só vale contra o que ainda está BAIXADO, então é isso que se exige.
        ///
        /// `me` é quem está decidindo; sem saber disso não dá para olhar o campo
        /// do adversário certo.
        /// </summary>
        public int DecideChain(InteractiveDuel.Question q, int me = 1)
        {
            int foe = 1 - me;
            PorqueDaCadeia = null;

            // 0. NEGAÇÃO (armadilhas de contra) — antes de tudo, e podendo furar
            //    a regra de "uma carta por cadeia" logo abaixo.
            //
            //    O furo é proposital: negar é exatamente o caso em que somar uma
            //    segunda carta na mesma cadeia não é desperdício. Se eu ativei um
            //    Trap Hole e o oponente encadeou um Mystical Space Typhoon nele,
            //    o Seven Tools ali salva a minha carta — a regra genérica, que
            //    existe para não gastar dois Trap Hole no mesmo monstro, atrapalha
            //    aqui.
            var negacao = EscolheNegacao(q, me, foe);
            if (negacao.index >= 0)
            {
                _jaEncadeou = true;
                PorqueDaCadeia = negacao.why;
                _log($"chain: {negacao.why}");
                return negacao.index;
            }

            // UMA carta por cadeia.
            //
            // O relato que originou a regra: numa Invocação-Normal o NPC ativava
            // DOIS Trap Hole seguidos. O primeiro já destrói o monstro, então o
            // segundo resolve sem alvo e vai direto para o cemitério — carta
            // jogada fora.
            //
            // A regra é grosseira de propósito: ela também impede encadeamentos
            // legítimos, mas no pool da Lista 1 (Trap Hole, Mirror Force, Waboku,
            // Negate Attack, Sakuretsu) somar duas cartas na mesma cadeia é
            // desperdício em praticamente todos os casos. Se o motor OBRIGAR a
            // ativar (`chainForced`), a regra sai da frente.
            if (_jaEncadeou && !q.chainForced)
            {
                _log("chain: ja ativei uma carta nesta cadeia — nao gasta outra");
                return -1;
            }

            foreach (var c in q.choices)
            {
                // As de contra já foram julgadas no passo 0 — chegar aqui
                // significa que a negação NÃO compensava (custo alto demais ou
                // gatilho fraco). Ativar pela regra genérica desfaria a decisão.
                if (CONTRA.ContainsKey(c.code)) continue;

                if (!REMOCAO_ST.Contains(c.code))
                {
                    _jaEncadeou = true;
                    PorqueDaCadeia = $"ativa {c.code} em resposta";
                    return c.index;
                }

                // Vale gastar a remoção, e em quem? (com leitura, "quem" importa:
                // ver AlvoDaRemocaoSt)
                var alvo = AlvoDaRemocaoSt(foe, valeSemLeitura: _setStCountOf(foe) > 0);
                if (alvo.vale)
                {
                    PorqueDaCadeia = $"usa {c.code} em {alvo.porque}";
                    _log($"chain: {PorqueDaCadeia}");
                    _proximoAlvoStPerigosa = alvo.alvo;
                    _jaEncadeou = true;
                    return c.index;
                }
                _log($"chain: guarda {c.code} — {alvo.porque}");
            }

            // O motor OBRIGA a encadear alguma coisa e nenhuma regra escolheu:
            // recusar aqui devolve MSG_RETRY e o duelo trava num laço. Entre
            // travar e gastar a primeira carta, gasta a carta.
            if (q.chainForced && q.choices.Count > 0)
            {
                _jaEncadeou = true;
                PorqueDaCadeia = $"o motor obriga a encadear — ativa {q.choices[0].code}";
                _log($"chain: {PorqueDaCadeia}");
                return q.choices[0].index;
            }

            // Só sobraram cartas que não vale a pena gastar agora.
            return -1;
        }

        /// <summary>
        /// Vale negar o que acabou de acontecer — e com QUAL das armadilhas de
        /// contra na mesa? Devolve o índice na janela (ou −1) e o porquê.
        ///
        /// São três perguntas em sequência, e a ordem importa:
        ///
        ///   1. **O que abriu a janela?** (`chainTriggerKind/Code/Player`) Sem
        ///      isso não há decisão possível — e a resposta certa é NÃO ativar.
        ///      Uma negação gasta a carta mais cara do deck; no escuro, guardar
        ///      é sempre melhor que chutar. (Se o gatilho for MEU, idem: ninguém
        ///      nega a própria jogada.)
        ///   2. **Aquilo vale a negação?** Invocação se mede pelo ATK que entra;
        ///      magia e armadilha, por lista (ver MAGIA_PERIGOSA).
        ///   3. **Consigo pagar sem me matar?** É aqui que a carta mais barata
        ///      capaz de negar aquele tipo é escolhida (`Contra.Ordem`).
        /// </summary>
        (int index, string why) EscolheNegacao(InteractiveDuel.Question q, int me, int foe)
        {
            var oferecidas = q.choices
                .Where(c => CONTRA.ContainsKey(c.code))
                .OrderBy(c => CONTRA[c.code].Ordem)
                .ToList();
            if (oferecidas.Count == 0) return (-1, null);

            if (q.chainTriggerCode == 0 || string.IsNullOrEmpty(q.chainTriggerKind))
            {
                _log("contra: nao sei o que abriu a janela — nao gasto negacao no escuro");
                return (-1, null);
            }
            if (q.chainTriggerPlayer != foe)
            {
                _log($"contra: quem jogou {q.chainTriggerCode} fui eu — nada a negar");
                return (-1, null);
            }

            var gat = _cards.Stats(q.chainTriggerCode);
            bool ehInvocacao = q.chainTriggerKind == "summon";
            bool ehMagia = !ehInvocacao && (gat.Type & TYPE_SPELL) != 0;
            bool ehArmadilha = !ehInvocacao && (gat.Type & TYPE_TRAP) != 0;

            var (vale, porque) = ValeNegar(ehInvocacao, ehMagia, ehArmadilha, gat, me);
            if (!vale)
            {
                _log($"contra: guarda a negacao — {porque}");
                return (-1, null);
            }

            // LEITURA DE MÃO — a regra da ISCA.
            //
            // O golpe clássico contra bot: o jogador queima uma carta média só
            // para o NPC gastar a negação nela, e passa a importante logo depois.
            // Sabendo o que ele ainda tem na mão, o NPC compara: se vem coisa
            // PIOR e eu só tenho uma negação guardada, esta aqui não é a hora.
            //
            // Dois limites, para a regra não virar paralisia:
            //   • com 2+ negações baixadas, gasta uma agora e guarda a outra;
            //   • acima de PESO_INEGOCIAVEL, nega de qualquer jeito — deixar um
            //     Raigeki resolver "porque pode vir coisa pior" é perder o jogo
            //     hoje para se proteger de amanhã.
            int pesoGatilho = ehInvocacao ? gat.AtkValue : Peso(gat.Code);
            var pior = MaiorAmeacaNaMao(foe);
            int reservas = _setStOf(me).Count(CONTRA.ContainsKey);
            if (pior.peso > pesoGatilho && pesoGatilho < PESO_INEGOCIAVEL && reservas <= 1)
            {
                _log($"contra: ISCA — {q.chainTriggerCode} pesa {pesoGatilho}, mas ele ainda tem " +
                     $"{pior.code} (peso {pior.peso}) na mao e eu so tenho {reservas} negacao baixada");
                return (-1, null);
            }

            foreach (var c in oferecidas)
            {
                var ct = CONTRA[c.code];
                if (ehInvocacao && !ct.Invocacao) continue;
                if (ehMagia && !ct.Magia) continue;
                if (ehArmadilha && !ct.Armadilha) continue;

                var (pagavel, motivo) = CustoPagavel(ct, me, gat, ehInvocacao);
                if (!pagavel)
                {
                    _log($"contra: {c.code} negaria, mas {motivo}");
                    continue;
                }
                return (c.index, $"nega {q.chainTriggerCode} com {c.code}: {porque}");
            }
            return (-1, null);
        }

        /// <summary>
        /// O gatilho merece uma negação?
        ///
        /// **Invocação** é a única que dá para medir sozinho: o ATK que entra em
        /// campo. Nega quando o monstro é grande (>= <see cref="AMEACA_QUE_JUSTIFICA_NEGAR"/>)
        /// E o campo do NPC não o supera — se ele já tem algo maior, a batalha
        /// resolve de graça no turno seguinte e a armadilha continua guardada.
        ///
        /// **Magia e armadilha** não dão: o efeito mora no Lua, não há o que
        /// consultar. Vão por lista fechada, e o silêncio da lista significa
        /// "não vale" — o erro barato.
        /// </summary>
        (bool vale, string porque) ValeNegar(
            bool ehInvocacao, bool ehMagia, bool ehArmadilha,
            DatabaseManager.CardStats gat, int me)
        {
            if (ehInvocacao)
            {
                int atk = gat.AtkValue;
                int meuMelhor = MaiorAtkEmCampo(me);
                if (atk < AMEACA_QUE_JUSTIFICA_NEGAR)
                    return (false, $"invocacao de {atk} de ATK nao assusta (limiar {AMEACA_QUE_JUSTIFICA_NEGAR})");
                if (meuMelhor >= atk)
                    return (false, $"meu campo ({meuMelhor}) ja supera os {atk} dele — a batalha resolve");
                return (true, $"invocacao de {atk} de ATK que meu campo ({meuMelhor}) nao supera");
            }
            if (ehMagia || ehArmadilha)
            {
                int peso = Peso(gat.Code);
                string oQue = ehMagia ? "magia" : "armadilha";
                return peso >= PESO_PERIGOSO
                    ? (true, $"{oQue} que decide a jogada (peso {peso})")
                    : (false, $"{oQue} {gat.Code} nao atrapalha o bastante (peso {peso})");
            }
            return (false, "gatilho que nao sei avaliar (efeito de monstro?)");
        }

        /// <summary>
        /// Dá para pagar o preço sem que a negação saia mais cara que o problema?
        ///
        /// LP: qualquer custo que leve abaixo de <see cref="LP_PISO"/> é recusado.
        ///
        /// Tributo (Horn of Heaven): o `DecideSelect` sacrifica sempre o monstro
        /// de MENOR ATK, então é contra ele que a conta é feita — tributar um
        /// 1700 para negar um 1800 é trocar seis por meia dúzia e ainda ficar com
        /// o campo vazio.
        /// </summary>
        (bool pagavel, string motivo) CustoPagavel(
            Contra ct, int me, DatabaseManager.CardStats gat, bool ehInvocacao)
        {
            int lp = _lpOf(me);
            if (ct.MetadeLp && lp - lp / 2 < LP_PISO)
                return (false, $"pagar metade de {lp} deixa menos que {LP_PISO} de vida");
            if (ct.LpFixo > 0 && lp - ct.LpFixo < LP_PISO)
                return (false, $"pagar {ct.LpFixo} de {lp} deixa menos que {LP_PISO} de vida");

            if (ct.Tributo)
            {
                var meus = _fieldOf(me).Select(_cards.Stats).Where(s => s.IsMonster).ToList();
                if (meus.Count == 0) return (false, "nao tenho monstro para tributar");
                int maisFraco = meus.Min(s => s.AtkValue);
                if (ehInvocacao && gat.AtkValue <= maisFraco)
                    return (false, $"tributaria um {maisFraco} para negar um {gat.AtkValue}");
            }
            return (true, null);
        }

        List<Cand> Monstros(List<InteractiveDuel.Act> lista)
        {
            var outp = new List<Cand>();
            foreach (var a in lista)
            {
                var st = _cards.Stats(a.code);
                if (st.IsMonster) outp.Add(new Cand(a, st));
            }
            return outp;
        }

        /// <summary>
        /// Vale arriscar a moeda do Mago do Tempo?
        ///
        /// O efeito é simétrico e cruel: cara varre o campo do oponente, coroa
        /// varre o MEU e ainda cobra metade do ATK perdido em LP. Ou seja, o
        /// valor da jogada depende inteiramente de quem tem mais a perder.
        ///
        /// Três recusas, em ordem — cada uma vem de um jeito de a aposta ser
        /// ruim mesmo quando "dá para ativar":
        ///
        ///   1. **Tenho fusão pronta.** Se a Polymerization está ativável, o
        ///      motor está dizendo que há material suficiente na mão/campo. Pôr
        ///      um corpo grande é melhor do que jogar moeda — e o material que a
        ///      coroa destruiria era justamente o da fusão.
        ///   2. **O oponente não tem monstro.** Cara não destrói nada, coroa
        ///      destrói tudo que é meu. Aposta sem prêmio.
        ///   3. **Meu campo já dá conta.** Se o meu melhor monstro alcança a
        ///      ameaça, estou ganhando a troca sem moeda nenhuma.
        ///
        /// Sobra o caso em que a regra existe: estou atrás, o oponente tem corpo
        /// que eu não supero, e a moeda é a única saída.
        /// </summary>
        (bool arrisca, string porque) VaiArriscarAMoeda(
            InteractiveDuel.Question q, int me, int foe, int ameaca, int meuMelhor)
        {
            if (AtivavelSe(q, FUSAO.Contains).code != 0)
                return (false, "tenho fusao pronta — material vale mais que a moeda");

            if (!_fieldPosOf(foe).Any(m => _cards.Stats(m.code).IsMonster))
                return (false, "o oponente nao tem monstro — cara nao destroi nada");

            // "Campo bom" também é ter algo grande, mesmo que a ameaça seja maior:
            // o monstro grande costuma ser o que a coroa levaria embora.
            int meuMaiorCorpo = _fieldPosOf(me)
                .Where(m => _cards.Stats(m.code).IsMonster)
                .Select(m => _cards.Stats(m.code).AtkValue)
                .DefaultIfEmpty(-1).Max();

            if (meuMelhor >= ameaca && meuMelhor >= 0)
                return (false, $"meu campo ({meuMelhor}) ja alcanca a ameaca ({ameaca})");

            if (meuMaiorCorpo >= CORPO_GRANDE)
                return (false, $"tenho corpo grande em campo ({meuMaiorCorpo}) — nao arrisco perder");

            return (true, $"estou atras ({meuMelhor} contra {ameaca}) — a moeda e' a saida");
        }

        /// <summary>A partir daqui um monstro é "grande" demais para se arriscar
        /// a perder numa moeda. 2000 é a faixa dos Nv6/Nv7 e das fusões básicas.</summary>
        const int CORPO_GRANDE = 2000;

        /// <summary>
        /// Quantos tributos um monstro deste nível exige (regra oficial):
        /// Nv5-6 = 1, Nv7-8 = 2, Nv9+ = 3. Nv1-4 não custa nada.
        /// </summary>
        static int TributosPara(int level) =>
            level >= 9 ? 3 : level >= 7 ? 2 : level >= 5 ? 1 : 0;

        /// <summary>
        /// A invocação por tributo COMPENSA?
        ///
        /// Nasceu de uma jogada absurda observada em duelo: o NPC fundiu um 2600
        /// e no turno seguinte tributou essa mesma fusão para invocar um 2500.
        /// A regra de beatdown só comparava o candidato com a ameaça do
        /// OPONENTE — nunca com o que ela ia destruir do próprio lado.
        ///
        /// O `DecideSelect` sacrifica sempre os monstros de MENOR ATK, então é
        /// contra esses que a conta tem de ser feita: se o melhor entre os que
        /// sairiam já vale tanto quanto o que entra, a troca é ruim e a jogada
        /// não deve nem ser considerada.
        ///
        /// Não conta monstro setado: o NPC só enxerga os com a face para cima
        /// (`FaceUpMonsters`), que é a mesma informação que um humano teria.
        ///
        /// Quando vê MENOS monstros do que os tributos exigidos, julga assim
        /// mesmo pelo que enxerga, em vez de liberar a jogada. Um 2600 visível
        /// não deixa de ser um mau tributo por existir um setado que eu não sei
        /// qual é — e liberar nesse caso era justamente o buraco por onde a
        /// jogada absurda voltava a passar. Só confia no motor quando não há
        /// monstro visível nenhum: aí realmente não há nada conhecido a perder.
        ///
        /// `setando` troca o que se ganha: um monstro SETADO defende com a DEF,
        /// então é a DEF dele que precisa superar o que sai — comparar pela ATK
        /// deixaria passar "tributo um 3200 para setar um 2400/2000", que na
        /// prática entrega 3200 de ataque em troca de 2000 de defesa.
        /// </summary>
        bool TributoCompensa(int me, DatabaseManager.CardStats entra, bool setando)
        {
            int n = TributosPara(entra.Level);
            if (n == 0) return true;                       // Nv1-4: não custa nada

            var sacrificados = _fieldOf(me)
                .Select(c => _cards.Stats(c))
                .Where(s => s.IsMonster)
                .OrderBy(s => s.AtkValue)                  // os mais fracos vão primeiro
                .Take(n)
                .ToList();

            if (sacrificados.Count == 0) return true;      // nada visível a perder

            int maiorPerdido = sacrificados.Max(s => s.AtkValue);
            int ganho = setando ? entra.DefValue : entra.AtkValue;
            return ganho > maiorPerdido;
        }

        /// <summary>Maior ATK entre os monstros do jogador indicado.</summary>
        int MaiorAtkEmCampo(int player)
        {
            int max = -1;
            foreach (uint code in _fieldOf(player))
            {
                var st = _cards.Stats(code);
                if (st.IsMonster && st.AtkValue > max) max = st.AtkValue;
            }
            return max;
        }
    }
}

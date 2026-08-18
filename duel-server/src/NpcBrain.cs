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
        // Pacote Para & Dox (o Labirinto). Deck de corpos ENORMES que o jogo
        // normal não deixa invocar — Nv7 aos montes e o Gate Guardian de 3750,
        // que nem invocação normal tem. Todas estas cartas são atalhos: pagam um
        // corpo qualquer e trazem um grande. Sem elas o NPC ficava com a mão
        // cheia de Nv7 e um muro de 0 de ATK em campo.
        const uint TRIBUTE_DOLL = 2903036;       // tributa 1 → Invoca Especialmente 1 Nv7 da mão
        const uint MONSTER_GATE = 43040603;      // tributa 1 → cava o deck até um monstro
        const uint METAMORPHOSIS = 46411259;     // tributa 1 → fusão de MESMO nível do Extra
        const uint MAGICAL_LABYRINTH = 64389297; // equipa no muro → depois vira Wall Shadow

        // **O trio e o rei.** O Gate Guardian não tem invocação normal NEM
        // reanimação: o Lua dele exige tributar Sanga + Kazejin + Suijin em
        // campo, e uma carta que precisa ser "corretamente invocada" antes não
        // volta do cemitério nunca. Então descartá-lo mata a carta para sempre —
        // e era exatamente o que o NPC fazia, porque a regra de descarte joga
        // fora o MAIOR monstro da mão (Nv11, 3750 de ATK: sempre ele).
        //
        // As três peças são o caminho até ele, e cada uma sozinha já é uma
        // parede boa (a habilidade delas zera o ATK de quem ataca, uma vez por
        // duelo). Gastá-las como custo de Metamorphosis/Monster Gate/Tribute
        // Doll é jogar fora as duas coisas de uma vez: o efeito e o rei.
        const uint GATE_GUARDIAN = 25833572;     // 3750/3400 Nv11 — só tributando as 3 peças
        const uint SANGA = 25955164;             // 2600/2200 Nv7 (LIGHT/Thunder)
        const uint SUIJIN = 98434877;            // 2500/2400 Nv7 (WATER/Aqua)
        const uint KAZEJIN = 62340868;           // 2400/2200 Nv7 (WIND/Spellcaster)
        static readonly HashSet<uint> PECAS_GATE_GUARDIAN = new() { SANGA, SUIJIN, KAZEJIN };

        // Magia de CAMPO. O efeito não é uma invocação alternativa da carta que
        // está na mão (então o monstro NÃO aparece em `summonable`): é um efeito
        // de IGNIÇÃO do próprio Mausoléu, que aparece em `activatable` com
        // `location` na zona de magia. Pagando 1000 LP por tributo exigido, ele
        // Invoca Normalmente um monstro da mão sem tributo nenhum — que é como um
        // deck de Nv7 preso na mão finalmente põe corpo em campo.
        const uint MAUSOLEUM = 80921533;
        // As duas opções que o Lua oferece ao ativar: 1000 LP para quem pede 1
        // tributo (Nv5/6) e 2000 para quem pede 2 (Nv7+). O motor manda os ids
        // de texto na pergunta, então dá para escolher pelo que a opção
        // SIGNIFICA em vez de chutar a primeira da lista.
        //
        // A conta é a do `aux.Stringid` DESTE core (`utility.lua`):
        // `(indice & 0xfffff) | code << 20` — 64 bits, não o `code * 16 + i` dos
        // cores antigos. Conferido contra o motor: o Mausoléu manda
        // 0x3BD00001/0x3BD00002 nas duas opções.
        const ulong MAUSOLEU_1_TRIBUTO = ((ulong)MAUSOLEUM << 20) | 1;
        const ulong MAUSOLEU_2_TRIBUTOS = ((ulong)MAUSOLEUM << 20) | 2;

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

        /// <summary>
        /// **Cartas que a regra genérica não pode engolir.**
        ///
        /// Cada uma destas tem regra PRÓPRIA mais abaixo, com uma condição que a
        /// classe do efeito não expressa: o Metamorphosis é uma fusão, mas não
        /// pode esvaziar o campo nem comer uma peça do Gate Guardian; o Burst
        /// Stream destrói monstros, mas só compensa limpando 2+; o Summoner's Art
        /// busca, mas só serve com um Nv5+ para trazer.
        ///
        /// Sem esta lista, a regra genérica — que vem ANTES por ser mais barata de
        /// avaliar — dispara primeiro e a condição específica nunca é consultada.
        /// Foi exatamente o que aconteceu ao generalizar: o Metamorphosis voltou a
        /// tributar o corpo único e o Burst Stream a sair com 1 monstro do outro
        /// lado, com três suítes acusando de uma vez.
        /// </summary>
        static readonly HashSet<uint> COM_REGRA_PROPRIA = new()
        {
            MONSTER_REBORN, TRIBUTE_TO_DOOMED, BURST_STREAM, TIME_WIZARD, TOON_WORLD,
            TRIBUTE_DOLL, MONSTER_GATE, METAMORPHOSIS, MAGICAL_LABYRINTH, MAUSOLEUM,
            COCOON_OF_EVOLUTION, INSECT_ARMOR_LASER, INSECT_IMITATION,
            SUMMONERS_ART, ANCIENT_RULES, ARMORY_CALL,
        };

        const byte DECK = 0x1, HAND = 0x2, MZONE = 0x4, SZONE = 0x8, GRAVE = 0x10;
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
            // Toon Bookmark — busca o PRÓPRIO Toon World (ou algo que o cite).
            // Cai na mesma regra do Table of Contents e reaproveita a preferência
            // por Toon World que já existe no `DecideSelect`: sem ele nenhum
            // outro Toon do deck do Pegasus funciona.
            91500017,
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
            // Manga Ryu-Ran (2200/2600) — tributa 2, e "não pode atacar no turno
            // em que foi Invocado por Invocação-Especial". O motor só oferece o
            // `spSummonable` quando os tributos existem, e o `DecideSelect` já
            // sacrifica os mais fracos, então nada além disto é preciso.
            38369349,
        };

        // ------------------------------------------------------------------ Pegasus
        // O "roubo": as três cartas do deck dele que tiram o monstro do OUTRO em
        // vez de somar um monstro seu. Todas pedem alvo no campo do oponente, e
        // o alvo certo é sempre o MAIOR — que é justamente o default do
        // `DecideSelect` (maior ATK), então nenhuma delas precisa de flag.
        const uint COMIC_HAND = 33453260;             // equipa no monstro do oponente e TOMA o controle
        const uint RELINQUISHED = 64631466;           // Ritual 0/0: absorve 1 monstro do oponente
        const uint THOUSAND_EYES_RESTRICT = 63519819; // Fusão 0/0: absorve, e trava o campo todo

        static readonly HashSet<uint> ROUBO_DO_OPONENTE = new()
        {
            COMIC_HAND, RELINQUISHED, THOUSAND_EYES_RESTRICT,
        };

        // ------------------------------------------------------------ equipamentos
        const uint ARMORY_CALL = 38960450;

        // ------------------------------------------------- o pacote "Normal grande"
        //
        // As duas andam JUNTAS e é por isso que estão lado a lado: a Art acha o
        // corpo no deck, as Regras o põem em campo sem tributo. Separadas, cada
        // uma vale pouco; juntas, tiram um 2200 do nada no primeiro turno.
        //
        // Só valem para monstro NORMAL de nível 5+ — o texto das duas exige, e é
        // essa exigência que faz um deck vanilla (Pegasus, e a Lista 1 inteira)
        // competir com deck de efeito.
        const uint ANCIENT_RULES = 10667321;   // Invoca Especialmente 1 Normal Nv5+ da MÃO
        const uint SUMMONERS_ART = 79816536;   // busca 1 Normal Nv5+ do DECK

        /// <summary>Monstro Normal de nível 5 ou mais — o que as duas cartas acima aceitam.</summary>
        const uint TYPE_NORMAL = 0x10;
        bool EhNormalGrande(uint code)
        {
            var st = _cards.Stats(code);
            return st.IsMonster && (st.Type & TYPE_NORMAL) != 0 && st.Level >= 5;
        }

        /// <summary>
        /// O que um equipamento da Lista 1 DÁ e a quem ele serve.
        ///
        /// Só isto precisa de tabela: a exigência ("só em Dragão") e o bônus
        /// moram no Lua e no texto da carta, não no `cards.cdb`. De quem RECEBE,
        /// o banco responde — `Stats(code).Race` / `.Attribute` — então nenhuma
        /// raça de monstro é chumbada aqui.
        ///
        /// `Raca`/`Atributo` em 0 = serve em qualquer monstro. Bônus 0 = não é
        /// carta de reforço e o NPC não a escolhe para pumpar: Ring of
        /// Magnetism, Paralyzing Potion e Germ Infection existem para atrapalhar
        /// o monstro do OUTRO, e Premature Burial é um revive disfarçado de
        /// equipamento (o Armory Call até a busca, mas ela não equipa em nada
        /// que já esteja no campo).
        /// </summary>
        readonly record struct Equipamento(int Bonus, uint Raca, uint Atributo);

        const uint R_WARRIOR = 0x1, R_SPELLCASTER = 0x2, R_FAIRY = 0x4, R_FIEND = 0x8,
                   R_ZOMBIE = 0x10, R_MACHINE = 0x20, R_AQUA = 0x40, R_WINGEDBEAST = 0x200,
                   R_PLANT = 0x400, R_INSECT = 0x800, R_THUNDER = 0x1000, R_DRAGON = 0x2000,
                   R_BEAST = 0x4000, R_BEASTWARRIOR = 0x8000, R_DINOSAUR = 0x10000;
        const uint A_EARTH = 0x1, A_WATER = 0x2, A_FIRE = 0x4, A_WIND = 0x8,
                   A_LIGHT = 0x10, A_DARK = 0x20;

        static readonly Dictionary<uint, Equipamento> EQUIPAMENTOS = new()
        {
            // +300 ATK/DEF por TIPO — o ciclo clássico, um por raça.
            [1435851]  = new(300, R_DRAGON, 0),        // Dragon Treasure
            [91595718] = new(300, R_SPELLCASTER, 0),   // Book of Secret Arts
            [61854111] = new(300, R_WARRIOR, 0),       // Legendary Sword
            [46009906] = new(300, R_BEAST, 0),         // Beast Fangs
            [25769732] = new(300, R_MACHINE, 0),       // Machine Conversion Factory
            [77007920] = new(300, R_INSECT, 0),        // Laser Cannon Armor
            [77027445] = new(300, R_AQUA, 0),          // Power of Kaishin
            [51267887] = new(300, R_DINOSAUR, 0),      // Raise Body Heat
            [39774685] = new(300, R_PLANT, 0),         // Vile Germs
            [15052462] = new(300, R_ZOMBIE, 0),        // Violet Crystal
            [1557499]  = new(300, R_FAIRY, 0),         // Silver Bow and Arrow
            [4614116]  = new(300, R_FIEND, 0),         // Dark Energy
            [37820550] = new(300, R_THUNDER, 0),       // Electro-Whip
            [98252586] = new(300, R_WINGEDBEAST, 0),   // Follow Wind
            [36607978] = new(300, R_BEASTWARRIOR, 0),  // Mystical Moon

            // +400 ATK / −200 DEF por ATRIBUTO. Valem mais em ATK que os de tipo,
            // e o NPC ataca — por isso ganham deles no desempate.
            [37120512] = new(400, 0, A_DARK),          // Sword of Dark Destruction
            [2370081]  = new(400, 0, A_WATER),         // Steel Shell
            [18937875] = new(400, 0, A_FIRE),          // Burning Spear
            [39897277] = new(400, 0, A_LIGHT),         // Elf's Light
            [55321970] = new(400, 0, A_WIND),          // Gust Fan
            [98374133] = new(400, 0, A_EARTH),         // Invigoration

            // Os grandes.
            [32268901] = new(700, 0, A_FIRE),          // Salamandra
            [3492538]  = new(700, R_INSECT, 0),        // Insect Armor with Laser Cannon
            [83225447] = new(700, 0, 0),               // Stim-Pack — perde 200 por Standby sua
            [98495314] = new(500, 0, 0),               // Sword of Deep-Seated

            // Reforço nenhum (ver o comentário acima).
            [20436034] = new(0, 0, 0),                 // Ring of Magnetism
            [50152549] = new(0, 0, 0),                 // Paralyzing Potion
            [24668830] = new(0, 0, 0),                 // Germ Infection
            [70828912] = new(0, 0, 0),                 // Premature Burial
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
        /// <summary>
        /// ATK/DEF ATUAIS de um monstro (jogador, sequência da zona), perguntados
        /// ao motor. Ver <see cref="EmCampo"/> — é o conserto do NPC que atacava
        /// pelo statline impresso e ignorava equipamento e magia de campo.
        /// </summary>
        readonly Func<int, int, (int atk, int def)?> _statsEmCampo;
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
                        Func<int, IReadOnlyList<uint>> setStOf = null,
                        Func<int, int, (int atk, int def)?> statsEmCampoOf = null)
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
            // Sem quem responda, cai no statline IMPRESSO da carta (`EmCampo`).
            // É o comportamento de antes, e é o que os testes de decisão isolada
            // usam — eles montam campo com códigos, sem motor por trás.
            _statsEmCampo = statsEmCampoOf ?? ((_, _) => null);
        }

        /// <summary>
        /// **O ATK/DEF que valem AGORA** para um monstro em campo.
        ///
        /// Pergunta ao motor (que já resolveu Equip Spell, magia de campo e
        /// qualquer efeito contínuo) e só cai no statline IMPRESSO da carta
        /// quando não há motor do outro lado — os testes de decisão isolada, que
        /// montam campo com códigos e `seq = -1`.
        ///
        /// Esta função existe por um bug de verdade: o cérebro inteiro lia
        /// `_cards.Stats(code)`, que é o número gravado no `cards.cdb`. Um
        /// monstro do jogador com +700 de equipamento, ou de pé numa Umi, seguia
        /// valendo o número impresso na conta do NPC — que então atacava um
        /// corpo maior que o dele achando que ganhava, e perdia o monstro. A
        /// tela mostrava o ATK certo (o evento `stats` já vinha do motor); só
        /// quem decide o ataque é que não via.
        ///
        /// Vale para os DOIS lados: subestimar o próprio monstro equipado fazia
        /// o NPC recusar um ataque que ele ganharia.
        /// </summary>
        (int atk, int def) EmCampo(uint code, int player, int seq)
        {
            var vivo = _statsEmCampo(player, seq);
            if (vivo != null) return vivo.Value;
            var st = _cards.Stats(code);
            return (st.AtkValue, st.DefValue);
        }

        /// <summary>
        /// Quanto vale ENFRENTAR este monstro: a ATK se ele está em ataque, a DEF
        /// se está deitado. É o número que a batalha realmente usa — comparar
        /// sempre pela ATK fazia o NPC atacar uma parede 800/2000 achando que
        /// enfrentava 800.
        /// </summary>
        int ValorNaBatalha(uint code, int pos, int player, int seq)
        {
            var (atk, def) = EmCampo(code, player, seq);
            // 0x4 é defesa aberta, 0x8 é defesa VIRADA — o setado do oponente cai
            // nesta segunda, e é exatamente ele que o NPC só passou a enxergar
            // com a leitura de campo.
            return (pos & (POS_DEFESA | POS_DEFESA_VIRADA)) != 0 ? def : atk;
        }

        /// <summary>
        /// ATK atual de um monstro do JOGADOR indicado, na zona indicada. Atalho
        /// de leitura para as regras que só comparam ataque.
        /// </summary>
        int AtkEmCampo(uint code, int player, int seq) => EmCampo(code, player, seq).atk;

        /// <summary>
        /// Os monstros de um jogador que estão com a FACE PARA CIMA, com a
        /// sequência da zona — que é o que permite perguntar o ATK atual deles ao
        /// motor. Mesmo conjunto que o `_fieldOf` de sempre devolve; a diferença
        /// é só carregar a zona junto.
        /// </summary>
        List<(uint code, int pos, int seq)> AbertosDe(int player) =>
            _todoFieldPosOf(player)
                .Where(m => (m.pos & (POS_ATAQUE | POS_DEFESA)) != 0 && _cards.Stats(m.code).IsMonster)
                .ToList();

        // ---- leitura: o que o oponente tem guardado ----

        /// <summary>
        /// Os monstros do oponente (inclusive os VIRADOS, com a DEF real), já
        /// avaliados pelo número que a batalha usa.
        /// </summary>
        List<(uint code, int valor)> MonstrosDele(int foe) =>
            _todoFieldPosOf(foe)
                .Where(m => _cards.Stats(m.code).IsMonster)
                .Select(m => (m.code, valor: ValorNaBatalha(m.code, m.pos, foe, m.seq)))
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
        /// <summary>O que o efeito da carta faz, pelo banco e pelo Lua dela — sem
        /// lista de IDs. Ver `DatabaseManager.Perfil`.</summary>
        DatabaseManager.PerfilDeEfeito Perfil(uint code) => _cards.Perfil(code);

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

            // Alvo do Mausoléu que não foi consumido: a ativação foi negada, ou
            // o motor nunca chegou a perguntar quem sobe. Chegar aqui significa
            // que a jogada acabou — deixar a marca de pé faria a PRÓXIMA escolha
            // da mão (um custo de descarte, por exemplo) jogar fora justamente a
            // carta que ele ia invocar.
            _alvoDaInvocacaoDaMao = 0;

            // 0. BUSCA ESPECÍFICA antes da compra. Comprar primeiro pode trazer a
            //    carta que a busca traria — e aí a busca vira carta morta. Buscar
            //    primeiro nunca desperdiça. O Pote continua logo abaixo, então na
            //    decisão seguinte ele sai do mesmo jeito, só que com o deck já
            //    afinado.
            //    A lista `BUSCA_ESPECIFICA` continua por trás, mas o que reconhece
            //    a carta agora é o EFEITO: `Perfil().Busca` (a categoria de busca
            //    do banco mais o `LOCATION_DECK` no Lua). Toda carta que tira do
            //    deck e põe na mão entra aqui sem uma linha nova — foi assim que o
            //    Magician's Rod e o Terraforming passaram a ser jogados.
            var buscaEsp = AtivavelSe(q, c => BUSCA_ESPECIFICA.Contains(c) || (Perfil(c).Busca && !COM_REGRA_PROPRIA.Contains(c)));
            if (buscaEsp.code != 0)
                return new Play("activate", buscaEsp.index,
                    $"busca antes da compra: tira do deck em vez de comprar as cegas ({buscaEsp.code})");

            // 0.1 COMPRA LIMPA — qualquer carta que COMPRE sem cobrar nada, antes
            //     de qualquer invocação. Mais carta na mão é mais jogada possível,
            //     e nada se perde no caminho.
            //
            //     Não é mais o Pote da Ganância por ID: quem responde "esta carta
            //     compra?" é o PRÓPRIO jogo (a `category` do `cards.cdb` mais o
            //     `Duel.Draw` no Lua da carta — ver `DatabaseManager.Perfil`).
            //     Toda carta de compra que entrar em qualquer deck, hoje ou
            //     depois, passa a ser usada sem uma linha nova aqui.
            var compraLimpa = AtivavelSe(q, c => Perfil(c).Compra && !Perfil(c).Descarta);
            if (compraLimpa.code != 0)
                return new Play("activate", compraLimpa.index,
                    $"compra limpa ({compraLimpa.code}): mais carta na mao sem custo nenhum");

            // 0.15 COMPRA COM DESCARTE — Graceful Charity, Dark World Dealings,
            //      Trade-In. Aqui a compra CUSTA, então ativar por ativar é trocar
            //      as cartas que eu escolhi manter pelas que o deck sortear. Duas
            //      situações em que vale, e o log diz qual foi:
            //
            //      (a) PRECISO COMPRAR: não tenho o que pôr em campo — nem monstro
            //          invocável, nem corpo já em campo. Parado, a mão que eu
            //          guardo não vale nada;
            //      (b) O DESCARTE É GANHO: tenho um corpo grande preso na mão (o
            //          Nv5+ que espera tributos que não chegam) e uma carta que o
            //          traz DE VOLTA do cemitério. Aí descartar não é perder — é
            //          um atalho para pôr o grandão em campo, e de graça.
            //
            //      Quem escolhe O QUE descartar é o `DecideSelect`, que já joga
            //      fora o maior monstro justamente para revivê-lo depois — e já
            //      protege o que não volta (Gate Guardian e as peças).
            var compraCara = AtivavelSe(q, c => Perfil(c).Compra && Perfil(c).Descarta);
            if (compraCara.code != 0)
            {
                bool semJogada = q.summonable.Count == 0 && q.spSummonable.Count == 0
                                 && QtdMonstros(me) == 0;
                bool gordoNaMao = _handOf(me).Any(c =>
                    _cards.Stats(c).IsMonster && _cards.Stats(c).Level >= 5);
                bool podeReanimar = _handOf(me).Concat(_faceUpStOf(me)).Concat(_setStOf(me))
                    .Any(c => Perfil(c).ReanimaDoCemiterio);

                if (semJogada)
                    return new Play("activate", compraCara.index,
                        $"compra com descarte ({compraCara.code}): sem monstro em campo nem " +
                        "invocacao na mao, parado eu nao faco nada mesmo");
                if (gordoNaMao && podeReanimar)
                    return new Play("activate", compraCara.index,
                        $"compra com descarte ({compraCara.code}): o corpo grande preso na mao " +
                        "vai para o cemiterio e volta pela reanimacao que eu tenho");
                _log($"guarda a compra com descarte ({compraCara.code}): tenho jogada em campo e " +
                     $"o descarte seria perda seca (grande na mao: {gordoNaMao}, reanimacao: {podeReanimar})");
            }

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
            //     Reconhecida pela CLASSE (`Perfil().Fusao`), e não só pela lista:
            //     The Eye of Timaeus funde um Dark Magician que já está em campo
            //     sem gastar Polymerization nenhuma, e entra aqui de graça.
            var fusao = AtivavelSe(q, c => FUSAO.Contains(c) || (Perfil(c).Fusao && !COM_REGRA_PROPRIA.Contains(c)));
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

            // 5.34 ROUBAR O MONSTRO DO OPONENTE (Comic Hand, Relinquished,
            //      Thousand-Eyes Restrict — o deck do Pegasus).
            //
            //      Vem ANTES de qualquer reforço: tirar o maior monstro do outro
            //      lado é uma troca de 2 — o campo dele encolhe e o meu cresce na
            //      mesma carta —, enquanto um equipamento só soma ATK. Contra um
            //      corpo que o NPC não supera, é a única resposta do deck.
            //
            //      Alvo: o `DecideSelect` já escolhe o de MAIOR ATK entre o que o
            //      motor oferecer, e como as três só aceitam monstro do oponente,
            //      a lista que chega já vem filtrada pelo Lua. Nada de flag.
            //
            //      O motor também guarda as condições (Toon World em campo para a
            //      Comic Hand, "uma vez por turno" para as duas absorções), então
            //      estar em `activatable` já significa que dá para usar.
            var roubo = AtivavelSe(q, ROUBO_DO_OPONENTE.Contains);
            if (roubo.code != 0 && QtdMonstros(foe) >= 1)
                return new Play("activate", roubo.index,
                    $"rouba o maior monstro do oponente ({roubo.code}) — tira dele e poe do meu lado");

            // 5.35 ARMORY CALL — busca 1 equipamento do deck e JÁ equipa.
            //
            //   Só sai com monstro meu com a face para cima. Sem alvo o motor
            //   nem chega a perguntar se quero equipar (o `eqfilter` do Lua exige
            //   `IsFaceup()`), e a armadilha viraria uma busca seca — a carta é
            //   1x por turno e vale muito mais como reforço imediato.
            //
            //   O motor oferece TODO equipamento do deck (`thfilter` só pede
            //   TYPE_EQUIP), inclusive os que não podem equipar em nada que eu
            //   controlo. Quem separa o útil do inútil é o `DecideSelect` logo
            //   abaixo, avisado por `_proximoEquipDoDeck`.
            //   O que existe no deck só aparece na hora da seleção — aqui a
            //   condição é a que dá para saber: tenho alvo?
            if (Ativavel(q, ARMORY_CALL))
            {
                int alvos = MonstrosFaceUp(me).Count;
                if (alvos > 0)
                {
                    _proximoEquipDoDeck = true;
                    return new Play("activate", IdxAtivavel(q, ARMORY_CALL),
                        $"Armory Call: busca equipamento do deck e ja equipa ({alvos} alvo(s) em campo)");
                }
                _log("guarda Armory Call: nenhum monstro meu com a face para cima " +
                     "para receber o equipamento");
            }

            // 5.36 SUMMONER'S ART — busca 1 Normal Nv5+ do deck.
            //
            //   Vem ANTES do Ancient Rules de propósito: as duas são Magias
            //   Normais sem limite por turno, então buscar o corpo e invocá-lo no
            //   MESMO turno é uma jogada só, dividida em duas passadas do cérebro.
            //   Na ordem inversa o NPC invocaria o que já tinha e deixaria a busca
            //   para depois — perdendo o combo.
            //
            //   Vale mesmo sem as Regras na mão: é carta a mais, e o alvo buscado
            //   ainda pode entrar por tributo normal. Mas o log distingue os dois
            //   casos, porque um é combo e o outro é só reposição.
            if (Ativavel(q, SUMMONERS_ART))
            {
                bool combo = NaMao(me, ANCIENT_RULES);
                return new Play("activate", IdxAtivavel(q, SUMMONERS_ART),
                    combo ? "Summoner's Art: busca o corpo Nv5+ para as Regras Antigas invocarem ja"
                          : "Summoner's Art: busca um Normal Nv5+ do deck");
            }

            // 5.37 ANCIENT RULES — Invocação Especial de um Normal Nv5+ da MÃO.
            //
            //   O grande ganho é NÃO gastar a Invocação Normal do turno: o corpo
            //   grande entra de graça e a invocação normal fica livre para um
            //   segundo monstro. Por isso vem antes do beatdown (6), que é quem
            //   gastaria o tributo.
            //
            //   A conferência da mão é a mesma cautela do Armory Call: o Lua já
            //   exige o alvo, mas quando dá para saber, se sabe — e o log explica
            //   a recusa em vez de deixar a carta parada sem motivo aparente.
            if (Ativavel(q, ANCIENT_RULES))
            {
                var corpo = _handOf(me).Where(EhNormalGrande)
                    .OrderByDescending(c => _cards.Stats(c).AtkValue).FirstOrDefault();
                if (corpo != 0)
                {
                    var st = _cards.Stats(corpo);
                    return new Play("activate", IdxAtivavel(q, ANCIENT_RULES),
                        $"Ancient Rules: poe {st.AtkValue} de ATK (Nv{st.Level}) em campo " +
                        "sem gastar a invocacao normal");
                }
                _log("guarda Ancient Rules: nenhum monstro Normal Nv5+ na mao para invocar");
            }

            // 5.375 QUALQUER CARTA QUE PONHA CORPO EM CAMPO — a regra genérica que
            //       fecha a classe. Reconhecida pelo EFEITO (`Perfil().InvocaEspecial`):
            //       a categoria de Invocação Especial do banco mais o `SpecialSummon`
            //       no Lua da carta. Cobre Dark Magic Veil, Magician Navigation,
            //       Eternal Soul, Escape from the Dark Dimension e qualquer outra
            //       que entre em qualquer deck depois desta linha.
            //
            //       Duas travas, porque estas cartas CUSTAM:
            //
            //       • só quando eu PRECISO de corpo — sem monstro em campo, ou com o
            //         que tenho perdendo para a ameaça do outro lado. Com o campo
            //         resolvido, gastar a carta agora é jogar fora a que resolveria
            //         o turno em que ele varrer a mesa;
            //       • quem cobra LP (o Lua chama `PayLPCost`) respeita o piso de
            //         vida. O motor recusaria sozinho o pagamento impossível, mas
            //         "posso pagar" e "vale pagar" são perguntas diferentes.
            //
            //       Vem DEPOIS das regras específicas de invocação (Toon, mariposa,
            //       Gate Guardian, Ancient Rules) de propósito: elas são escolhas de
            //       combo, esta é "põe o que der em campo".
            var poeCorpo = AtivavelSe(q, c => Perfil(c).InvocaEspecial && !Perfil(c).Fusao && !COM_REGRA_PROPRIA.Contains(c));
            if (poeCorpo.code != 0)
            {
                bool precisoDeCorpo = QtdMonstros(me) == 0 || (oponenteTemMonstro && meuMelhor < ameaca);
                bool pagoOPreco = !Perfil(poeCorpo.code).PagaLp || _lpOf(me) - 1000 >= LP_PISO;
                if (precisoDeCorpo && pagoOPreco)
                    return new Play("activate", poeCorpo.index,
                        $"Invocacao Especial ({poeCorpo.code}): poe corpo em campo — " +
                        (QtdMonstros(me) == 0 ? "estou sem monstro" : $"meu melhor ({meuMelhor}) nao segura {ameaca}"));
                _log($"guarda {poeCorpo.code} (invoca especialmente): " +
                     (!precisoDeCorpo ? "meu campo ja' resolve o turno" : $"o custo em LP me deixaria abaixo de {LP_PISO}"));
            }

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
            //   As duas listas continuam existindo (elas carregam conhecimento que
            //   a categoria não tem), mas o reconhecimento é por CLASSE DE EFEITO:
            //   `Perfil().DestroiMonstro` e `.DestroiSt`. É o que faz o Thousand
            //   Knives e o Dark Magic Attack — que só ficam ativáveis com um Dark
            //   Magician em campo, e a condição quem confere é o motor — serem
            //   usados sem uma linha por carta.
            //   O `!InvocaEspecial` separa "destrói o dele" de "destrói o MEU": o
            //   Escape from the Dark Dimension traz um banido de volta E destrói
            //   esse mesmo monstro quando sair do campo, então a categoria dele
            //   acusa destruição — que não é o efeito pelo qual se ativa a carta.
            //   Quem põe corpo em campo é julgado pela regra de invocação, abaixo.
            var remMon = AtivavelSe(q, c => REMOCAO_MONSTRO.Contains(c) || (Perfil(c).DestroiMonstro && !Perfil(c).InvocaEspecial && !COM_REGRA_PROPRIA.Contains(c)));
            if (remMon.code != 0 && QtdMonstros(foe) >= 1)
                return new Play("activate", remMon.index, $"remocao: limpa o campo do oponente ({remMon.code})");
            var remST = AtivavelSe(q, c => REMOCAO_ST.Contains(c) || (Perfil(c).DestroiSt && !Perfil(c).InvocaEspecial && !COM_REGRA_PROPRIA.Contains(c)));
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

            // ---------------- pacote Para & Dox (o Labirinto) ----------------
            //
            // O deck dos Irmãos Paradoxo é feito de corpos ENORMES que o jogo
            // normal não deixa invocar: Nv7 aos montes e o Gate Guardian de
            // 3750, que nem invocação normal tem. Ele vive de atalhos — tributa
            // um corpo qualquer e traz um grande de graça. Sem estas regras o
            // NPC ficava com a mão cheia de Nv7 e um Labyrinth Wall em campo.

            // 5.90 MAUSOLÉU DO IMPERADOR — a magia de campo que resolve o
            //      problema-raiz deste deck: um Nv7 na mão pede DOIS tributos, e
            //      até eles chegarem o NPC não põe corpo nenhum. Pagando LP, o
            //      Mausoléu invoca esse Nv7 sem tributo — e é assim que as peças
            //      do Gate Guardian chegam ao campo sem gastar outro corpo.
            //
            //      São dois passos, e por isso duas regras: primeiro a magia sai
            //      da MÃO para a zona de campo; depois, já em campo, o efeito de
            //      IGNIÇÃO dela é que invoca. As duas aparecem em `activatable`
            //      com o mesmo código — quem separa é o `location`.
            var mausoleuNaMao = q.activatable.FirstOrDefault(
                a => a.code == MAUSOLEUM && a.location == HAND);
            var mausoleuEmCampo = q.activatable.FirstOrDefault(
                a => a.code == MAUSOLEUM && a.location == SZONE);

            //      O efeito primeiro: com a magia já em campo, usá-la é sempre
            //      melhor que pôr outra cópia no lugar. O `PlanoDoMausoleu` diz
            //      quem sobe e quanto custa — e o plano é o mesmo que o
            //      `DecideOption` e o `DecideSelect` vão seguir logo em seguida.
            var plano = PlanoDoMausoleu(me);
            if (mausoleuEmCampo.code == MAUSOLEUM)
            {
                if (plano.alvo != 0)
                {
                    // A flag é o que avisa o `DecideSelect` de que a pergunta da
                    // mão que vem aí é uma INVOCAÇÃO, e não um custo de
                    // descarte: as duas chegam lá como "escolha uma carta da
                    // mão" e querem exatamente o oposto uma da outra. Mesmo
                    // padrão do `_proximoAlvoEquipFraco`.
                    _alvoDaInvocacaoDaMao = plano.alvo;
                    return new Play("activate", mausoleuEmCampo.index,
                        $"Mausoleu: paga {plano.custo} LP e invoca {plano.alvo} " +
                        $"(ATK {_cards.Stats(plano.alvo).AtkValue}) da mao, sem tributo");
                }
                _log($"guarda o efeito do Mausoleu: nenhum Nv5+ na mao que eu consiga " +
                     $"pagar sem cair abaixo do piso de {LP_PISO} LP");
            }

            //      A magia da mão só vale a pena com um corpo grande esperando —
            //      e ela ajuda OS DOIS lados (`EFFECT_FLAG_BOTH_SIDE`), então
            //      abrir o campo sem ter o que invocar é presentear o oponente.
            if (mausoleuNaMao.code == MAUSOLEUM)
            {
                if (_faceUpStOf(me).Contains(MAUSOLEUM))
                    _log("guarda a 2a copia do Mausoleu: ja' tenho um em campo");
                else if (plano.alvo == 0)
                    _log("guarda o Mausoleu: sem Nv5+ na mao ele so' ajudaria o oponente");
                else
                    return new Play("activate", mausoleuNaMao.index,
                        $"Mausoleu do Imperador: abre a invocacao de {plano.alvo}, preso na mao");
            }

            // 5.91 GATE GUARDIAN e qualquer OUTRO corpo grande oferecido por
            //      Invocação Especial. O motor só põe em `spSummonable` o que já
            //      pode ser pago (o Gate Guardian exige Sanga + Kazejin + Suijin
            //      em campo, e é o Lua dele que confere) — então aqui não há
            //      condição a checar, só a escolha de qual.
            //
            //      A regra é genérica de propósito: qualquer deck que ganhe uma
            //      Invocação Especial passa a usá-la, em vez de precisar de uma
            //      linha por carta como o Toon e as mariposas acima. Elas
            //      continuam antes porque são ESCOLHAS de combo (o Toon mais
            //      forte, a mariposa que evoluiu), não "o maior da lista".
            var corpoSp = Monstros(q.spSummonable)
                .Where(c => c.St.AtkValue > MaiorAtkEmCampo(me))
                .OrderByDescending(c => c.St.AtkValue)
                .FirstOrDefault();
            if (corpoSp.Ok)
                return new Play("spsummon", corpoSp.Act.index,
                    $"Invocacao Especial de {corpoSp.Act.code} (ATK {corpoSp.St.AtkValue}) — " +
                    "o motor ja' confirmou que o custo esta' pago");

            // 5.92 TRIBUTE DOLL: tributa 1 monstro e Invoca Especialmente um Nv7
            //      da MÃO. É a porta de entrada dos guardiões (Sanga, Kazejin,
            //      Suijin) e de todo Nv7 do deck — sem ela eles ficariam presos
            //      na mão esperando dois tributos que nunca chegam.
            //
            //      A conferência da mão é a mesma cautela do Ancient Rules: o Lua
            //      já exige o alvo, mas quando dá para saber, se sabe — e o log
            //      explica a recusa em vez de deixar a carta parada sem motivo.
            if (Ativavel(q, TRIBUTE_DOLL))
            {
                // Quem entra: entre os Nv7 da mão, uma PEÇA que falta em campo
                // vem antes do resto mesmo tendo menos ATK — o Kazejin de 2400
                // completa o Gate Guardian, o Garnecia de 2400 não completa nada.
                var nv7Mao = _handOf(me)
                    .Where(c => _cards.Stats(c).IsMonster && _cards.Stats(c).Level == 7)
                    .OrderByDescending(c => PecaQueFalta(me, c) ? 1 : 0)
                    .ThenByDescending(c => _cards.Stats(c).AtkValue)
                    .ToList();
                var nv7 = nv7Mao.FirstOrDefault();
                int sai = ValorDoTributoQueSai(me);
                int entra = nv7 == 0 ? 0 : _cards.Stats(nv7).AtkValue;
                if (nv7 == 0)
                    _log("guarda Tribute Doll: nenhum monstro Nv7 na mao para trazer");
                else if (!TemCorpoDispensavel(me))
                    _log("guarda Tribute Doll: so' tenho peca do Gate Guardian em campo — " +
                         "o tributo comeria justamente o que estou juntando");
                else if (entra <= sai)
                    // O que sai é medido pelo que ele FAZ: um Labyrinth Wall
                    // deitado vale os 3000 de DEF dele, não os 0 de ATK. Sem
                    // isto o NPC trocou, num duelo real, um muro de 3200 de
                    // defesa por um corpo de 2400 diante de um campo de 2600 —
                    // e o Lua ainda proíbe o recém-chegado de atacar no turno.
                    _log($"guarda Tribute Doll: o corpo que eu tributaria vale {sai} " +
                         $"em campo e o Nv7 que entra so' {entra}");
                else
                {
                    // Quem sobe é a marca, não o acaso: a pergunta que vem em
                    // seguida ("escolha uma carta da mão") é a MESMA de um custo
                    // de descarte, e sem isto o critério de descarte escolheria
                    // — trazendo justamente a carta que a fila joga fora por
                    // último.
                    _alvoDaInvocacaoDaMao = nv7;
                    return new Play("activate", IdxAtivavel(q, TRIBUTE_DOLL),
                        $"Tribute Doll: troca um corpo de {sai} pelo Nv7 {nv7} " +
                        $"(ATK {entra}) da mao");
                }
            }

            // 5.93 METAMORPHOSIS: tributa 1 monstro e traz do Extra uma FUSÃO do
            //      MESMO nível. No deck do labirinto é o Labyrinth Tank (2400)
            //      saindo de um Nv7 qualquer — e é a única forma dele aparecer,
            //      porque os materiais da receita nem estão no deck.
            //
            //      A conta de "vale a pena" NÃO é feita aqui, e é de propósito:
            //      o cérebro não enxerga o Extra Deck (nenhum acessador dá isso,
            //      e inventar um só para esta carta seria uma via de mão única).
            //      O que dá para saber com o que se tem: o motor só oferece a
            //      carta quando existe fusão de nível compatível para trazer, e
            //      quem escolhe o tributo é o `DecideSelect`, que sacrifica o
            //      MENOR ATK. Falta só não ficar de campo vazio — daí o 2+.
            if (Ativavel(q, METAMORPHOSIS))
            {
                if (QtdMonstros(me) < 2)
                    _log("guarda Metamorphosis: tenho um corpo so' em campo — tributa-lo deixaria o campo vazio");
                else if (!TemCorpoDispensavel(me))
                    // A fusão que ela traz aqui é o Labyrinth Tank, 2400 — menos
                    // que Sanga e Suijin, e sem a habilidade que zera o ATK de
                    // quem ataca. Trocar peça por Tank é perder duas vezes.
                    _log("guarda Metamorphosis: em campo so' tenho peca do Gate Guardian, " +
                         "e o efeito de cada uma vale mais que a fusao que ela traz");
                else
                    return new Play("activate", IdxAtivavel(q, METAMORPHOSIS),
                        "Metamorphosis: troca o corpo dispensavel mais fraco por uma fusao do Extra");
            }

            // 5.94 MONSTER GATE: tributa 1 e cava o deck até achar um monstro
            //      invocável, que entra de graça. Num deck cheio de Nv7 a cava
            //      quase sempre paga o tributo — e o custo sai do corpo mais
            //      fraco (quem escolhe é o DecideSelect).
            //
            //      Depois do Metamorphosis de propósito: os dois gastam o mesmo
            //      corpo, e o Metamorphosis diz exatamente o que traz, enquanto
            //      este é uma aposta na média do deck. O 2+ é a mesma trava:
            //      cavar é bom, ficar de campo vazio para cavar não é.
            if (Ativavel(q, MONSTER_GATE) && QtdMonstros(me) >= 2)
            {
                if (TemCorpoDispensavel(me))
                    return new Play("activate", IdxAtivavel(q, MONSTER_GATE),
                        "Monster Gate: tributa o corpo dispensavel mais fraco e cava o deck por um monstro");
                _log("guarda Monster Gate: o tributo sairia de uma peca do Gate Guardian — " +
                     "cavar as cegas nao paga o que ela ja' e' em campo");
            }

            // 5.95 MAGICAL LABYRINTH: equipa no Labyrinth Wall e, depois,
            //      tributa o muro para trazer o Wall Shadow (1600/3000) do DECK.
            //      O muro é 0/3000 — trocar por um 1600/3000 é só ganho, e é o
            //      combo assinatura da dupla.
            if (Ativavel(q, MAGICAL_LABYRINTH))
                return new Play("activate", IdxAtivavel(q, MAGICAL_LABYRINTH),
                    "Magical Labyrinth: equipa o muro (e depois troca por Wall Shadow 1600/3000)");

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
            // E quem GANHA AO SER INVOCADO também fica fora: setar é pôr com a
            // face para baixo, e o gatilho de invocação simplesmente não
            // acontece. Visto em duelo: o NPC setou o Magician's Rod (1600/100)
            // como parede contra um 1800 — jogou fora a busca que a carta faria
            // E pôs uma parede de 100 de DEF, perdendo as duas coisas de uma vez.
            var setaveis = seguraOCorpo
                ? new List<Cand>()
                : Monstros(q.settable)
                    .Where(c => c.Act.code != TIME_WIZARD && c.Act.code != COCOON_OF_EVOLUTION
                                && !Perfil(c.Act.code).GanhaAoInvocar)
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
                ameaca, "nivel maior", me);
            if (jogadaAlta.HasValue) return jogadaAlta.Value;

            var jogadaBaixa = Escolher(
                invocaveis.Where(c => c.St.Level <= 4).ToList(),
                setaveis.Where(c => c.St.Level <= 4).ToList(),
                ameaca, "nivel 1-4", me);
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

            // **Toda escolha DIRIGIDA abaixo devolve UM índice** — o alvo do
            // equipamento, o Normal Nv5+, a busca no deck, o Toon World, a
            // remoção de S/T, o alvo do Mausoléu. Elas só valem quando o motor
            // pede UMA carta; respondendo uma para um pedido de duas, o core
            // recusa a resposta e a repete, e o duelo TRAVA sem erro nenhum.
            //
            // Foi o que aconteceu com a Graceful Charity (compra 3, descarta 2)
            // no deck do Para & Dox: a mão tem seis Normais Nv5+ (Labyrinth Wall
            // e Garnecia), então o ramo do "Normal Nv5+" casava no descarte e
            // respondia uma carta para um pedido de duas. O jogador relatou
            // "ativou 2 potes + 1 charity e travou".
            bool escolhaUnica = need == 1;
            var picks = new List<int>();
            if (q.choices.Count == 0) return picks;

            // Tributo por sacrifício: os mais FRACOS até somar os releases pedidos.
            //
            // O `release` de cada opção é quanto ELA vale em tributos — o motor
            // já resolve as cartas que "contam como dois" (Double Coston para
            // DARK, Kaiser Sea Horse para LIGHT, os Effigy para Normal). Contar
            // por `release` em vez de por cabeça é o que faz o NPC invocar um
            // Nv7 com uma carta só quando tem uma dessas em campo.
            //
            // A armadilha é a outra ponta: quem vale dois costuma ser um corpo
            // FRACO de propósito (o Earth Effigy tem 100 de ATK), então a ordem
            // por ATK o escolhia primeiro — e ele virava tributo comum de uma
            // invocação que qualquer monstro pagaria. Gastar o que vale dois
            // onde um bastava é jogar fora meia invocação futura.
            if (q.choices[0].release > 0)
            {
                int Vale(InteractiveDuel.Sel c) => Math.Max(1, (int)c.release);

                // Primeiro tenta pagar SÓ com quem vale um. Se der, o que vale
                // dois fica guardado para o corpo grande que ele sozinho paga.
                var simples = q.choices.Where(c => Vale(c) == 1).ToList();
                var fonte = simples.Sum(Vale) >= need ? simples : q.choices;

                // Peça do Gate Guardian por último, mesmo empatando em ATK: o
                // Kazejin e o Garnecia têm os mesmos 2400, e nesse empate a
                // ordem decidia por acaso qual dos dois virava custo. Quem sai é
                // sempre o que não faz falta ao combo. Isto é desempate, não
                // proibição — pedindo mais tributos do que eu tenho de sobra, a
                // peça entra: recusar aqui deixaria o motor esperando por uma
                // resposta que nunca viria.
                //
                // E o preço de cada corpo é o que ele FAZ na zona em que está,
                // não o ATK impresso: um Labyrinth Wall de 0/3000 deitado era o
                // "mais barato" do campo por ter 0 de ATK, e virava tributo de
                // qualquer coisa — inclusive de um corpo de 2400 que entra e
                // perde a batalha seguinte.
                int soma = 0;
                foreach (var c in fonte
                             .OrderBy(c => PECAS_GATE_GUARDIAN.Contains(c.code) ? 1 : 0)
                             .ThenBy(c => ValorDoMeuCorpo(me, c.code, c.sequence)))
                {
                    if (soma >= need) break;
                    picks.Add(c.index);
                    soma += Vale(c);
                }
                return picks;
            }

            // Alvo do Cocoon of Evolution: o inseto mais FRACO, não o mais forte
            // (o default logo abaixo é para remoção/reborn — o oposto do que o
            // casulo quer). `release==0` de propósito, nunca colide com o
            // tributo acima. Consome a flag numa tacada só, mesmo que a lista
            // de opções esteja vazia por algum motivo — nunca fica "presa"
            // esperando uma seleção que não vai vir.
            if (escolhaUnica && _proximoAlvoEquipFraco)
            {
                _proximoAlvoEquipFraco = false;
                if (q.choices.Count > 0)
                {
                    var maisFraco = q.choices.OrderBy(c => _cards.Stats(c.code).AtkValue).First();
                    return new List<int> { maisFraco.index };
                }
            }

            // Equipamento vindo do DECK (Armory Call). O motor oferece todos os
            // equipamentos do deck, inclusive os que não podem equipar em nada
            // que eu controlo — pelo critério genérico (maior ATK) todos empatam
            // em 0 e ele levaria o primeiro da lista, que dá na mesma que sortear.
            if (escolhaUnica && _proximoEquipDoDeck && q.choices[0].location == DECK)
            {
                _proximoEquipDoDeck = false;
                var escolha = MelhorEquipEntre(q.choices, me);
                if (escolha.index >= 0)
                {
                    _log($"Armory Call: escolhe {escolha.code} (+{escolha.ganho} ATK em {escolha.alvo})");
                    return new List<int> { escolha.index };
                }
                _log("Armory Call: nenhum equipamento do deck serve ao meu campo — " +
                     "leva o de maior bonus mesmo assim");
            }

            // NORMAL Nv5+ (Summoner's Art buscando no deck, Ancient Rules
            // invocando da mão): entre os oferecidos, o de maior ATK.
            //
            // Sem isto o critério genérico decidiria — e ele empata tudo que não
            // reconhece, levando o primeiro da lista. Num deck com Ryu-Ran (2200)
            // e Parrot Dragon (2000) isso é a diferença entre a melhor e a
            // segunda melhor carta, toda vez.
            //
            // Vale para as duas porque a pergunta é a mesma ("qual Normal Nv5+?"),
            // só muda de onde: o filtro por `EhNormalGrande` cobre os dois casos
            // sem precisar saber qual carta abriu a janela.
            byte deOnde = q.choices[0].location;
            var normaisGrandes = q.choices.Where(c => EhNormalGrande(c.code)).ToList();
            if (escolhaUnica && normaisGrandes.Count > 1 && (deOnde == DECK || deOnde == HAND))
            {
                var melhor = normaisGrandes
                    .OrderByDescending(c => _cards.Stats(c.code).AtkValue).First();
                _log($"Normal Nv5+: escolhe {melhor.code} " +
                     $"({_cards.Stats(melhor.code).AtkValue} ATK, o maior dos {normaisGrandes.Count} oferecidos)");
                return new List<int> { melhor.index };
            }

            // BUSCA DE MAGIA/ARMADILHA NO DECK (Magician's Rod, Terraforming): o
            // critério genérico logo abaixo ordena por ATK, que para magia é
            // sempre 0 — todas empatam e ele leva a primeira da lista, o que dá na
            // mesma que sortear. Aqui a ordem é pelo que a carta FAZ, na mesma
            // escala do resto do cérebro: pôr corpo em campo vale mais que
            // destruir, que vale mais que comprar.
            if (escolhaUnica && deOnde == DECK && q.choices.Count > 1
                && q.choices.All(c => !_cards.Stats(c.code).IsMonster))
            {
                int Valor(InteractiveDuel.Sel c)
                {
                    var p = Perfil(c.code);
                    if (p.InvocaEspecial) return 4;
                    if (p.DestroiMonstro || p.DestroiSt) return 3;
                    if (p.Busca) return 2;
                    if (p.Compra) return 1;
                    return 0;
                }
                var melhorSt = q.choices.OrderByDescending(Valor).First();
                if (Valor(melhorSt) > 0)
                {
                    _log($"busca no deck: escolhe {melhorSt.code} pelo efeito, nao pela ordem da lista");
                    return new List<int> { melhorSt.index };
                }
            }

            // Busca (ex.: Toon Table of Contents): se Toon World está entre as
            // opções e o NPC ainda não o tem nem na mão nem em campo, ele vem
            // em primeiro — sem ele nenhum outro Toon funciona por completo.
            // `release==0` aqui de propósito: nunca colide com o tributo acima.
            var toonWorld = q.choices.FirstOrDefault(c => c.code == TOON_WORLD);
            if (escolhaUnica && toonWorld.code == TOON_WORLD && !NaMao(me, TOON_WORLD) && !_faceUpStOf(me).Contains(TOON_WORLD))
                return new List<int> { toonWorld.index };

            byte loc = q.choices[0].location;

            // Alvo de uma remoção de magia/armadilha: o critério genérico abaixo
            // ordena por ATK, que para magia/armadilha é sempre 0 — na prática
            // ele estourava a primeira zona da lista. Com a leitura, escolhe a
            // que a regra já decidiu (ou, na falta dela, a mais pesada).
            if (escolhaUnica && loc == SZONE)
            {
                var mira = _proximoAlvoStPerigosa != 0
                    ? q.choices.FirstOrDefault(c => c.code == _proximoAlvoStPerigosa)
                    : default;
                _proximoAlvoStPerigosa = 0;
                if (mira.code != 0) return new List<int> { mira.index };
                var maisPesada = q.choices.OrderByDescending(c => Peso(c.code)).First();
                return new List<int> { maisPesada.index };
            }

            // A INVOCAÇÃO do Mausoléu chega aqui como "escolha uma carta da mão",
            // exatamente igual a um custo de descarte — e quer o oposto dele. A
            // regra já decidiu quem sobe (`PlanoDoMausoleu`); aqui é só cumprir.
            if (escolhaUnica && loc == HAND && _alvoDaInvocacaoDaMao != 0)
            {
                uint alvo = _alvoDaInvocacaoDaMao;
                _alvoDaInvocacaoDaMao = 0;
                var escolhido = q.choices.FirstOrDefault(c => c.code == alvo);
                if (escolhido.code == alvo)
                {
                    _log($"Mausoleu: invoca {alvo} da mao");
                    return new List<int> { escolhido.index };
                }
                _log($"Mausoleu: {alvo} nao esta' entre os oferecidos — segue o criterio geral");
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

        /// <summary>Monstros meus com a face para cima — os únicos que o Lua do
        /// Armory Call aceita como alvo (`eqfilter` exige `IsFaceup()`).</summary>
        List<uint> MonstrosFaceUp(int me) =>
            _fieldOf(me).Where(c => _cards.Stats(c).IsMonster).ToList();

        /// <summary>
        /// Entre os equipamentos que o motor ofereceu, o que rende mais ATK num
        /// monstro que eu realmente controlo.
        ///
        /// O casamento é sempre banco × tabela: a exigência sai de
        /// `EQUIPAMENTOS` (mora no Lua, não há de onde ler) e a raça/atributo de
        /// quem recebe sai do `cards.cdb`. Equipamento desconhecido é ignorado —
        /// o silêncio da tabela significa "não sei o que faz", e levar uma carta
        /// que não reforça nada é pior que levar a segunda melhor.
        /// </summary>
        (int index, uint code, int ganho, uint alvo) MelhorEquipEntre(
            IReadOnlyList<InteractiveDuel.Sel> opcoes, int me)
        {
            var meus = MonstrosFaceUp(me).Select(c => (code: c, st: _cards.Stats(c))).ToList();
            (int index, uint code, int ganho, uint alvo) melhor = (-1, 0, 0, 0);

            foreach (var o in opcoes)
            {
                if (!EQUIPAMENTOS.TryGetValue(o.code, out var e) || e.Bonus <= 0) continue;

                foreach (var m in meus)
                {
                    bool serve = (e.Raca == 0 || (m.st.Race & e.Raca) != 0)
                              && (e.Atributo == 0 || (m.st.Attribute & e.Atributo) != 0);
                    if (!serve) continue;
                    // Empate no bônus: reforça o MAIOR ATK. É ele que ataca, e
                    // +400 num 1800 vira 2200 — passa por cima de mais coisa que
                    // os mesmos +400 num 1200.
                    if (e.Bonus > melhor.ganho ||
                        (e.Bonus == melhor.ganho && m.st.AtkValue > _cards.Stats(melhor.alvo).AtkValue))
                        melhor = (o.index, o.code, e.Bonus, m.code);
                }
            }
            return melhor;
        }

        /// <summary>
        /// Prioridade de DESCARTE: o monstro de maior nível/ATK primeiro (será
        /// revivido); carta que não é monstro por último.
        ///
        /// **As exceções do labirinto.** A regra acima parte de "monstro grande
        /// no cemitério é monstro grande de volta pelo Monster Reborn", e é isso
        /// que a torna venenosa aqui:
        ///
        ///   • o **Gate Guardian** é Nv11 com 3750 de ATK — o maior de qualquer
        ///     mão, portanto SEMPRE o primeiro descartado. E ele não volta de
        ///     lugar nenhum: precisa ter sido corretamente Invocado Especialmente
        ///     antes, e no cemitério nunca esteve. Descartá-lo é rasgar a carta;
        ///   • as três **peças** são o único caminho até ele. Do cemitério até
        ///     voltam, mas cada uma que sai da mão adia o combo inteiro.
        ///
        /// Por isso os dois ficam ABAIXO de "não é monstro": entre jogar fora
        /// uma magia e jogar fora o rei do deck, vai a magia.
        /// </summary>
        int ValorDescarte(InteractiveDuel.Sel c)
        {
            if (c.code == GATE_GUARDIAN) return -3;
            if (PECAS_GATE_GUARDIAN.Contains(c.code)) return -2;
            var st = _cards.Stats(c.code);
            if (!st.IsMonster) return -1;
            return st.Level * 10000 + st.AtkValue;
        }

        /// <summary>
        /// Tenho em campo algum corpo que NÃO seja peça do Gate Guardian?
        ///
        /// É a pergunta que trava os atalhos que cobram um tributo (Tribute
        /// Doll, Metamorphosis, Monster Gate): quem escolhe o tributo é o
        /// <see cref="DecideSelect"/>, e se em campo só houver peça, o custo sai
        /// dela por falta de opção — desmontando justamente o que o deck passou
        /// o duelo inteiro montando.
        /// </summary>
        bool TemCorpoDispensavel(int me) =>
            _fieldOf(me).Any(c => _cards.Stats(c).IsMonster && !PECAS_GATE_GUARDIAN.Contains(c));

        /// <summary>Peça do Gate Guardian que ainda NÃO está em campo — a que
        /// completa o trio, e por isso vale mais que um Nv7 de ATK igual.</summary>
        bool PecaQueFalta(int me, uint code) =>
            PECAS_GATE_GUARDIAN.Contains(code) && !_fieldOf(me).Contains(code);

        /// <summary>
        /// **O que um corpo MEU vale onde ele está** — a mesma conta que já se
        /// fazia com os monstros do oponente (<see cref="ValorNaBatalha"/>): ATK
        /// de pé, DEF deitado, e sempre pelo número de AGORA (equipamento, magia
        /// de campo).
        ///
        /// O preço de um tributo era o ATK, e só. Um Labyrinth Wall de 0/3000
        /// setado aparecia então como o corpo mais barato do campo — quando ele
        /// é justamente a parede que está segurando o duelo. Num duelo real o
        /// NPC trocou esse muro (3200 de defesa com o equipamento) por um corpo
        /// de 2400, diante de um campo de 2600.
        /// </summary>
        int ValorDoMeuCorpo(int me, uint code, int seq)
        {
            foreach (var m in _todoFieldPosOf(me))
                if (m.seq == seq && m.code == code) return ValorNaBatalha(code, m.pos, me, seq);
            // Sem casar a zona (testes de decisão isolada, campo montado só com
            // códigos), cai no ATK impresso — o comportamento de antes.
            return ValorNaBatalha(code, POS_ATAQUE, me, seq);
        }

        /// <summary>
        /// Quanto vale o corpo que um atalho de 1 tributo tiraria de mim — o
        /// MENOR entre os dispensáveis, que é exatamente o que o
        /// <see cref="DecideSelect"/> vai sacrificar. As duas pontas têm de usar
        /// a mesma conta: uma regra que autoriza pensando num corpo e um
        /// `DecideSelect` que paga com outro decidem coisas diferentes.
        /// </summary>
        int ValorDoTributoQueSai(int me)
        {
            int menor = int.MaxValue;
            foreach (var m in AbertosDe(me))
            {
                if (PECAS_GATE_GUARDIAN.Contains(m.code)) continue;
                menor = Math.Min(menor, ValorNaBatalha(m.code, m.pos, me, m.seq));
            }
            return menor == int.MaxValue ? 0 : menor;
        }

        /// <summary>
        /// **O plano do Mausoléu**: quem sobe da mão, e por quantos LP.
        ///
        /// O efeito cobra 1000 LP por tributo que a invocação exigiria — 1000
        /// para um Nv5/6, 2000 para um Nv7+ —, e é o jogador quem escolhe qual
        /// dos dois caminhos usar (o `Duel.SelectEffect` do Lua). Então a
        /// escolha da CARTA e a da OPÇÃO são a mesma decisão, e ficam aqui: o
        /// <see cref="DecideOption"/> e o <see cref="DecideSelect"/> só
        /// executam o que este plano disse.
        ///
        /// A ordem de preferência é a do deck: uma peça que falta em campo vem
        /// antes de qualquer coisa (é o que constrói o Gate Guardian), depois o
        /// maior ATK. O Gate Guardian em si nunca entra — ele não tem invocação
        /// normal, e o Lua do Mausoléu (`IsSummonableCard`) não o ofereceria.
        ///
        /// Devolve alvo 0 quando não há nada que ele consiga pagar sem furar o
        /// piso de LP.
        /// </summary>
        (uint alvo, int custo, bool doisTributos) PlanoDoMausoleu(int me)
        {
            var candidatos = _handOf(me)
                .Where(c => c != GATE_GUARDIAN)
                .Select(c => (code: c, st: _cards.Stats(c)))
                .Where(x => x.st.IsMonster && x.st.Level >= 5)
                .Select(x => (x.code, custo: TributosPara(x.st.Level) * 1000, x.st))
                .Where(x => x.custo > 0 && _lpOf(me) - x.custo >= LP_PISO)
                .OrderByDescending(x => PecaQueFalta(me, x.code) ? 1 : 0)
                .ThenByDescending(x => x.st.AtkValue)
                .ToList();

            if (candidatos.Count == 0) return (0, 0, false);
            var melhor = candidatos[0];
            return (melhor.code, melhor.custo, melhor.custo >= 2000);
        }

        /// <summary>
        /// Escolha numa pergunta de OPÇÃO (MSG_SELECT_OPTION). O padrão do host
        /// é a primeira da lista, que é uma escolha determinística mas cega.
        ///
        /// O Mausoléu é o caso em que ela erra: as opções são "pago 1000 e
        /// invoco quem pede 1 tributo" e "pago 2000 e invoco quem pede 2", e a
        /// primeira é a de 1000 — o Labyrinth Wall de 0 de ATK na frente do
        /// Sanga de 2600. Cada opção vem identificada pelo id de texto do Lua
        /// (<c>aux.Stringid</c>), então dá para escolher pelo que ela SIGNIFICA.
        ///
        /// Devolve o índice na lista oferecida, ou 0 quando não reconhece nada —
        /// o comportamento de antes.
        /// </summary>
        public int DecideOption(InteractiveDuel.Question q, int me)
        {
            int i1 = q.options.IndexOf(MAUSOLEU_1_TRIBUTO);
            int i2 = q.options.IndexOf(MAUSOLEU_2_TRIBUTOS);
            if (i1 < 0 && i2 < 0) return 0;

            var plano = PlanoDoMausoleu(me);
            // O motor só oferece o caminho que ele consegue pagar: querendo o de
            // 2 tributos e ele não estar na lista, sobra o de 1.
            int escolha = plano.doisTributos && i2 >= 0 ? i2 : (i1 >= 0 ? i1 : i2);
            _log($"Mausoleu: escolhe pagar {(escolha == i2 ? 2000 : 1000)} LP " +
                 $"para invocar {plano.alvo}");
            return Math.Max(0, escolha);
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
                var a = Atacante(diretos, punidora != 0, 0, me);
                return new BattlePlay(true, a.index,
                    $"campo do oponente vazio — ataque direto com {a.code} " +
                    $"(ATK {AtkEmCampo(a.code, me, a.sequence)})" +
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

            var maisForte = q.attackers.OrderByDescending(x => AtkEmCampo(x.code, me, x.sequence)).First();
            if (doOponente.Count == 0)
                return new BattlePlay(true, maisForte.index,
                    $"campo do oponente sem monstro — ataca com {maisForte.code}");

            // Basta UM alvo que eu vença: o motor pergunta o alvo em seguida.
            var maisFraco = doOponente.OrderBy(m => m.valor).First();
            var escolhido = Atacante(q.attackers, punidora != 0, maisFraco.valor, me);
            int meuAtk = AtkEmCampo(escolhido.code, me, escolhido.sequence);

            if (meuAtk > maisFraco.valor)
                return new BattlePlay(true, escolhido.index,
                    $"ATK {meuAtk} supera o alvo mais fraco ({maisFraco.code} vale {maisFraco.valor}) " +
                    $"— ataca com {escolhido.code}" +
                    (punidora != 0 ? $" [o mais barato que ainda vence: ele tem {punidora} baixada]" : ""));

            return new BattlePlay(false, 0,
                $"meu melhor ATK ({AtkEmCampo(maisForte.code, me, maisForte.sequence)}) nao vence nem o alvo mais fraco " +
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
                            && AtkEmCampo(a.code, me, a.sequence) > ameaca)
                .OrderByDescending(a => AtkEmCampo(a.code, me, a.sequence))
                .FirstOrDefault();
            if (alvo.code == 0) return null;

            return new Play("reposition", alvo.index,
                $"levanta {alvo.code} (ATK {AtkEmCampo(alvo.code, me, alvo.sequence)}) para atacar — " +
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
                .Where(m => AtkEmCampo(m.code, me, m.seq) > alvoMaisFraco)
                .OrderBy(m => AtkEmCampo(m.code, me, m.seq))
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
                .OrderByDescending(a => AtkEmCampo(a.code, me, a.sequence))
                .FirstOrDefault();
            if (alvo.code == 0) return null;

            return new Play("reposition", alvo.index,
                $"formacao de isca: ele tem {varredora} baixada — deita {alvo.code} " +
                $"(ATK {AtkEmCampo(alvo.code, me, alvo.sequence)}) e ataca so' com " +
                (isca.code != 0 ? $"{isca.code}" : "ninguem, se nenhum vencer"));
        }

        /// <summary>
        /// Quem ataca: o de maior ATK, como sempre — ou, sabendo que existe uma
        /// armadilha que pune o atacante, o MAIS BARATO que ainda vence a batalha
        /// (`precisaSuperar`). Sem candidato barato o suficiente, volta ao de
        /// maior ATK, que é quem tem chance de resolver alguma coisa.
        /// </summary>
        InteractiveDuel.Act Atacante(List<InteractiveDuel.Act> candidatos, bool temPunidora,
                                     int precisaSuperar, int me)
        {
            if (temPunidora)
            {
                var barato = candidatos
                    .Where(a => AtkEmCampo(a.code, me, a.sequence) > precisaSuperar)
                    .OrderBy(a => AtkEmCampo(a.code, me, a.sequence))
                    .FirstOrDefault();
                if (barato.code != 0) return barato;
            }
            return candidatos.OrderByDescending(a => AtkEmCampo(a.code, me, a.sequence)).First();
        }

        /// <summary>
        /// **A parede só rende enquanto ela é parede.**
        ///
        /// O statline sozinho (DEF &gt; ATK ⇒ deita) é cego para o campo. Foi ele
        /// que mandou SETAR um Ryu-Ran (2200/2600) recém-invocado por tributo
        /// diante de um campo que ele atropelava inteiro: o NPC pagou dois corpos
        /// por uma parede e deixou de pé, do outro lado, exatamente os monstros
        /// que no turno seguinte viraram tributo/material de ritual de algo maior
        /// que ele. Este é o relato que originou esta função.
        ///
        /// A conta é uma troca, medida na mesma moeda dos dois lados:
        ///   • **ganho de bater** = o dano que passa (`ATK − valor do alvo`) mais
        ///     METADE do corpo que sai do campo dele. Metade, e não o valor
        ///     inteiro, porque o corpo não vira meu: o que eu levo é o campo dele
        ///     mais vazio (um tributo a menos). Com o campo dele vazio, o ganho é
        ///     o ataque direto inteiro.
        ///   • **perda de bater** = `DEF − ATK`, a defesa de que abro mão ao
        ///     ficar de pé.
        ///
        /// É esse peso que separa, sem `if` para nenhum caso, os dois que o
        /// jogador descreveu: o Aqua Madoor (1200/2000) NÃO abre uma parede de
        /// 2000 para tirar 100 de dano de um 1100, e o Ryu-Ran (2200/2600) bate
        /// num campo de 1800, porque aí o ganho é enorme perto dos 400 de defesa
        /// que ele deixaria na mesa.
        ///
        /// Antes de tudo isso vem a segurança: se algo com a face para cima do
        /// lado dele supera meu ATK, ficar de pé é entregar o corpo — nesse caso
        /// a parede ganha sempre.
        /// </summary>
        (bool bate, string porque) BaterRendeMaisQueAParede(int atk, int def, int foe)
        {
            int ameaca = MaiorAtkEmCampo(foe);
            if (atk <= ameaca)
                return (false, $"ATK {atk} nao supera a maior ameaca aberta ({ameaca}) — de pe eu seria atropelado");

            var dele = MonstrosDele(foe);
            var alvo = dele
                .Where(m => m.valor < atk)
                .OrderByDescending(m => m.valor)
                .FirstOrDefault();
            if (dele.Count > 0 && alvo.code == 0)
                return (false, $"nao derrubo nenhum dos {dele.Count} corpos dele — de pe eu nao resolvo nada");

            int ganho = (atk - alvo.valor) + alvo.valor / 2;
            int perda = def - atk;

            if (ganho >= perda)
                return (true, dele.Count == 0
                    ? $"campo dele vazio: ATK {atk} passa direto (ganho {ganho} >= os {perda} de defesa que eu abro mao)"
                    : $"derrubo {alvo.code} (vale {alvo.valor}) e ainda passo {atk - alvo.valor} de dano — " +
                      $"ganho {ganho} >= os {perda} de defesa de que abro mao");

            // LEITURA: a parede não segura o que ele já pode montar. Quando o
            // corpo grande dele está a um tributo de distância, deitar não adia
            // nada — e cada monstro que eu derrubo agora é material que ele
            // deixa de ter. Foi a segunda metade do relato: o NPC deitou e
            // deixou dois corpos de pé que viraram o tributo do turno seguinte.
            uint quebra = MaterialQueQuebraAParede(foe, def);
            if (quebra != 0 && alvo.code != 0)
                return (true, $"a parede nao segura o que ele monta ({quebra} na mao dele, com material em campo) — " +
                              $"derrubo {alvo.code} agora, que e' um tributo a menos");

            return (false, $"ganho {ganho} < os {perda} de defesa de que eu abriria mao — rende mais de parede");
        }

        /// <summary>
        /// **O que ele já pode montar contra a minha parede.** Só existe com
        /// leitura de mão — sem ela `_handOf(foe)` vem vazio e a regra some
        /// sozinha, que é o comportamento certo do NPC iniciante.
        ///
        /// Uma parede só compra tempo enquanto ninguém a quebra: se o oponente
        /// tem na mão um corpo com ATK maior que a minha DEF e já tem em campo
        /// os tributos para invocá-lo, deitar não adia nada.
        ///
        /// Ritual entra pela mesma porta, com a folga que ele tem de verdade: os
        /// tributos de um ritual somam NÍVEL (e podem sair da própria mão), então
        /// basta ele ter a magia de ritual na mão e algum corpo em campo para a
        /// ameaça ser real. Devolve a carta (ou 0).
        /// </summary>
        uint MaterialQueQuebraAParede(int foe, int minhaDef)
        {
            int corpos = _todoFieldPosOf(foe).Count(m => _cards.Stats(m.code).IsMonster);
            if (corpos == 0) return 0;    // sem material em campo, nada sobe por tributo

            bool temMagiaDeRitual = _handOf(foe).Any(EhRitual);
            foreach (uint c in _handOf(foe))
            {
                var st = _cards.Stats(c);
                if (!st.IsMonster || st.AtkValue <= minhaDef) continue;
                if ((st.Type & TYPE_RITUAL) != 0)
                {
                    if (temMagiaDeRitual) return c;
                    continue;
                }
                if (TributosPara(st.Level) <= corpos) return c;
            }
            return 0;
        }

        /// <summary>
        /// O coração da decisão, em três etapas — nesta ordem:
        ///
        ///   1. **Statline da própria carta.** Só entra em ataque quem tem
        ///      ATK &gt; DEF. Um 1200/2000 é uma parede: mesmo podendo vencer o
        ///      que está em campo, rende mais setado do que atacando.
        ///   1.5 **O campo à vista pode desmentir o statline** — a conta de
        ///      <see cref="BaterRendeMaisQueAParede"/>. É o que impede o NPC de
        ///      setar um corpo que atropela o campo inteiro do outro lado.
        ///   2. **Situação do campo.** Se a ameaça do oponente supera o melhor
        ///      atacante disponível, seta o de maior DEF em vez de entregar o
        ///      monstro.
        ///
        /// Devolve null quando não há monstro nenhum nesta faixa de nível.
        /// </summary>
        Play? Escolher(List<Cand> invocaveis, List<Cand> setaveis, int ameaca, string tag, int me)
        {
            int foe = 1 - me;

            // etapa 1: só é atacante quem tem o statline para isso
            var atacante = invocaveis
                .Where(c => c.Ofensivo)
                .OrderByDescending(c => c.St.AtkValue)
                .FirstOrDefault();
            string porqueAtaca = atacante.Ok
                ? $"ATK {atacante.St.AtkValue} > DEF {atacante.St.DefValue}, vale atacar"
                : null;

            // etapa 1.5: a maior parede da mão pode render mais de pé. Só entra
            // na disputa se o ATK dela superar o do atacante por statline —
            // abaixo disso não há nada a ganhar abrindo a defesa dela.
            var parede = invocaveis
                .Where(c => !c.Ofensivo)
                .OrderByDescending(c => c.St.AtkValue)
                .FirstOrDefault();
            if (parede.Ok && parede.St.AtkValue > (atacante.Ok ? atacante.St.AtkValue : -1))
            {
                var (bate, porque) = BaterRendeMaisQueAParede(
                    parede.St.AtkValue, parede.St.DefValue, foe);
                _log($"{parede.Act.code} ({parede.St.AtkValue}/{parede.St.DefValue}): " +
                     (bate ? "ATAQUE" : "parede") + $" — {porque}");
                if (bate)
                {
                    atacante = parede;
                    porqueAtaca = porque;
                }
            }

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
                    porqueAtaca +
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
        /// Usa o MESMO critério da invocação normal: statline primeiro (ATK &gt;
        /// DEF vai para ataque) e, quando ele diz "parede", a mesma conta de
        /// campo da <see cref="BaterRendeMaisQueAParede"/> — senão o Ryu-Ran
        /// (2200/2600) que chega pelas Regras Antigas nasce DEITADO diante de um
        /// campo que ele atropela inteiro, que é o mesmo furo da invocação
        /// normal entrando pela porta da Invocação Especial.
        ///
        /// `mask` é o que o motor aceita (0x1 ataque, 0x4 defesa com a face para
        /// cima). Se a defesa não estiver na máscara, não há escolha a fazer.
        /// `me` é quem está invocando — sem ele não há de que lado olhar o campo.
        /// </summary>
        public int DecidePosicao(uint code, byte mask, int me = 1)
        {
            const int FACEUP_DEFESA = 0x4;
            bool podeDefesa = (mask & FACEUP_DEFESA) != 0;
            bool podeAtaque = (mask & POS_ATAQUE) != 0;
            if (!podeDefesa) return POS_ATAQUE;
            if (!podeAtaque) return FACEUP_DEFESA;

            var st = _cards.Stats(code);
            if (st.AtkValue > st.DefValue)
            {
                _log($"posicao de {code} ({st.AtkValue}/{st.DefValue}): ataque (ATK > DEF)");
                return POS_ATAQUE;
            }

            var (bate, porque) = BaterRendeMaisQueAParede(st.AtkValue, st.DefValue, 1 - me);
            _log($"posicao de {code} ({st.AtkValue}/{st.DefValue}): " +
                 (bate ? "ataque" : "defesa") + $" — {porque}");
            return bate ? POS_ATAQUE : FACEUP_DEFESA;
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
        /// A próxima seleção vinda do DECK é a busca do Armory Call — escolher
        /// pelo critério genérico (maior ATK) daria empate em 0 entre todos os
        /// equipamentos e levaria o primeiro da lista. Mesmo padrão do
        /// `_proximoAlvoEquipFraco`: quem sabe é a regra, quem responde é a
        /// chamada seguinte. Consumido na primeira seleção de deck que chegar.
        /// </summary>
        bool _proximoEquipDoDeck;

        /// <summary>
        /// A magia/armadilha do oponente que a próxima remoção deve mirar —
        /// decidida por `AlvoDaRemocaoSt` e consumida pelo `DecideSelect`. Mesmo
        /// padrão do `_proximoAlvoEquipFraco`: a regra sabe o alvo certo, mas quem
        /// responde a seleção é a chamada seguinte.
        /// </summary>
        uint _proximoAlvoStPerigosa;

        /// <summary>
        /// A carta da MÃO que a jogada em curso vai pôr em campo — decidida pela
        /// regra que ativou a carta e consumida pelo `DecideSelect`.
        ///
        /// Vale para TODA carta que invoca da mão pedindo "escolha uma carta da
        /// mão": o efeito do Mausoléu e o Tribute Doll. Essa pergunta é
        /// idêntica à de um custo de DESCARTE, e quer o oposto dela — o descarte
        /// joga fora o maior, e desde a regra do Gate Guardian empurra as peças
        /// para o fim da fila. Sem esta marca, o Tribute Doll pagava um corpo
        /// para trazer justamente a pior carta da mão: foi o que aconteceu num
        /// duelo real, com o Garnecia (2400) entrando no lugar do Sanga (2600)
        /// que a própria regra tinha escolhido e anunciado no log.
        /// </summary>
        uint _alvoDaInvocacaoDaMao;

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

        /// <summary>Marca que já se ativou uma carta nesta cadeia. Existe para o
        /// teste poder montar o estado que o duelo produz sozinho — a exceção do
        /// "corpo de graça" só tem sentido com a trava JÁ armada.</summary>
        public void MarcaJaEncadeou() => _jaEncadeou = true;

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
            // A EXCEÇÃO DO CORPO DE GRAÇA. Uma carta que se Invoca Especialmente
            // em resposta não é "segunda carta gasta na mesma cadeia": ela é
            // vantagem que aparece e some. O Magician of Dark Illusion só pode
            // sair da mão QUANDO O PRÓPRIO NPC ativa uma magia/armadilha no turno
            // do oponente (`Duel.IsTurnPlayer(1-tp) and rp==tp`) — ou seja, ele
            // chega SEMPRE na mesma cadeia da carta que abriu a janela, e a regra
            // de baixo o matava toda vez. Foi o que se viu em duelo: 2100 de ATK
            // parados na mão a partida inteira.
            var corpoDeGraca = q.choices.FirstOrDefault(
                c => !CONTRA.ContainsKey(c.code) && Perfil(c.code).InvocaEspecial);
            if (corpoDeGraca.code != 0 && QtdMonstros(me) <= QtdMonstros(foe))
            {
                _jaEncadeou = true;
                PorqueDaCadeia = $"corrente: {corpoDeGraca.code} poe corpo em campo de graca";
                _log($"chain: {PorqueDaCadeia}");
                return corpoDeGraca.index;
            }

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
            // o monstro grande costuma ser o que a coroa levaria embora. Pelo ATK
            // de AGORA — um 1200 com dois equipamentos em cima é um corpo grande,
            // e é justamente o que não se quer perder numa moeda.
            int meuMaiorCorpo = AbertosDe(me)
                .Select(m => AtkEmCampo(m.code, me, m.seq))
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

            // Pelo valor de AGORA e na POSIÇÃO de agora: tributar o monstro que
            // está segurando o equipamento custa o valor COM o bônus, e tributar
            // uma parede deitada custa a DEF dela — não os 0 de ATK que um muro
            // tem impressos. Mesma conta do `DecideSelect`, que é quem escolhe.
            var sacrificados = AbertosDe(me)
                .Select(m => ValorNaBatalha(m.code, m.pos, me, m.seq))
                .OrderBy(v => v)                           // os mais baratos vão primeiro
                .Take(n)
                .ToList();

            if (sacrificados.Count == 0) return true;      // nada visível a perder

            int maiorPerdido = sacrificados.Max();
            int ganho = setando ? entra.DefValue : entra.AtkValue;
            return ganho > maiorPerdido;
        }

        /// <summary>
        /// Maior ATK entre os monstros ABERTOS do jogador indicado — pelo valor
        /// de AGORA, não pelo impresso na carta (ver <see cref="EmCampo"/>).
        ///
        /// É a "ameaça" que decide meia dúzia de regras da Main Phase (invocar ou
        /// setar, arriscar a moeda, gastar remoção). Lendo o statline impresso, o
        /// NPC invocava um 1700 de peito aberto contra um 1500 do jogador que na
        /// verdade estava com +700 de equipamento em campo.
        ///
        /// Continua contando só quem está com a FACE PARA CIMA: monstro deitado
        /// não ataca ninguém, e contá-lo como ameaça deixaria o NPC medroso à
        /// toa. Quem mede o risco de ATACAR é a `MonstrosDele`, que inclui os
        /// virados.
        /// </summary>
        int MaiorAtkEmCampo(int player)
        {
            int max = -1;
            foreach (var m in AbertosDe(player))
            {
                int atk = AtkEmCampo(m.code, player, m.seq);
                if (atk > max) max = atk;
            }
            return max;
        }
    }
}

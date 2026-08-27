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

        // Pacote do Mako (Água). O TEMPLO é uma Armadilha Contínua cujo nome vira
        // "Umi" (é assim que ela liga o Legendary Fisherman) e que, uma vez por
        // turno, BANE um Fish/Sea Serpent/Aqua de Nível ≤4 do PRÓPRIO dono,
        // devolvendo-o na End Phase de um turno DELE (`Duel.IsTurnPlayer(tp)` na
        // condição do Lua).
        //
        // Ela é a razão de este pacote existir. O banco marca o Templo com o bit
        // 0x100000 (INVOCAÇÃO ESPECIAL) por causa DESSE RETORNO — e o cérebro lia
        // isso como "esta carta põe corpo em campo". É o contrário: ativar TIRA
        // um corpo do campo. Como o efeito é `EVENT_FREE_CHAIN`, o motor abre a
        // janela dela em toda oportunidade de corrente, e o NPC banía o próprio
        // monstro turno após turno, de graça. Ver `MotivoDoTemplo`.
        const uint FORGOTTEN_TEMPLE = 43889633;  // Templo Esquecido das Profundezas
        const uint INSTANT_FUSION = 1845204;     // paga 1000 LP → Fusão Nv≤5, morre na End Phase
        const uint READY_FUSION = 63854005;      // paga 1000 LP → Fusão Nv≤6 sem efeito, idem
        const uint TORRENTIAL_REBORN = 7092142;  // WATER destruído volta — e queima 500 por cabeça
        const uint PREMATURE_BURIAL = 70828912;  // paga 800 LP → reanima e equipa

        /// <summary>
        /// **O que conta como "Umi" em campo.** Meia dúzia de cartas ligam as
        /// condições "enquanto 'Umi' estiver em campo" sem se chamarem Umi: umas
        /// trocam o próprio NOME (`EFFECT_CHANGE_CODE` → `CARD_UMI`), outras fazem
        /// o CAMPO ser tratado como Umi. Quem olha só o id 22702055 conclui que
        /// não há Umi nenhuma e desliga metade do deck do Mako.
        ///
        /// Levantadas do banco pelo texto ("name becomes"/"treated as" + "Umi"),
        /// não de memória.
        /// </summary>
        const uint UMI = 22702055;
        static readonly HashSet<uint> CONTAM_COMO_UMI = new()
        {
            UMI,
            295517,           // A Legendary Ocean
            2819435,          // Pacifis, the Phantasm City
            26534688,         // Magellanica, the Deep Sea City
            34103656,         // Lemuria, the Forgotten City
            58203736,         // Sea Stealth II       (Magia Contínua)
            FORGOTTEN_TEMPLE, // Forgotten Temple…    (Armadilha Contínua)
        };

        /// <summary>
        /// Monstro que faz o campo virar "Umi" só ENQUANTO não houver magia de
        /// campo aberta (Maiden of the Aqua). Fica à parte porque a condição dela
        /// é o contrário das outras: qualquer magia de campo com a face para cima
        /// — inclusive uma do oponente que não tem nada a ver com água — desliga.
        /// </summary>
        const uint MAIDEN_OF_THE_AQUA = 17214465;

        // NÃO EXISTE AQUI uma tabela de "não pode ser alvo de ataque com a Umi".
        // Ela chegou a existir e foi removida no mesmo dia, porque não mudava
        // decisão nenhuma: a única carta do banco com essa proteção é o
        // The Legendary Fisherman (1850/1600), e `DecidePosicao` devolve ATAQUE
        // para todo statline com ATK > DEF antes de a regra da parede ser
        // consultada. Quem tem a proteção nunca vira parede de qualquer jeito.
        //
        // Ficou registrado para a próxima pessoa não reescrever a mesma coisa: o
        // dia em que entrar uma carta com essa proteção E DEF maior que o ATK, a
        // regra passa a valer e o lugar dela é a primeira trava de
        // `BaterRendeMaisQueAParede`.

        /// <summary>
        /// Enquanto "Umi" estiver em campo, estes são IMUNES A MAGIA. Muda uma
        /// decisão concreta e só uma: não vale gastar o Templo banindo um monstro
        /// para escapar de uma MAGIA que não o alcança.
        ///
        /// (O Legendary Fisherman II ganha imunidade a efeito de MONSTRO, que é
        /// outra coisa, e por isso não está aqui.)
        /// </summary>
        static readonly HashSet<uint> IMUNES_A_MAGIA_COM_UMI = new()
        {
            3643300,          // The Legendary Fisherman
            24128274,         // Deepsea Warrior
            90337190,         // Torpedo Fish
            95614612,         // Cannonball Spear Shellfish
        };

        /// <summary>
        /// **Existe "Umi" em campo?** Vale para os DOIS lados — as cartas da
        /// tabela mudam o campo inteiro, não um lado dele.
        ///
        /// LIMITE CONHECIDO: uma magia de campo INJETADA pelo tabuleiro (o Bônus
        /// de Campo de `boards/*.json`) é posta no motor antes do `OCG_StartDuel`
        /// e não gera `MSG_MOVE`, então não está no `_stBoard` e não é vista aqui.
        /// Uma Umi ATIVADA da mão, essa sim, é vista. Coberto pelo `--test-mako`.
        /// </summary>
        bool UmiNoCampo()
        {
            for (int p = 0; p <= 1; p++)
            {
                foreach (var c in _faceUpStOf(p)) if (CONTAM_COMO_UMI.Contains(c)) return true;
                foreach (var c in _fieldOf(p)) if (CONTAM_COMO_UMI.Contains(c)) return true;
            }

            // A Maiden só faz o campo virar Umi ENQUANTO não houver magia de campo
            // aberta — e serve qualquer uma, inclusive uma do oponente que não tem
            // nada a ver com água. Por isso ela é testada depois e sob condição.
            bool temCampoAberto = false;
            for (int p = 0; p <= 1 && !temCampoAberto; p++)
                foreach (var c in _faceUpStOf(p))
                    if ((_cards.Stats(c).Type & TYPE_FIELD) != 0) { temCampoAberto = true; break; }

            if (!temCampoAberto)
                for (int p = 0; p <= 1; p++)
                    if (_fieldOf(p).Contains(MAIDEN_OF_THE_AQUA)) return true;

            return false;
        }

        /// <summary>Magia nenhuma o alcança agora.</summary>
        bool ImuneAMagia(uint code) => IMUNES_A_MAGIA_COM_UMI.Contains(code) && UmiNoCampo();

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
            FORGOTTEN_TEMPLE,
        };

        const byte DECK = 0x1, HAND = 0x2, MZONE = 0x4, SZONE = 0x8, GRAVE = 0x10;
        const uint TYPE_SPELL = 0x2, TYPE_TRAP = 0x4, TYPE_FUSION = 0x40, TYPE_RITUAL = 0x80,
                   TYPE_FIELD = 0x80000;

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
        readonly record struct Equipamento(int Bonus, uint Raca, uint Atributo)
        {
            /// <summary>
            /// Quanto a carta muda a DEF de quem recebe — e isso não é enfeite.
            ///
            /// O ciclo por ATRIBUTO cobra 200 de DEF pelos +400 de ATK. Num
            /// monstro DEITADO isso é o reforço ao contrário: a batalha ali usa a
            /// DEF, então equipar TIRA 200 e não dá nada em troca. O ciclo por
            /// TIPO dá +300 nos dois, e nesse vale a pena mesmo deitado.
            ///
            /// Só o `Bonus` (ATK) era lido, e ninguém perguntava em que posição
            /// estava o alvo. Relatado num duelo real: o Wevil Invocou
            /// Especialmente um inseto em DEFESA e equipou nele — o ATK ficou
            /// maior que o do monstro do jogador (número que aquela batalha nem
            /// ia usar) e a DEF ficou abaixo do ATK do jogador, que foi o número
            /// que decidiu a batalha seguinte.
            /// </summary>
            public int BonusDef { get; init; }
        }

        const uint R_WARRIOR = 0x1, R_SPELLCASTER = 0x2, R_FAIRY = 0x4, R_FIEND = 0x8,
                   R_ZOMBIE = 0x10, R_MACHINE = 0x20, R_AQUA = 0x40, R_WINGEDBEAST = 0x200,
                   R_PLANT = 0x400, R_INSECT = 0x800, R_THUNDER = 0x1000, R_DRAGON = 0x2000,
                   R_BEAST = 0x4000, R_BEASTWARRIOR = 0x8000, R_DINOSAUR = 0x10000,
                   R_FISH = 0x20000, R_SEASERPENT = 0x40000;
        const uint A_EARTH = 0x1, A_WATER = 0x2, A_FIRE = 0x4, A_WIND = 0x8,
                   A_LIGHT = 0x10, A_DARK = 0x20;

        static readonly Dictionary<uint, Equipamento> EQUIPAMENTOS = new()
        {
            // +300 ATK/DEF por TIPO — o ciclo clássico, um por raça.
            [1435851]  = new(300, R_DRAGON, 0) { BonusDef = 300 },        // Dragon Treasure
            [91595718] = new(300, R_SPELLCASTER, 0) { BonusDef = 300 },   // Book of Secret Arts
            [61854111] = new(300, R_WARRIOR, 0) { BonusDef = 300 },       // Legendary Sword
            [46009906] = new(300, R_BEAST, 0) { BonusDef = 300 },         // Beast Fangs
            [25769732] = new(300, R_MACHINE, 0) { BonusDef = 300 },       // Machine Conversion Factory
            [77007920] = new(300, R_INSECT, 0) { BonusDef = 300 },        // Laser Cannon Armor
            [77027445] = new(300, R_AQUA, 0) { BonusDef = 300 },          // Power of Kaishin
            [51267887] = new(300, R_DINOSAUR, 0) { BonusDef = 300 },      // Raise Body Heat
            [39774685] = new(300, R_PLANT, 0) { BonusDef = 300 },         // Vile Germs
            [15052462] = new(300, R_ZOMBIE, 0) { BonusDef = 300 },        // Violet Crystal
            [1557499]  = new(300, R_FAIRY, 0) { BonusDef = 300 },         // Silver Bow and Arrow
            [4614116]  = new(300, R_FIEND, 0) { BonusDef = 300 },         // Dark Energy
            [37820550] = new(300, R_THUNDER, 0) { BonusDef = 300 },       // Electro-Whip
            [98252586] = new(300, R_WINGEDBEAST, 0) { BonusDef = 300 },   // Follow Wind
            [36607978] = new(300, R_BEASTWARRIOR, 0) { BonusDef = 300 },  // Mystical Moon

            // +400 ATK / −200 DEF por ATRIBUTO. Valem mais em ATK que os de tipo,
            // e o NPC ataca — por isso ganham deles no desempate.
            [37120512] = new(400, 0, A_DARK) { BonusDef = -200 },          // Sword of Dark Destruction
            [2370081]  = new(400, 0, A_WATER) { BonusDef = -200 },         // Steel Shell
            [18937875] = new(400, 0, A_FIRE) { BonusDef = -200 },          // Burning Spear
            [39897277] = new(400, 0, A_LIGHT) { BonusDef = -200 },         // Elf's Light
            [55321970] = new(400, 0, A_WIND) { BonusDef = -200 },          // Gust Fan
            [98374133] = new(400, 0, A_EARTH) { BonusDef = -200 },         // Invigoration

            // Os grandes.
            [32268901] = new(700, 0, A_FIRE),          // Salamandra
            [3492538]  = new(700, R_INSECT, 0),        // Insect Armor with Laser Cannon
            [83225447] = new(700, 0, 0),               // Stim-Pack — perde 200 por Standby sua
            [98495314] = new(500, 0, 0) { BonusDef = 500 },               // Sword of Deep-Seated

            // Harpias (deck da Mai). Cyber Shield exige "Harpie Lady" pelo NOME,
            // e nome não se lê do `cards.cdb` — a raça abaixo é só o filtro
            // GROSSO que evita oferecer a carta a um monstro sem chance nenhuma.
            // Quem recusa de verdade é o Lua: o motor só põe o equipamento em
            // `activatable` quando existe alvo legal, e o select só oferece
            // esses. Errar aqui para MAIS custa uma passada do cérebro; errar
            // para menos deixaria a carta morta na mão.
            [63224564] = new(500, R_WINGEDBEAST, 0),   // Cyber Shield (+500 numa "Harpie Lady")

            // Reforço nenhum: existem para atrapalhar o monstro do OUTRO, e
            // Premature Burial é um revive disfarçado de equipamento.
            [20436034] = new(0, 0, 0),                 // Ring of Magnetism
            [50152549] = new(0, 0, 0),                 // Paralyzing Potion
            [24668830] = new(0, 0, 0),                 // Germ Infection
            [70828912] = new(0, 0, 0),                 // Premature Burial
        };

        // A tabela `CAMPOS` saiu daqui em 23/08/2026. Ela dizia quem cada Magia
        // de Campo reforca e quanto, escrita a mao, e tinha TRES entradas — das
        // seis magias de campo basicas da Lista 1 o NPC usava duas, e Forest,
        // Yami, Sogen e Wasteland ficavam mortas na mao para sempre.
        //
        // Quem responde agora e' o Lua da propria carta (`BonusDeCampo`), como ja'
        // acontece com compra, busca, destruicao e trava. Manter as duas fontes
        // seria o erro que este projeto ja' pagou uma vez (`chancesDe` x
        // `chancesDoPacote`): elas se desencontram no primeiro campo novo.



        readonly DatabaseManager _cards;
        readonly Func<int, IReadOnlyList<uint>> _fieldOf;   // monstros face-up em campo
        readonly Func<int, IReadOnlyList<uint>> _handOf;    // cartas na mão de um jogador
        /// <summary>
        /// **A DECKLIST do próprio NPC** — o que o deck dele contém.
        ///
        /// Não é leitura escondida e por isso não passa pelo `npcLeitura`: todo
        /// jogador conhece o próprio deck, e é com isso que se decide adiantar um
        /// Foolish Burial ("o meu deck tem três Monster Reborn"). Do lado do
        /// JOGADOR vem vazia sempre — a decklist do outro é a única coisa aqui
        /// que nem o NPC avançado pode ver.
        ///
        /// É a lista de CONSTRUÇÃO, não o que sobrou dentro do deck; ver o limite
        /// conhecido na regra 5.56. Sem quem informe vem vazia, e aí nenhuma
        /// regra que dependa dela dispara — o comportamento de antes.
        /// </summary>
        readonly Func<int, IReadOnlyList<uint>> _listaDoDeck;
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

        /// <summary>
        /// Esta zona tem um corpo CONDENADO — Instant/Ready Fusion: nao pode
        /// atacar e morre na End Phase deste turno.
        ///
        /// Sem quem informe, ninguem e' condenado: e' o comportamento de antes, e
        /// e' o certo para os testes de decisao isolada, que montam o campo com
        /// codigos e nao tem zona de verdade.
        /// </summary>
        readonly Func<int, int, bool> _corpoCondenado;
        readonly Action<string> _log;

        const int POS_ATAQUE = 0x1, POS_DEFESA = 0x4, POS_DEFESA_VIRADA = 0x8;

        /// <summary>
        /// Os DOIS bits de "carta com a face para baixo" (0x2 virada em ataque,
        /// 0x8 virada em defesa). Testar so' o 0x8 deixaria de fora a virada em
        /// ataque, que existe — e' o que a Invocacao-Virar desfaz.
        /// </summary>
        const int POS_VIRADA = 0x2 | 0x8;

        /// <summary>Bit de EQUIPAMENTO no `type` do `cards.cdb` (o mesmo do ocgcore).</summary>
        const uint TYPE_EQUIP = 0x40000;

        /// <summary>Bit de MAGIA DE CAMPO no `type` do `cards.cdb`.</summary>
        const uint TYPE_CAMPO = 0x80000;

        /// <summary>
        /// A ultima mao ja' registrada. `Decide` roda VARIAS vezes na mesma Main
        /// Phase (a cada jogada ele e' perguntado de novo), e repetir a mesma
        /// linha a cada volta afogaria justamente as linhas de decisao que ela
        /// existe para explicar.
        /// </summary>
        string _maoJaLogada = "";

        /// <summary>
        /// Escreve a mao do NPC no log — codigos, com o statline de quem e'
        /// monstro, porque o motor nao conhece o nome das cartas (o nome mora no
        /// `ygo-data`, que e' do front). "62121 M4 920/1930" ja' diz o suficiente
        /// para reconhecer a carta ao lado das outras linhas `[npc]`.
        /// </summary>
        void LogarMao(int me)
        {
            var mao = _handOf(me);
            if (mao.Count == 0)
            {
                // Mao vazia e' informacao, nao ausencia dela: e' a resposta
                // completa para "por que ele nao jogou nada".
                if (_maoJaLogada != "-") { _maoJaLogada = "-"; _log("mao: vazia"); }
                return;
            }

            var partes = mao.Select(c =>
            {
                var st = _cards.Stats(c);
                return st.IsMonster ? $"{c} Nv{st.Level} {st.AtkValue}/{st.DefValue}"
                     : $"{c} [{(st.IsTrap ? "armadilha" : st.IsSpell ? "magia" : "?")}]";
            }).ToList();

            string linha = $"mao ({mao.Count}): " + string.Join(" | ", partes);
            if (linha == _maoJaLogada) return;
            _maoJaLogada = linha;
            _log(linha);
        }

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
                        Func<int, int, (int atk, int def)?> statsEmCampoOf = null,
                        Func<int, int, bool> corpoCondenadoOf = null,
                        Func<int, IReadOnlyList<uint>> listaDoDeckOf = null)
        {
            _cards = cards;
            _corpoCondenado = corpoCondenadoOf ?? ((_, _) => false);
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
            // Sem quem informe, o NPC não conhece o próprio deck e a regra que
            // ADIANTA o enterro simplesmente não dispara — é o comportamento
            // anterior, e é o que os testes de decisão isolada montam.
            _listaDoDeck = listaDoDeckOf ?? (_ => Array.Empty<uint>());
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
        /// O statline IMPRESSO no número que a batalha usa naquela posição — o
        /// par do <see cref="ValorNaBatalha"/> sem nenhum efeito por cima.
        /// Comparar os dois é como se descobre que um corpo está reforçado
        /// (equipamento, magia de campo) sem precisar rastrear a carta.
        /// </summary>
        int ValorImpressoNaPosicao(uint code, int pos)
        {
            var st = _cards.Stats(code);
            return (pos & (POS_DEFESA | POS_DEFESA_VIRADA)) != 0 ? st.DefValue : st.AtkValue;
        }

        /// <summary>
        /// **Quanto vale enfrentar a carta que o motor está OFERECENDO** — a
        /// mesma conta do <see cref="ValorNaBatalha"/>, achando a posição e o
        /// código reais pela zona.
        ///
        /// O `SELECT_CARD` não traz a posição, e a carta virada do outro lado
        /// chega com o código zerado (o host oculta o que o NPC não deveria
        /// ver). Quem sabe é o campo: com leitura, `_todoFieldPosOf` devolve o
        /// código e a posição verdadeiros; sem ela, a carta virada do oponente
        /// nem aparece ali e vale 0 — fica por último, que é exatamente o que um
        /// humano faria com uma carta que ele não conhece.
        /// </summary>
        int AmeacaDoAlvo(InteractiveDuel.Sel c)
        {
            foreach (var m in _todoFieldPosOf(c.controller))
                if (m.seq == c.sequence)
                    return ValorNaBatalha(m.code, m.pos, c.controller, m.seq);
            return c.code != 0 ? _cards.Stats(c.code).AtkValue : 0;
        }

        /// <summary>
        /// O corpo MEU que sairia num custo de tributo — o mais barato pela conta
        /// da batalha, que é exatamente quem o <see cref="DecideSelect"/> vai
        /// escolher. As duas pontas têm de medir igual: uma regra que autoriza
        /// pensando num corpo e uma seleção que paga com outro decidem coisas
        /// diferentes.
        /// </summary>
        (uint code, int pos, int seq, int valor) CorpoMaisBarato(int me)
        {
            (uint code, int pos, int seq, int valor) menor = (0, 0, -1, int.MaxValue);
            foreach (var m in AbertosDe(me))
            {
                // Pelo `ValorDoMeuCorpo`, e nao pelo `ValorNaBatalha` cru: e' ele
                // que sabe que um corpo CONDENADO custa zero. Medir aqui de um
                // jeito e no `DecideSelect` de outro faz a regra autorizar
                // pensando num corpo e a selecao pagar com outro.
                int v = ValorDoMeuCorpo(me, m.code, m.seq);
                if (v < menor.valor) menor = (m.code, m.pos, m.seq, v);
            }
            return menor.code == 0 ? (0, 0, -1, 0) : menor;
        }

        /// <summary>
        /// Os monstros de um jogador que estão com a FACE PARA CIMA, com a
        /// sequência da zona — que é o que permite perguntar o ATK atual deles ao
        /// motor. Mesmo conjunto que o `_fieldOf` de sempre devolve; a diferença
        /// é só carregar a zona junto.
        /// </summary>
        /// <summary>Os meus corpos CONDENADOS (Instant/Ready Fusion), com a zona.</summary>
        List<(uint code, int pos, int seq)> ZonasCondenadas(int player) =>
            _todoFieldPosOf(player).Where(m => _corpoCondenado(player, m.seq)).ToList();

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

            // Main Phase: nao ha' ataque pendente. A marca do atacante e' de UMA
            // pergunta so' (a escolha de alvo que vem logo depois da declaracao);
            // sobrando, ela faria uma remocao de Main Phase mirar o alvo "que eu
            // venco" em vez do maior — e uma remocao quer justamente o maior.
            _atacanteAtk = -1;

            // O que ele TEM na mao, antes de decidir o que fazer com isso.
            //
            // Toda linha `[npc] ...` deste arquivo diz o QUE ele decidiu e POR
            // QUE; nenhuma dizia com o que ele estava decidindo. Sem isso, ler o
            // log de um turno em que o NPC "nao fez nada" nao distingue as duas
            // explicacoes possiveis — a mao nao tinha jogada, ou tinha e a regra
            // nao a viu —, que e' justamente a pergunta de quem desconfia do
            // cerebro. Reconstruir a mao de fora tambem nao da': ela nunca chega
            // ao front (o `Projetar` manda `code: 0`), e replicar o embaralhamento
            // pelo seed exigiria os dois decks na ordem exata em que foram
            // enviados, que o log tambem nao guarda.
            LogarMao(me);

            // Alvo do Mausoléu que não foi consumido: a ativação foi negada, ou
            // o motor nunca chegou a perguntar quem sobe. Chegar aqui significa
            // que a jogada acabou — deixar a marca de pé faria a PRÓXIMA escolha
            // da mão (um custo de descarte, por exemplo) jogar fora justamente a
            // carta que ele ia invocar.
            _alvoDaInvocacaoDaMao = 0;

            // Pelo mesmo motivo, e para o mesmo tipo de estrago: uma marca de
            // enterro que sobrou (a ativação foi negada por uma corrente, ou o
            // motor nunca chegou a perguntar) faria a PRÓXIMA seleção escolher
            // pelo critério do enterro — "o maior que VOLTA do cemitério" — onde
            // o que se pedia era um alvo ou um custo.
            _proximoEnterroDoDeck = false;
            _enterroPara = PrecisoDe.Corpo;
            _remocaoDeCampo = false;

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

                // O PRECO PODE SER UM CORPO EM JOGO. A Dark Factory of More
                // Production cobra "1 monstro da MAO OU DO CAMPO", e o `Descarta`
                // acima diz so' metade da verdade. Sem monstro na mao para pagar,
                // o custo sai do campo — e ai comprar 1 carta custa o corpo que
                // esta' segurando o turno. O relato foi exatamente esse: *"tirando
                // o unico monstro que controla pra comprar 1 card"*.
                //
                // A trava e' so' para quem TEM campo a perder: com o campo vazio a
                // carta continua sendo a jogada certa (nao ha' corpo para gastar,
                // e o custo sairia da mao de qualquer jeito).
                // Conta os monstros com `_todoFieldPosOf`, e nao com
                // `QtdMonstros`: este ultimo le' `_fieldOf`, que so' devolve o que
                // esta' com a FACE PARA CIMA. E' justamente o corpo SETADO que
                // corre perigo aqui — para o resto do cerebro ele nem existe
                // (`semJogada` acima da' verdadeiro com o campo "vazio"), a carta
                // e' ativada, e o custo leva embora a unica parede da mesa. Num
                // deck que seta o tempo todo, como o do Panik, esse e' o caso
                // COMUM, nao o raro.
                int corposMeus = _todoFieldPosOf(me).Count(m => _cards.Stats(m.code).IsMonster);
                if (Perfil(compraCara.code).CustoPodeVirDoCampo
                    && corposMeus >= 1
                    && !_handOf(me).Any(c => _cards.Stats(c).IsMonster))
                {
                    _log($"guarda {compraCara.code}: sem monstro na mao, o custo sairia do CAMPO — " +
                         $"comprar 1 carta nao vale o(s) {corposMeus} corpo(s) que seguram o turno");
                }
                else if (semJogada)
                    return new Play("activate", compraCara.index,
                        $"compra com descarte ({compraCara.code}): sem monstro em campo nem " +
                        "invocacao na mao, parado eu nao faco nada mesmo");
                else if (gordoNaMao && podeReanimar)
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

            // 2.5 BAIXAR A MAGIA QUE VALE MAIS EM CAMPO DO QUE NA MÃO.
            //
            //     A Chaos Scepter Blast é o caso: sem um Mago Nv8+ em campo ela
            //     não pode ser ativada, e na mão uma carta parada é carta morta.
            //     Baixada, ela vira uma armadilha de verdade — destruída pelo
            //     oponente na zona de magia, ela traz do DECK um dos magos do
            //     Caos, de graça. É o próprio texto dela que diz isso
            //     (`SalvaSeDestruida`), e a diferença entre as duas situações é a
            //     ZONA: na mão, destruída, ela não faz nada.
            //
            //     Só quando ela NÃO está ativável agora — havendo o corpo, ativar
            //     e banir uma carta do campo dele vale mais que a espera. E com a
            //     mesma folga de zona da armadilha, pelo mesmo motivo: magia
            //     recicla o slot, e encher as cinco zonas trava o próprio jogo.
            var guardaChuva = q.settableST.FirstOrDefault(a =>
                !EhArmadilha(a.code)
                && _cards.SalvaSeDestruida(a.code)
                && !q.activatable.Any(x => x.code == a.code));
            if (guardaChuva.code != 0 && _stCountOf(me) <= 3)
                return new Play("setspell", guardaChuva.index,
                    $"baixa {guardaChuva.code}: parada na mao ela nao faz nada, e na zona de " +
                    "magia ela poe um corpo em campo se ele a destruir");

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
            //
            //    QUAL ritual, quando há mais de um: o que põe em campo o corpo que
            //    ACORDA uma carta parada na mão. Antes não havia critério nenhum —
            //    `AtivavelSe` devolve o primeiro da lista —, e foi assim que o
            //    relato aconteceu: com a Chaos Scepter Blast na mão (que exige um
            //    Mago Nv8+ e bane 1 carta do campo com a face para baixo), o NPC
            //    tinha o Magician of Black Chaos (Nv8 MAGO) e o Black Luster
            //    Soldier (Nv8 GUERREIRO) e escolheu o Guerreiro, de 3000 de ATK.
            //    Corpo maior, combo morto: em vez de tirar DUAS cartas do campo do
            //    jogador, tirou uma.
            var acordar = RitualQueAcorda(q, me);
            if (acordar.HasValue) return acordar.Value;

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

            // 5.3 Insect Armor with Laser Cannon — +700 ATK fixo, e só em Inseto.
            //
            //     "O alvo default do `DecideSelect` (maior ATK) já é o que se
            //     quer aqui" era falso do jeito mais caro possível: o Lua da
            //     carta (`AddEquipProcedure` com o jogador em `nil`) aceita
            //     equipar um Inseto do OUTRO lado, e o critério de maior ATK
            //     nunca perguntava de quem era o monstro. Num duelo de teste o
            //     NPC equipou quatro cópias no Petit Moth do JOGADOR e o levou
            //     de 300 a 3800 de ATK — sem erro nenhum, com o log dizendo
            //     "+700 ATK no melhor atacante" as quatro vezes.
            //
            //     Hoje quem escolhe é a mesma conta de todo equipamento
            //     (`MelhorEquipPor`): alvo MEU, com a face para cima, e medido
            //     na posição em que ele está.
            if (Ativavel(q, INSECT_ARMOR_LASER))
            {
                int idx = IdxAtivavel(q, INSECT_ARMOR_LASER);
                var armadura = MelhorEquipPor(new[] { (idx, INSECT_ARMOR_LASER) }, me);
                if (armadura.index >= 0)
                {
                    _proximoAlvoDoEquip = armadura.zona;
                    return new Play("activate", armadura.index,
                        $"Insect Armor with Laser Cannon: +{armadura.ganho} no meu " +
                        $"{armadura.alvo} (zona {armadura.zona})");
                }
                _log("guarda o Insect Armor with Laser Cannon: nenhum Inseto MEU de pe' " +
                     "para receber os +700");
            }

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

            // 5.355 EQUIPAMENTO DA MÃO — a regra GENÉRICA, por tabela.
            //
            //   Até aqui só saía equipamento com regra própria por id (Cocoon,
            //   Insect Armor) ou buscado do deck (Armory Call). O resultado era
            //   um NPC que carregava Gust Fan, Cyber Shield ou Sword of
            //   Dark Destruction na mão a partida inteira sem nunca equipar —
            //   e nenhum teste acusava, porque cada deck novo só provava as
            //   cartas com regra própria.
            //
            //   Duas travas, e as duas importam:
            //
            //     • **só com monstro meu com a face para cima**. Sem alvo o
            //       motor nem oferece, mas o `MonstrosFaceUp` mantém a decisão
            //       legível no log em vez de depender do silêncio do core;
            //     • **só equipamento que a tabela conhece com bônus > 0**. O
            //       silêncio da tabela significa "não sei o que faz", e Ring of
            //       Magnetism / Paralyzing Potion existem para atrapalhar o
            //       monstro do OUTRO — gastá-las no meu seria pior que não jogar.
            //
            //   Vem DEPOIS do Armory Call (que busca do deck e é 1x por turno) e
            //   ANTES das buscas de corpo: reforçar quem já está em campo é o
            //   ganho imediato, e a mão continua lá no turno seguinte.
            {
                var equip = MelhorEquipDaMao(q, me);
                if (equip.index >= 0)
                {
                    _proximoAlvoDoEquip = equip.zona;
                    return new Play("activate", equip.index,
                        $"equipa {equip.code} em {equip.alvo} (zona {equip.zona}): " +
                        $"+{equip.ganho} no numero que a batalha dele usa");
                }
            }

            // 5.356 MAGIA DE CAMPO — quem ela reforça, lido do LUA DELA.
            //
            //   Magia de campo é GLOBAL: vale para os DOIS lados. Por isso a regra
            //   nunca foi "tenho uma, ativo" — e por isso ela também não pode ser
            //   "algum monstro meu ganha": a Mountain com um Dragão meu e dois
            //   dele reforça mais o outro lado do que o meu, e eu ainda pago a
            //   carta por isso. A conta é a DIFERENÇA.
            //
            //   Quem diz o que a carta faz é o Lua dela (`BonusDeCampo`), não uma
            //   tabela nossa. A tabela existiu e tinha três entradas — Mountain,
            //   Umi e A Legendary Ocean —, e das seis magias de campo básicas da
            //   Lista 1 o NPC usava duas: Forest, Yami, Sogen e Wasteland ficavam
            //   mortas na mão para sempre, sem um aviso.
            //
            //   Ler o Lua trouxe de graça o que a tabela não sabia dizer: a
            //   PENALIDADE. A Umi tira 200 de Máquina e Piro, o Yami tira 200 de
            //   Fada — e agora isso entra na conta dos dois lados.
            //
            //   Script que não dá para ler devolve `Conhecido == false`, e aí a
            //   carta simplesmente não é ativada. É o mesmo silêncio seguro da
            //   tabela: errar para menos deixa uma carta parada, errar para mais
            //   reforça o adversário.
            //
            //   Não confere se já existe campo ativo: se for a MESMA carta o motor
            //   nem oferece; se for outra, trocar é justamente o que se quer (a que
            //   estava ali era do outro, ou pior que esta).
            {
                var campo = AtivavelSe(q, c => _cards.Stats(c).IsSpell
                                            && (_cards.Stats(c).Type & TYPE_CAMPO) != 0
                                            && _cards.CampoDe(c).Conhecido
                                            && !COM_REGRA_PROPRIA.Contains(c));
                if (campo.code != 0)
                {
                    var bonus = _cards.CampoDe(campo.code);
                    int Soma(int quem) => MonstrosFaceUp(quem).Sum(c => bonus.Para(_cards.Stats(c)));

                    int meu = Soma(me), dele = Soma(foe);

                    // O GANHO NÃO É SÓ ATK. Uma carta que conta como "Umi" liga a
                    // proteção do Legendary Fisherman — ele passa a não poder ser
                    // alvo de ataque. Medir só o bônus faria o NPC guardar a Umi
                    // com o Fisherman em campo, que é quando ela mais vale: ele é
                    // Warrior e não ganha um ponto de ATK dela.
                    int protegidos = CONTAM_COMO_UMI.Contains(campo.code)
                        ? MonstrosFaceUp(me).Count(c => IMUNES_A_MAGIA_COM_UMI.Contains(c))
                        : 0;

                    // JA' TENHO CAMPO EM PE'? Ativar outra magia de campo manda a
                    // que esta' la' para o cemiterio — trocar por uma que rende o
                    // MESMO (ou menos) e' jogar uma carta fora.
                    //
                    // Nao e' hipotese: o comentario antigo aqui dizia que "se for a
                    // MESMA carta o motor nem oferece", e o duelo de `--test-campos`
                    // mostrou o contrario — com tres Forest na mao ele trocava
                    // Forest por Forest, turno apos turno. So' apareceu agora
                    // porque a regra passou a valer para todas as magias de campo,
                    // e nao para as tres de uma tabela.
                    int deQuemJaEsta = _faceUpStOf(me)
                        .Where(c => (_cards.Stats(c).Type & TYPE_CAMPO) != 0)
                        .Select(c => MonstrosFaceUp(me).Sum(m => _cards.CampoDe(c).Para(_cards.Stats(m)))
                                   - MonstrosFaceUp(foe).Sum(m => _cards.CampoDe(c).Para(_cards.Stats(m))))
                        .DefaultIfEmpty(int.MinValue)
                        .Max();

                    if (deQuemJaEsta != int.MinValue && meu - dele <= deQuemJaEsta)
                    {
                        _log($"guarda a magia de campo {campo.code}: a que ja' esta' em campo " +
                             $"rende {deQuemJaEsta:+#;-#;0} e esta renderia {meu - dele:+#;-#;0} — " +
                             "trocar seria perder uma carta");
                    }
                    else if ((meu > 0 && meu > dele) || protegidos > 0)
                        return new Play("activate", campo.index,
                            $"magia de campo {campo.code}: {meu:+#;-#;0} para mim contra " +
                            $"{dele:+#;-#;0} para ele" +
                            (protegidos > 0 ? $" e protege {protegidos}" : ""));
                    else
                        _log($"guarda a magia de campo {campo.code}: {meu:+#;-#;0} para mim contra " +
                             $"{dele:+#;-#;0} para ele — nao compensa a carta");
                }
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
            //
            //       **E o corpo tem de vir de ATIVAR.** O banco marca a Chaos
            //       Scepter Blast como INVOCAÇÃO ESPECIAL (0x100000) por causa do
            //       efeito de ela ser DESTRUÍDA na zona de magia — ativá-la não põe
            //       corpo nenhum em campo: bane 1 carta, e com o campo dele vazio
            //       essa carta é minha. É a MESMA armadilha do Templo do Mako (que
            //       o banco marca igual, por causa do retorno na End Phase) e a
            //       MESMA leitura que a exclui da regra do "corpo de graça", na
            //       janela de corrente. Quem responde é o Lua da própria carta.
            var poeCorpo = AtivavelSe(q, c => Perfil(c).InvocaEspecial && !Perfil(c).Fusao
                                           && !COM_REGRA_PROPRIA.Contains(c)
                                           && !_cards.SalvaSeDestruida(c));
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

            // 5.376 TEMPLO ESQUECIDO DAS PROFUNDEZAS (Mako). Duas coisas na mesma
            //       oferta: pôr a carta em campo (sempre bom — o nome vira "Umi")
            //       e o efeito de banir, que só sai com motivo. Ver `MotivoDoTemplo`.
            //
            //       Vem logo depois da regra genérica do corpo de graça porque é
            //       ela que o disparava errado: o banco marca o Templo como
            //       INVOCAÇÃO ESPECIAL por causa do retorno na End Phase.
            if (Ativavel(q, FORGOTTEN_TEMPLE))
            {
                var (ativar, alvo, porque) = MotivoDoTemplo(me, "", 0, -1);
                if (ativar)
                {
                    _proximoAlvoDoTemplo = alvo;
                    return new Play("activate", IdxAtivavel(q, FORGOTTEN_TEMPLE), $"Templo: {porque}");
                }
                _log($"guarda o Templo — {porque ?? "nenhum monstro meu esta' em risco"}");
            }

            // 5.4 Insect Imitation — tributa 1 monstro meu para trazer do PRÓPRIO
            //     deck um Inseto de nível +1. Quem sai é o corpo mais barato do
            //     campo (`_proximoTributoBarato`, cumprido no `DecideSelect`).
            //
            //     "Sempre vale" era falso, e o relato de um duelo real mostrou
            //     as duas pontas do prejuízo:
            //
            //       • o corpo que sai não pode estar EQUIPADO — o equipamento vai
            //         junto para o cemitério, e um Nv+1 qualquer do deck
            //         raramente paga as duas cartas;
            //       • se ele é o meu ÚNICO monstro e já segura a maior ameaça do
            //         outro lado, tributá-lo é desmontar o campo às cegas: o Lua
            //         traz um Inseto de nível +1, não um mais FORTE.
            if (Ativavel(q, INSECT_IMITATION))
            {
                var sai = CorpoMaisBarato(me);
                bool equipado = sai.code != 0 && sai.valor > ValorImpressoNaPosicao(sai.code, sai.pos);
                bool seguraSozinho = QtdMonstros(me) == 1 && ameaca > 0 && sai.valor >= ameaca;
                if (!equipado && !seguraSozinho)
                {
                    _proximoTributoBarato = true;
                    return new Play("activate", IdxAtivavel(q, INSECT_IMITATION),
                        $"Insect Imitation: tributa o corpo mais barato ({sai.code}, vale {sai.valor}) " +
                        "por um Inseto de nivel +1 do deck");
                }
                _log("guarda Insect Imitation: " + (equipado
                    ? $"o corpo mais barato ({sai.code}) esta' equipado — o equipamento iria junto"
                    : $"{sai.code} e' o meu unico monstro e ja' segura a ameaca ({ameaca})"));
            }

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

            // 5.505 BANIR UMA CARTA DO CAMPO (Chaos Scepter Blast).
            //
            // Ela nao entrava em regra nenhuma: `DestroiMonstro`/`DestroiSt`
            // exigem `Duel.Destroy` no script e ela usa `Duel.Remove`. O unico
            // caminho que chegava a ativa-la era a regra GENERICA da janela de
            // corrente — "ativa em resposta" —, que nao tem criterio nem de hora
            // nem de alvo. Com o campo dele vazio, a unica coisa que ela alcanca
            // sou eu: foi assim que o NPC baniu o proprio monstro de 2900 (o
            // maior da mesa, que ele acabara de reanimar do cemiterio do jogador).
            //
            // A trava e' a mesma da remocao acima — so' sai se ha' o que tirar do
            // campo DELE —, e a marca leva ao `DecideSelect` a informacao que ele
            // nao teria: que esta pergunta e' uma REMOCAO, e nao um custo nem um
            // alvo meu.
            var baneCampo = AtivavelSe(q, c => _cards.BaneDoCampo(c)
                                            && !COM_REGRA_PROPRIA.Contains(c)
                                            && !Perfil(c).DestroiMonstro && !Perfil(c).DestroiSt);
            if (baneCampo.code != 0)
            {
                if (ValeBanirDoCampoDele(foe))
                {
                    _remocaoDeCampo = true;
                    return new Play("activate", baneCampo.index,
                        $"bane 1 carta do campo dele ({baneCampo.code}) — banida nao volta nem se identifica");
                }
                _log($"guarda {baneCampo.code}: nao ha' no campo dele nada que valha a remocao " +
                     "(so' o que fica: monstro, virada, ou magia continua) — guardo para a ameaca");
            }
            // 5.55 TRAVA — a magia que prende o campo DELE (as Espadas).
            //
            // Faltava inteira: as duas Espadas nao entravam em regra nenhuma e
            // ficavam na mao a partida toda. O relato foi literal — *"ele ta
            // perdendo e mesmo assim nao usa a Swords of Concealing Light"*. Nao
            // era um criterio errado, era a ausencia de qualquer criterio: nem a
            // `category` do banco as classifica (vem 0 nas duas), entao nenhuma
            // das regras por EFEITO as via, e nenhuma lista por id as citava.
            //
            // O criterio e' a mesma `ameacaReal` que o resto do cerebro usa: ele
            // tem monstro que o meu campo NAO supera. E' exatamente a situacao
            // que a trava resolve — o ataque dele para por dois ou tres turnos e
            // eu ganho tempo para achar corpo. Com o campo dominado, a carta fica
            // guardada: travar quem eu ja' venco no combate so' adia o meu
            // proprio ataque e joga uma carta fora.
            //
            // Vem DEPOIS da remocao de proposito. As duas resolvem o mesmo
            // problema, mas a remocao resolve para sempre e a trava tem prazo —
            // gastar a trava com um Raigeki na mao seria trocar a solucao pela
            // pausa.
            //
            // LIMITE CONHECIDO, escrito aqui para nao ser redescoberto: a regra
            // nao le' a CONDICAO da trava, so' o alcance. Uma Insect Barrier
            // (que so' prende os Insetos dele) sairia contra um campo sem inseto
            // nenhum. Nao ha' carta assim em deck de NPC hoje, e ler a condicao
            // seria reimplementar o filtro do Lua do lado de fora — o que este
            // projeto nao faz. Quem oferece a carta continua sendo o motor.
            //
            // O `!IsMonster` e o `!TYPE_EQUIP` nao sao formalidade: o alcance
            // `(0, LOCATION_MZONE)` tambem aparece em monstro com efeito continuo
            // (que se poe em campo, nao se "ativa") e no Gravity Axe - Grarl, um
            // EQUIPAMENTO — e equipamento ja' tem regra propria, que escolhe o
            // alvo. Duas regras disputando a mesma carta e' como o alvo errado
            // aparece.
            var trava = AtivavelSe(q, c =>
            {
                var st = _cards.Stats(c);
                return Perfil(c).Trava && !st.IsMonster && (st.Type & TYPE_EQUIP) == 0
                       && !COM_REGRA_PROPRIA.Contains(c);
            });
            if (trava.code != 0)
            {
                if (ameacaReal)
                    return new Play("activate", trava.index,
                        $"trava: {trava.code} prende o campo dele — a maior ameaca ({ameaca}) " +
                        $"supera o meu melhor atacante ({meuMelhor})");
                _log($"guarda a trava {trava.code}: " +
                     (oponenteTemMonstro
                        ? $"meu melhor atacante ({meuMelhor}) ja' supera o campo dele ({ameaca})"
                        : "o campo dele esta vazio — nao ha' o que travar"));
            }

            // 5.56 ENTERRAR PARA USAR DEPOIS (Foolish Burial e afins).
            //
            // Sozinha e' perda de carta: tira um monstro do deck e nao poe nada em
            // campo. O valor esta' no PAR — enterrar o corpo grande e trazer de
            // volta.
            //
            // A primeira versao exigia a reanimacao na MAO, e com isso a carta
            // quase nunca saia: num deck de 40 com tres Monster Reborn, ter as
            // duas metades juntas e' sorte, nao plano — na pratica ela ficava na
            // mao a partida inteira. O pedido veio do deck **Yugi Chaos**, que
            // leva TRES Foolish Burial de proposito: eles existem para ADIANTAR o
            // Dark Magician of Chaos ao cemiterio e alcanca-lo depois, e nao para
            // acompanhar um Reborn que ja' esteja na mao.
            //
            // Sao dois motivos, nesta ordem:
            //   (a) a reanimacao esta' na MAO — o combo fecha AGORA, e e' o melhor
            //       caso;
            //   (b) ela esta' no DECK — enterrar e' ADIANTAR: o corpo espera no
            //       cemiterio a carta que vem, que e' o que faz um Foolish Burial
            //       valer a pena numa mao de abertura.
            //
            // O (b) NAO e' "ativar sempre". Um deck sem reanimacao nenhuma
            // continua guardando a carta, porque ali enterrar e' mesmo pagar uma
            // carta para encher o proprio cemiterio — e e' esse o par CONTROLE da
            // regra: sem ele, "ativou" nao provaria criterio nenhum.
            //
            // LIMITE CONHECIDO: `_listaDoDeck` e' a DECKLIST, e nao o que sobrou
            // dentro do deck — seguir cada carta que deixa `LOCATION_DECK` seria
            // encanamento novo para uma diferenca que sempre cai para o lado
            // barato: uma reanimacao ja' comprada esta' na MAO, e ai quem responde
            // e' o (a); uma ja' gasta superestima o deck em uma carta.
            //
            // Vem depois da regra que POE CORPO (o Premature Burial ja' rodou
            // acima): com alvo bom no cemiterio o motor ja' oferece a reanimacao,
            // e reanimar agora vale mais que preparar outra. Sem alvo, o motor nao
            // a oferece — e e' exatamente ai que enterrar faz sentido.
            var enterrar = AtivavelSe(q, c => Perfil(c).EnterraDoDeck && !COM_REGRA_PROPRIA.Contains(c));
            if (enterrar.code != 0)
            {
                var reanimacoes = MinhasReanimacoes(me);
                var deck = _listaDoDeck(me);
                // Os corpos do MEU deck que alguma reanimacao minha alcanca — e' a
                // pergunta "tem alvo valido?" feita antes de gastar a carta.
                var alvos = deck.Distinct()
                    .Where(c => reanimacoes.Any(r => _cards.ReanimacaoAlcanca(r, c)))
                    .ToList();

                uint naMao = _handOf(me).FirstOrDefault(c => Perfil(c).ReanimaDoCemiterio);

                // Sem decklist informada nada mudou: quem responde e' a MAO, como
                // sempre respondeu. E' o que mantem de pe' todo teste de decisao
                // isolada deste projeto, que monta mao e campo e nunca deck.
                if (naMao != 0 && (deck.Count == 0 || alvos.Count > 0))
                {
                    MarcarEnterro(me, ameacaReal);
                    return new Play("activate", enterrar.index,
                        $"enterra do deck ({enterrar.code}) para reanimar depois — tenho {naMao} na mao");
                }
                if (alvos.Count > 0)
                {
                    MarcarEnterro(me, ameacaReal);
                    return new Play("activate", enterrar.index,
                        $"enterra do deck ({enterrar.code}) ADIANTADO — o corpo espera no cemiterio " +
                        $"pela(s) {reanimacoes.Count} reanimacao(oes) do meu deck, que alcanca(m) " +
                        $"{alvos.Count} corpo(s) dele");
                }
                _log($"guarda {enterrar.code}: " +
                     (reanimacoes.Count == 0
                        ? "nao tenho reanimacao nenhuma que eu saiba usar"
                        : $"as {reanimacoes.Count} reanimacao(oes) que eu tenho nao alcancam corpo " +
                          "nenhum do meu deck") +
                     " — enterrar seria so' perder carta");
            }

            // 5.57 REFORCO PERMANENTE do meu campo (Yellow Luster Shield, Banner
            //      of Courage). Ele so' vale com corpo para receber: ativado com o
            //      campo vazio nao faz nada e ainda ocupa a zona que uma armadilha
            //      usaria. E' barato e definitivo, entao nao disputa prioridade com
            //      nada — fica no fim, antes de partir para a batalha.
            // Magia de CAMPO tem regra propria (5.356) e nao entra aqui: ela vale
            // para os dois lados, e esta regra so' sabe medir o meu.
            var reforco = AtivavelSe(q, c => Perfil(c).ReforcoMeuCampo && !COM_REGRA_PROPRIA.Contains(c)
                                          && (_cards.Stats(c).Type & TYPE_CAMPO) == 0);
            if (reforco.code != 0)
            {
                if (QtdMonstros(me) >= 1)
                    return new Play("activate", reforco.index,
                        $"reforco permanente ({reforco.code}): tenho {QtdMonstros(me)} corpo(s) para receber");
                _log($"guarda {reforco.code}: sem monstro em campo, o reforco nao reforca nada");
            }

            // 5.58 EMBARALHAR AS MINHAS VIRADAS (Shifting Shadows, Magical Hats).
            //
            // Nao muda um ponto de ATK: o que ela faz e' apagar o que o outro lado
            // ja' sabia sobre qual carta esta' em qual zona — e num deck de cartas
            // setadas, como o do Panik, e' disso que o duelo vive. Contra o motor
            // valeria zero; contra gente, que ve' a mesa e lembra, vale.
            //
            // Duas jogadas na mesma carta, separadas pela LOCALIZACAO da oferta:
            //   • da MAO (loc 2) e' po-la em campo — de graca, e so' faz sentido
            //     com alguma carta virada para esconder;
            //   • do CAMPO (loc 8) e' o efeito de ignicao, que custa LP. Quantas
            //     viradas sao precisas quem decide e' o motor (o Lua exige duas),
            //     entao aqui so' resta a conta que ele nao faz: o custo cabe?
            var embaralha = AtivavelSe(q, c => Perfil(c).EmbaralhaViradas && !COM_REGRA_PROPRIA.Contains(c));
            if (embaralha.code != 0)
            {
                int viradas = _todoFieldPosOf(me).Count(m => (m.pos & POS_VIRADA) != 0);
                bool doCampo = embaralha.location == SZONE;
                bool custoCabe = !Perfil(embaralha.code).PagaLp || _lpOf(me) - 300 >= LP_PISO;

                if (doCampo && custoCabe)
                    return new Play("activate", embaralha.index,
                        $"embaralha as minhas {viradas} viradas ({embaralha.code}): ele perde o que sabia da mesa");
                if (!doCampo && viradas >= 1)
                    return new Play("activate", embaralha.index,
                        $"poe {embaralha.code} em campo: tenho {viradas} carta(s) virada(s) para esconder depois");
                _log($"guarda {embaralha.code}: " +
                     (doCampo ? $"os 300 LP me deixariam abaixo do piso de {LP_PISO}"
                              : "nao tenho carta virada nenhuma para esconder"));
            }

            // A queima que se paga em VIDA PROPRIA. A **Tremendous Fire** tira
            // 1000 dele e 500 de MIM, e a regra era uma so' — "dano fixo no
            // oponente, ativa sempre que der". Com 500 de vida o NPC a ativava e
            // perdia o duelo ali; foi o relato do Panik.
            //
            // Nao ha' o que ler no banco: a `category` diz que a carta causa
            // dano, nunca EM QUEM. Quem sabe e' o Lua dela (`DanoEmMim`), onde
            // quem ativou e' `tp` e o oponente e' `1-tp`.
            //
            // A recusa e' so' contra a MORTE, e nao um piso de LP: queimar e' a
            // condicao de vitoria de um deck de queima, e um piso o faria parar
            // de jogar justamente quando esta' na frente. E nem "mas eu levo ele
            // junto" salva: o Lua aplica os dois danos e SO' DEPOIS o motor
            // confere o LP (`Duel.RDComplete`), entao os dois chegam a zero na
            // mesma resolucao e o resultado e' EMPATE — nunca vitoria.
            //
            // O filtro entra no criterio, e nao depois dele: com uma Ookazi e
            // uma Tremendous Fire na mao, recusar a segunda nao pode engolir a
            // primeira, que nao custa nada.
            bool BurnSeguro(uint c) => BURN.Contains(c) && _lpOf(me) - _cards.DanoEmMim(c) > 0;
            var burn = AtivavelSe(q, BurnSeguro);
            if (burn.code != 0)
            {
                int custo = _cards.DanoEmMim(burn.code);
                return new Play("activate", burn.index,
                    $"burn: dano fixo no oponente ({burn.code})" +
                    (custo > 0 ? $" — os {custo} que ela cobra de mim cabem nos {_lpOf(me)} que eu tenho" : ""));
            }
            var burnSuicida = AtivavelSe(q, BURN.Contains);
            if (burnSuicida.code != 0)
                _log($"guarda {burnSuicida.code}: ela tira {_cards.DanoEmMim(burnSuicida.code)} de MIM " +
                     $"e eu tenho {_lpOf(me)} — ativa-la e' perder o duelo");

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

            // O CORPO QUE O RITUAL DEVE TRAZER, escolhido pela regra 5 — ela ativou
            // aquele ritual justamente para pôr ESTE monstro em campo (ver
            // `RitualQueAcorda`). Sem esta linha, a escolha cairia no critério
            // genérico de maior ATK e traria o Guerreiro de volta, desfazendo a
            // decisão que acabou de ser tomada.
            //
            // Vem DEPOIS do ramo de tributo (`release > 0`): num ritual que cobra
            // tributos da mão, o monstro desejado também aparece na lista de
            // custo — e escolhê-lo ali seria pagar com ele.
            if (escolhaUnica && _proximoRitualCorpo != 0)
            {
                uint desejado = _proximoRitualCorpo;
                var mira = q.choices.FirstOrDefault(c => c.code == desejado);
                if (mira.code == desejado)
                {
                    _proximoRitualCorpo = 0;
                    _log($"ritual: invoca {desejado}, que e' o corpo que a regra escolheu");
                    return new List<int> { mira.index };
                }
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
                    _proximoAlvoDoEquip = escolha.zona;
                    _log($"Armory Call: escolhe {escolha.code} (+{escolha.ganho} em {escolha.alvo}, zona {escolha.zona})");
                    return new List<int> { escolha.index };
                }
                _log("Armory Call: nenhum equipamento do deck serve ao meu campo — " +
                     "leva o de maior bonus mesmo assim");
            }

            // **O ALVO DE UMA REMOCAO DE CAMPO** (Chaos Scepter Blast), avisado
            // pela regra 5.505 ou pela janela de corrente.
            //
            // A lista dela mistura MONSTRO e MAGIA/ARMADILHA dos DOIS lados, e
            // nenhum ramo daqui a reconhecia: o "alvo em campo" la' embaixo so'
            // olha `MZONE` e so' dispara quando o oponente tem MONSTRO. Sem
            // monstro dele na lista, tudo caia no criterio generico — maior ATK,
            // sem perguntar de quem e' — e a carta banía o meu melhor corpo.
            //
            // A ordem e' a mesma de toda remocao: monstro dele primeiro, pela
            // ameaca que ele representa AGORA; so' magia/armadilha dele, a mais
            // pesada.
            //
            // O ultimo degrau nao devia acontecer (as duas portas que ativam a
            // carta ja' exigem campo dele com carta), e existe porque o motor JA'
            // pediu a resposta: nao responder trava o duelo em silencio. Aí' se
            // paga com a MINHA carta mais barata — nunca com a melhor, que era o
            // que o criterio generico fazia.
            if (escolhaUnica && _remocaoDeCampo)
            {
                _remocaoDeCampo = false;
                var dele = q.choices.Where(c => c.controller != me).ToList();
                if (dele.Count > 0)
                {
                    var monstrosDele = dele.Where(c => c.location == MZONE).ToList();
                    var alvo = monstrosDele.Count > 0
                        ? monstrosDele.OrderByDescending(AmeacaDoAlvo).First()
                        : dele.OrderByDescending(ValorDeBanirSt).First();
                    _log($"remocao de campo: bane {alvo.code} do lado DELE " +
                         (monstrosDele.Count > 0
                            ? $"(a maior ameaca entre os {monstrosDele.Count} monstros dele)"
                            : $"(a magia/armadilha que mais vale — {ValorDeBanirSt(alvo)}; " +
                              "a aberta de uso unico esta' resolvendo e nao conta)"));
                    return new List<int> { alvo.index };
                }

                var meuSt = q.choices.Where(c => c.location != MZONE).ToList();
                var pago = meuSt.Count > 0
                    ? meuSt.OrderBy(c => Peso(c.code)).First()
                    : q.choices.OrderBy(c => ValorDoMeuCorpo(me, c.code, c.sequence)).First();
                _log($"remocao de campo: ele nao tem NADA na lista — o motor exige uma resposta, " +
                     $"entao vai a minha carta mais barata ({pago.code})");
                return new List<int> { pago.index };
            }

            // **O CORPO QUE VAI PARA O CEMITERIO** (Foolish Burial), avisado pela
            // regra 5.56.
            //
            // O criterio generico la' embaixo e' "maior ATK impresso", e para esta
            // pergunta ele e' uma armadilha: no deck do Yugi Chaos o maior ATK do
            // deck e' o **Black Luster Soldier** (3000), um monstro de RITUAL.
            // Ritual, fusao, sincro, xyz e os "nomi" so' saem do cemiterio se
            // tiverem sido corretamente invocados ANTES — e quem foi do deck
            // direto para la' nunca foi (ver `DatabaseManager.VoltaDoCemiterio`).
            //
            // O erro e' CALADO: a carta e' enterrada, o motor esta' certo, e o
            // Monster Reborn seguinte simplesmente nao a oferece. Nada acusa — so'
            // o combo que nunca fecha. Enterrar o Dark Magician of Chaos (2800,
            // que VOLTA) custa 200 de ATK e rende o deck inteiro.
            //
            // Nao vindo nenhum que volte, enterra o maior mesmo assim: o motor ja'
            // pediu a resposta, e nao responder trava o duelo em silencio. Recusar
            // aqui seria trocar uma jogada ruim por um jogo parado.
            if (escolhaUnica && _proximoEnterroDoDeck)
            {
                _proximoEnterroDoDeck = false;
                var preciso = _enterroPara;
                _enterroPara = PrecisoDe.Corpo;

                // PRIMEIRO a pergunta que manda: **eu consigo trazer este corpo de
                // volta?** Nao "algum dia alguem conseguiria" — a reanimacao que
                // EU tenho, com o filtro que ELA tem. Nao havendo alvo assim, a
                // cascata desce: quem ao menos o motor deixa voltar, e por fim
                // qualquer um — porque o motor JA' pediu a resposta e nao
                // responder trava o duelo em silencio.
                var reanimacoes = MinhasReanimacoes(me);
                var legais = q.choices
                    .Where(c => reanimacoes.Any(r => _cards.ReanimacaoAlcanca(r, c.code))).ToList();
                string alcance = $"a(s) {reanimacoes.Count} reanimacao(oes) que eu tenho o alcanca(m)";
                if (legais.Count == 0)
                {
                    legais = q.choices.Where(c => _cards.VoltaDoCemiterio(c.code)).ToList();
                    alcance = "nenhuma reanimacao minha o alcanca; ao menos o motor o deixa voltar";
                }
                if (legais.Count == 0)
                {
                    legais = q.choices.ToList();
                    alcance = "nenhum dos oferecidos volta do cemiterio; vai o maior mesmo assim";
                }

                // AS TRES RAZOES, cada uma so' na carencia dela (ver `PrecisoDe`).
                // Fora da carencia, o criterio continua sendo o de sempre — o
                // maior ATK. Sem isso a regra atropelaria: um corpo de 900 que
                // poe uma carta na mao passaria na frente de um de 3000 numa mesa
                // em que nada esta' apertando.
                InteractiveDuel.Sel escolha;
                string necessidade;
                switch (preciso)
                {
                    case PrecisoDe.Campo:
                        // Primeiro quem QUEBRA o campo dele (resolve de vez, como
                        // a remocao vence a trava na regra 5.55); nao havendo,
                        // quem mais SEGURA — e e' aqui que uma parede de 0/3000
                        // ganha de um 2000 de ATK.
                        escolha = legais
                            .OrderByDescending(c => _cards.AoVoltarDoCemiterio(c.code).quebra ? 1 : 0)
                            .ThenByDescending(c => ValorQueSegura(c.code))
                            .ThenByDescending(c => _cards.Stats(c.code).Level).First();
                        necessidade = _cards.AoVoltarDoCemiterio(escolha.code).quebra
                            ? "estou sob ameaca e ele QUEBRA o campo dele ao voltar"
                            : $"estou sob ameaca e ele e' quem mais SEGURA ({ValorQueSegura(escolha.code)})";
                        break;

                    case PrecisoDe.Carta:
                        escolha = legais
                            .OrderByDescending(c => _cards.AoVoltarDoCemiterio(c.code).recurso ? 1 : 0)
                            .ThenByDescending(c => _cards.Stats(c.code).AtkValue)
                            .ThenByDescending(c => _cards.Stats(c.code).Level).First();
                        necessidade = _cards.AoVoltarDoCemiterio(escolha.code).recurso
                            ? "a mao esta' curta e ele volta GERANDO CARTA"
                            : "a mao esta' curta e nenhum gera carta — vai o de maior ATK";
                        break;

                    default:
                        escolha = legais
                            .OrderByDescending(c => _cards.Stats(c.code).AtkValue)
                            .ThenByDescending(c => _cards.Stats(c.code).Level).First();
                        necessidade = "nada apertando — vai o de maior ATK";
                        break;
                }

                _log($"enterra {escolha.code} ({_cards.Stats(escolha.code).AtkValue}/" +
                     $"{_cards.Stats(escolha.code).DefValue}): {alcance}; {necessidade}");
                return new List<int> { escolha.index };
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

            // Alvo do Templo: a regra já escolheu QUEM salvar (o que morre na End
            // Phase, ou o que a destruição do outro lado mira). Sem isto a escolha
            // cairia no critério genérico de maior ATK e baniria o monstro errado
            // — tirando do campo justamente o que estava segurando o turno.
            if (escolhaUnica && loc == MZONE && _proximoAlvoDoTemplo != 0)
            {
                uint alvo = _proximoAlvoDoTemplo;
                _proximoAlvoDoTemplo = 0;
                var mira = q.choices.FirstOrDefault(c => c.code == alvo);
                if (mira.code == alvo) return new List<int> { mira.index };
            }

            // ALVO DO EQUIPAMENTO: a regra já escolheu a ZONA (`MelhorEquipPor`),
            // porque foi olhando aquele monstro — e a posição dele — que ela
            // decidiu que valia gastar a carta. A zona, e não o código: duas
            // cópias do mesmo monstro não se distinguem pelo código, e é comum
            // uma estar de pé e a outra deitada.
            if (escolhaUnica && loc == MZONE && _proximoAlvoDoEquip >= 0)
            {
                int zona = _proximoAlvoDoEquip;
                _proximoAlvoDoEquip = -1;
                var mira = q.choices.FirstOrDefault(c => c.controller == me && c.sequence == zona);
                if (mira.code != 0)
                {
                    _log($"equipamento: no alvo que a regra escolheu ({mira.code}, zona {zona})");
                    return new List<int> { mira.index };
                }
                // A zona não veio na lista (o motor pode ter recusado aquele
                // alvo). Cair no critério geral aqui seria pôr o reforço no
                // monstro do OUTRO lado: vários equipamentos aceitam alvo dos
                // dois lados (o `AddEquipProcedure` com o jogador em `nil`), e o
                // geral abaixo mira justamente o campo do oponente. Então o pior
                // caso é o melhor corpo MEU, nunca um deles.
                var meuMelhorAlvo = q.choices
                    .Where(c => c.controller == me)
                    .OrderByDescending(AmeacaDoAlvo)
                    .FirstOrDefault();
                if (meuMelhorAlvo.code != 0)
                {
                    _log($"equipamento: a zona {zona} nao foi oferecida — vai no meu melhor corpo " +
                         $"({meuMelhorAlvo.code})");
                    return new List<int> { meuMelhorAlvo.index };
                }
                _log($"equipamento: a zona {zona} nao foi oferecida e nao ha' corpo meu na lista");
            }

            // CUSTO DE RELEASE (Insect Imitation): paga com o corpo mais barato,
            // a MESMA conta do ramo de tributo lá em cima. Sem isto ele caía na
            // regra genérica de "o mais forte", que é certa para remoção e
            // exatamente o avesso do que um custo quer.
            if (loc == MZONE && _proximoTributoBarato)
            {
                _proximoTributoBarato = false;
                var meusEmCampo = q.choices.Where(c => c.controller == me).ToList();
                if (meusEmCampo.Count >= need)
                {
                    // `ValorDoMeuCorpo` e nao `AmeacaDoAlvo`: os dois medem o
                    // mesmo numero da batalha, mas so' o primeiro sabe que um
                    // corpo CONDENADO custa zero — e' ele que tem de sair antes
                    // de qualquer outro.
                    foreach (var c in meusEmCampo.OrderBy(c => ValorDoMeuCorpo(me, c.code, c.sequence)))
                    {
                        if (picks.Count >= need) break;
                        picks.Add(c.index);
                    }
                    _log("custo: paga com o(s) corpo(s) mais barato(s) do meu campo");
                    return picks;
                }
            }

            // **O ALVO DO ATAQUE que acabou de ser declarado.**
            //
            // A lista aqui e' so' do outro lado e so' da zona de monstro — a
            // mesma forma de uma remocao —, e por isso ela caia no criterio
            // generico la' embaixo: *o de maior ATK IMPRESSO*. Para uma remocao
            // isso esta' certo (tirar da mesa a maior ameaca); para um ataque e'
            // o avesso, porque quem ataca MORRE na troca ruim.
            //
            // O relato foi *"se meu monstro tem uns 3 buff que aumentaram o ATK
            // dele bastante, o NPC nao enxerga e decide atacar igual com um mais
            // fraco"*. A `DecideBattle` ja' lia o ATK vivo e ja' recusava a troca
            // ruim — ela declarava o ataque contra o alvo MAIS FRACO do outro
            // lado —, e a pergunta seguinte desfazia a decisao: entre um 1500 e
            // um 1800 equipado ate' 3300, o criterio impresso escolhia o
            // segundo, e o corpo do NPC morria.
            //
            // Criterio: entre os que eu VENCO, o mais forte — tirar da mesa a
            // maior ameaca que eu consigo tirar. Nao vencendo nenhum (a marca
            // veio de um ataque DIRETO que virou ataque a monstro, ou o campo
            // mudou entre as duas perguntas), o mais fraco: o menor prejuizo.
            //
            // Carta virada vale 0 aqui (o host mascara o codigo e, sem leitura,
            // ela nem aparece no campo lido), entao ela e' a ULTIMA entre as
            // vencivies — o NPC prefere bater no que ele conhece, que e' o que um
            // humano faria.
            if (escolhaUnica && _atacanteAtk >= 0
                && q.choices.All(c => c.location == MZONE && c.controller != me))
            {
                int atk = _atacanteAtk;
                _atacanteAtk = -1;
                var venciveis = q.choices.Where(c => AmeacaDoAlvo(c) < atk).ToList();
                var alvo = venciveis.Count > 0
                    ? venciveis.OrderByDescending(AmeacaDoAlvo).First()
                    : q.choices.OrderBy(AmeacaDoAlvo).First();
                _log($"alvo do ataque: bate em {alvo.code} (vale {AmeacaDoAlvo(alvo)}) " +
                     $"com os {atk} de ATK do atacante — " +
                     (venciveis.Count > 0
                        ? $"o mais forte entre os {venciveis.Count} que eu venco"
                        : "nao venco nenhum dos oferecidos; vai no mais barato"));
                return new List<int> { alvo.index };
            }

            // ALVO EM CAMPO com os DOIS LADOS na mesma lista: isso é REMOÇÃO, e
            // remoção mira o monstro do OUTRO.
            //
            // O critério genérico lá embaixo ordena por ATK sem perguntar de
            // QUEM é a carta — então bastava o meu monstro ser o maior ATK da
            // mesa para o efeito virar contra mim. Foi o que o jogador relatou:
            // o Wevil virou o Inseto Devorador de Homens com dois monstros do
            // jogador de pé do outro lado, e destruiu o próprio inseto, que
            // estava com o maior ATK porque ele mesmo o tinha acabado de
            // equipar.
            //
            // A ordem é pelo número que a BATALHA usa (`AmeacaDoAlvo`): de pé
            // vale o ATK, deitado vale a DEF, e sempre pelo valor de AGORA.
            //
            // Só entra quando o lado dele tem quantos alvos o motor pediu —
            // responder menos que o `selMin` faz o core repetir a pergunta e o
            // duelo trava sem erro nenhum.
            {
                var noCampo = q.choices.Where(c => c.location == MZONE).ToList();
                var dele = noCampo.Where(c => c.controller != me).ToList();
                if (noCampo.Any(c => c.controller == me) && dele.Count >= need)
                {
                    foreach (var c in dele.OrderByDescending(AmeacaDoAlvo))
                    {
                        if (picks.Count >= need) break;
                        picks.Add(c.index);
                    }
                    _log($"alvo em campo: a lista tinha carta minha junto — mira o lado do oponente " +
                         $"({string.Join(", ", picks.Select(i => q.choices[i].code))})");
                    return picks;
                }
            }

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

            // CUSTO QUE ACEITA MAO **OU** CAMPO — e a mao vem primeiro, sempre.
            //
            // O relato: *"o oponente esta' tirando o unico monstro que controla
            // pra comprar 1 card, ficando com o campo aberto"*. A carta e' a Dark
            // Factory of More Production, cujo custo e' "mande 1 monstro da MAO OU
            // DO CAMPO para o cemiterio". O motor manda as duas origens na MESMA
            // lista, e o criterio geral logo abaixo olha so' o `location` da
            // PRIMEIRA opcao: vindo um monstro do campo na frente, ele ordenava
            // por MAIOR ATK e pagava com o melhor corpo da mesa — que num campo de
            // um monstro so' e' o unico.
            //
            // A regra e' de forma, nao de carta: uma lista que so' tem coisa MINHA
            // e mistura mao com campo e' um custo, e um custo se paga com o que
            // nao esta' em jogo. Corpo em campo esta' fazendo trabalho; carta na
            // mao ainda nao faz nada.
            //
            // Dentro da mao, o criterio e' o mesmo do descarte de sempre
            // (`ValorDescarte`, o maior monstro): num deck com reanimacao — e o do
            // Panik tem tres Premature Burial — mandar o grandao para o cemiterio
            // e' meio caminho para po-lo em campo.
            {
                var naMao = q.choices.Where(c => c.location == HAND).ToList();
                var meusNoCampo = q.choices.Where(c => c.location == MZONE && c.controller == me).ToList();
                bool ehCustoDosDois = naMao.Count > 0 && meusNoCampo.Count > 0
                    && q.choices.All(c => c.location == HAND
                                          || (c.location == MZONE && c.controller == me));
                if (ehCustoDosDois)
                {
                    foreach (var c in naMao.OrderByDescending(ValorDescarte))
                    {
                        if (picks.Count >= need) break;
                        picks.Add(c.index);
                    }
                    // A mao nao cobriu o pedido: o resto sai do campo, e ai pelo
                    // corpo MAIS BARATO — o avesso do criterio de remocao.
                    foreach (var c in meusNoCampo.OrderBy(c => ValorDoMeuCorpo(me, c.code, c.sequence)))
                    {
                        if (picks.Count >= need) break;
                        picks.Add(c.index);
                    }
                    _log($"custo (mao ou campo): paga com {picks.Count} da mao/campo, a mao primeiro — " +
                         $"corpo em campo esta' segurando o turno");
                    return picks;
                }
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

        /// <summary>
        /// **As reanimações que eu ainda posso usar** — na mão, em campo (aberta
        /// ou virada) e as que o deck ainda tem —, e das quais eu SEI o que elas
        /// aceitam trazer de volta.
        ///
        /// O `Legivel` não é detalhe: uma reanimação cujo filtro o leitor não
        /// entende não pode entrar na conta, senão ela viraria uma promessa —
        /// "pode enterrar, que eu trago de volta" — para um corpo que ela nunca
        /// traria. Ver `DatabaseManager.ExigenciaDaReanimacao`.
        /// </summary>
        List<uint> MinhasReanimacoes(int me) =>
            _handOf(me).Concat(_faceUpStOf(me)).Concat(_setStOf(me)).Concat(_listaDoDeck(me))
                .Distinct()
                .Where(c => Perfil(c).ReanimaDoCemiterio
                         && _cards.ExigenciaDaReanimacao(c).Legivel)
                .ToList();

        /// <summary>
        /// **Quanto este corpo SEGURA quando voltar ao campo** — o maior entre
        /// ATK e DEF, que é o número que a `DecidePosicao` vai pôr para valer
        /// (de pé quando o ATK é maior, deitado quando não é).
        ///
        /// É a terceira razão para preferir um alvo a outro, e a única que não se
        /// lê no Lua: uma parede de 0/3000 é o melhor corpo para trazer de volta
        /// contra um campo que eu não supero, e pelo ATK ela é a pior carta do
        /// deck.
        /// </summary>
        int ValorQueSegura(uint code)
        {
            var st = _cards.Stats(code);
            return Math.Max(st.AtkValue, st.DefValue);
        }

        /// <summary>
        /// **De que eu estou precisando agora** — é isto que decide qual das três
        /// razões pesa na escolha do corpo que vai para o cemitério.
        ///
        /// A ordem não é gosto: campo antes de carta. Um monstro que eu não supero
        /// resolve o duelo contra mim já no turno que vem; uma mão curta só me
        /// deixa mais lento.
        /// </summary>
        enum PrecisoDe
        {
            /// <summary>Sob ameaça: quero um corpo que QUEBRE o campo dele ou que SEGURE.</summary>
            Campo,
            /// <summary>Mão curta e mesa calma: quero um corpo que volte GERANDO CARTA.</summary>
            Carta,
            /// <summary>Nada apertando: quero o maior corpo, e ponto.</summary>
            Corpo,
        }

        /// <summary>
        /// Marca o enterro e a NECESSIDADE do momento para o `DecideSelect` que
        /// vem em seguida — quem enxerga a mesa é a regra; a seleção só vê a lista
        /// de cartas que o motor ofereceu.
        ///
        /// **A mão curta é `≤ 2` DEPOIS de gastar esta carta** (a própria carta de
        /// enterro ainda está contada em `_handOf` quando a regra decide). Com
        /// duas cartas ou menos, o que falta não é corpo, é jogada — e é aí que um
        /// corpo que volta pondo carta na mão vale mais que um ATK maior. Acima
        /// disso ele não vale: trocar 3000 de ATK por 900 e uma carta é um mau
        /// negócio quando a mão ainda tem com que jogar.
        /// </summary>
        void MarcarEnterro(int me, bool sobAmeaca)
        {
            _proximoEnterroDoDeck = true;
            _enterroPara = sobAmeaca ? PrecisoDe.Campo
                         : _handOf(me).Count - 1 <= 2 ? PrecisoDe.Carta
                         : PrecisoDe.Corpo;
            _log($"enterro: preciso de {_enterroPara} " +
                 $"(ameaca: {sobAmeaca}, mao depois desta carta: {Math.Max(0, _handOf(me).Count - 1)})");
        }

        /// <summary>Monstros meus com a face para cima — os únicos que o Lua do
        /// Armory Call aceita como alvo (`eqfilter` exige `IsFaceup()`).</summary>
        List<uint> MonstrosFaceUp(int me) =>
            _fieldOf(me).Where(c => _cards.Stats(c).IsMonster).ToList();

        /// <summary>
        /// **Quanto um equipamento rende NA POSIÇÃO em que o alvo está.**
        ///
        /// De pé, o que conta é o ATK; deitado, a DEF — a mesma conta do
        /// <see cref="ValorNaBatalha"/>, e pelo mesmo motivo: é esse o número
        /// que a batalha usa. Um Gust Fan (+400 ATK / −200 DEF) num monstro
        /// deitado não rende +400: rende −200.
        /// </summary>
        static int GanhoDoEquip(Equipamento e, int pos) =>
            (pos & (POS_DEFESA | POS_DEFESA_VIRADA)) != 0 ? e.BonusDef : e.Bonus;

        /// <summary>
        /// Os meus monstros que podem RECEBER um equipamento, já com a posição e
        /// a zona. Mesmo conjunto que o <see cref="MonstrosFaceUp"/> devolve (o
        /// `eqfilter` do Lua exige a face para cima), MENOS o corpo CONDENADO; a
        /// diferença é carregar junto o que decide se o bônus vale alguma coisa.
        ///
        /// **O corpo condenado fica de fora, e essa é a metade que faltava.**
        /// Instant/Ready Fusion trazem uma Fusão que **não pode atacar** e é
        /// destruída na End Phase deste mesmo turno — e o equipamento vai junto
        /// para o cemitério com ela. Reforçar o ATK de quem não vai batalhar e
        /// não chega ao turno seguinte é rasgar a carta, e o desempate desta
        /// função ("na dúvida, reforça quem já vale mais na mesa") escolhia
        /// justamente ele: a Fusão que o Instant Fusion traz costuma ser o maior
        /// ATK do campo. Foi o relato — *"ele usa a Ready Fusion, gasta recurso
        /// em cima do monstro, e ele não pode atacar e na end é destruído"*.
        ///
        /// Nada disso dá erro: a carta equipa, o motor soma o bônus, a tela
        /// mostra o número novo — e os dois somem juntos na End Phase.
        /// </summary>
        List<(uint code, int pos, int seq, DatabaseManager.CardStats st)> AlvosDeEquip(int me) =>
            AbertosDe(me)
                .Where(m => !_corpoCondenado(me, m.seq))
                .Select(m => (m.code, m.pos, m.seq, st: _cards.Stats(m.code))).ToList();

        /// <summary>Este equipamento serve neste monstro? (raça/atributo da
        /// tabela × banco de cartas — ver <see cref="EQUIPAMENTOS"/>).</summary>
        static bool EquipServe(Equipamento e, DatabaseManager.CardStats st) =>
            (e.Raca == 0 || (st.Race & e.Raca) != 0)
            && (e.Atributo == 0 || (st.Attribute & e.Atributo) != 0);

        /// <summary>
        /// O melhor reforço que está na MINHA MÃO para um monstro que ainda vai
        /// entrar em campo — usado pela <see cref="DecidePosicao"/>.
        ///
        /// Não é leitura escondida: são cartas do próprio NPC.
        /// </summary>
        (uint code, int bonus, int bonusDef) ReforcoNaMaoPara(uint alvo, int me)
        {
            (uint code, int bonus, int bonusDef) melhor = (0, 0, 0);
            var st = _cards.Stats(alvo);
            if (!st.IsMonster) return melhor;
            foreach (var c in _handOf(me))
            {
                if (!EQUIPAMENTOS.TryGetValue(c, out var e) || e.Bonus <= 0) continue;
                if (!EquipServe(e, st)) continue;
                if (e.Bonus > melhor.bonus) melhor = (c, e.Bonus, e.BonusDef);
            }
            return melhor;
        }

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
        /// <summary>
        /// O melhor equipamento ATIVÁVEL agora (da mão), e quanto ele dá.
        ///
        /// Mesma tabela e mesmo critério do <see cref="MelhorEquipEntre"/> — que
        /// olha o que o Armory Call trouxe do deck —, só que sobre
        /// `q.activatable`. São duas listas de tipos diferentes (`Act` × `Sel`),
        /// e é só por isso que existem duas funções.
        ///
        /// `index` −1 quando não há nada que valha a pena: sem monstro meu com a
        /// face para cima, ou só equipamento que a tabela não conhece.
        /// </summary>
        (int index, uint code, int ganho, uint alvo, int zona) MelhorEquipDaMao(
            InteractiveDuel.Question q, int me) =>
            MelhorEquipPor(q.activatable.Select(a => (a.index, a.code)), me);

        (int index, uint code, int ganho, uint alvo, int zona) MelhorEquipEntre(
            IReadOnlyList<InteractiveDuel.Sel> opcoes, int me) =>
            MelhorEquipPor(opcoes.Select(o => (o.index, o.code)), me);

        /// <summary>
        /// **Qual equipamento, e em QUEM** — a conta única das duas pontas (a
        /// carta ativável da mão e a carta que o Armory Call trouxe do deck).
        /// Antes eram duas cópias da mesma regra, só porque as listas têm tipos
        /// diferentes (`Act` × `Sel`); hoje as duas passam por aqui.
        ///
        /// O critério mudou em dois pontos, e os dois vieram de um duelo real:
        ///
        ///   • o ganho é medido **na posição em que o alvo está**
        ///     (<see cref="GanhoDoEquip"/>). Um equipamento do ciclo por
        ///     atributo (+400 ATK / −200 DEF) num monstro DEITADO não reforça
        ///     nada: tira 200 do único número que aquela batalha vai usar. Ganho
        ///     ≤ 0 não é candidato — a carta fica na mão para quando houver
        ///     atacante;
        ///   • a `zona` do alvo volta junto. Sem ela a regra escolhia a carta
        ///     pensando num alvo e o `DecideSelect` seguinte equipava em OUTRO
        ///     (o de maior ATK impresso, que é justamente o deitado). Duas
        ///     pontas com contas diferentes decidem coisas diferentes — a mesma
        ///     armadilha do `ValorDoTributoQueSai`.
        ///
        /// `index` −1 quando não há nada que valha a pena: sem monstro meu com a
        /// face para cima, só equipamento que a tabela não conhece, ou só alvo
        /// em quem o bônus não renderia nada.
        /// </summary>
        (int index, uint code, int ganho, uint alvo, int zona) MelhorEquipPor(
            IEnumerable<(int index, uint code)> opcoes, int me)
        {
            var meus = AlvosDeEquip(me);
            (int index, uint code, int ganho, uint alvo, int zona) melhor = (-1, 0, 0, 0, -1);
            int valorDoMelhorAlvo = -1;
            if (meus.Count == 0) return melhor;

            foreach (var o in opcoes)
            {
                if (!EQUIPAMENTOS.TryGetValue(o.code, out var e) || e.Bonus <= 0) continue;

                foreach (var m in meus)
                {
                    if (!EquipServe(e, m.st)) continue;
                    int ganho = GanhoDoEquip(e, m.pos);
                    if (ganho <= 0) continue;
                    // Empate no ganho: reforça quem já vale mais na mesa. É ele
                    // que resolve a batalha, e +400 num 1800 passa por cima de
                    // mais coisa que os mesmos +400 num 1200.
                    int valorAlvo = ValorNaBatalha(m.code, m.pos, me, m.seq);
                    if (ganho > melhor.ganho ||
                        (ganho == melhor.ganho && valorAlvo > valorDoMelhorAlvo))
                    {
                        melhor = (o.index, o.code, ganho, m.code, m.seq);
                        valorDoMelhorAlvo = valorAlvo;
                    }
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
        /// <summary>
        /// **O campo dele tem alguma carta que VALHA uma remoção?**
        ///
        /// A primeira versão perguntava só "ele tem alguma carta?" (`QtdMonstros`
        /// ou zona de magia ocupada), e isso deixou passar o caso que veio a
        /// seguir no relato: o jogador ativou a **Summoner's Art**, o motor abriu
        /// a janela de corrente, e o NPC baniu a busca **no meio da própria
        /// resolução**. Banir ali não impede o efeito — o motor já a ativou — e a
        /// carta ia para o cemitério sozinha; o NPC pagou a própria remoção para
        /// não conseguir nada, e ficou sem ela para a ameaça de verdade.
        ///
        /// Três coisas valem, e a diferença entre elas é PERMANÊNCIA:
        ///
        ///   • um MONSTRO dele com a face para cima;
        ///   • uma magia/armadilha dele **que fica** (contínua, equipamento, de
        ///     campo) — ver `DatabaseManager.FicaEmCampo`;
        ///   • uma magia/armadilha **virada** dele: é incógnita, mas ela FICA, e
        ///     tirá-la antes de atacar é jogada clássica.
        ///
        /// O que NÃO vale é a Normal com a face para cima: ela só está ali porque
        /// está resolvendo neste instante.
        ///
        /// LIMITE CONHECIDO: o monstro SETADO do jogador não é contado — a visão
        /// honesta do NPC iniciante o descarta inteiro, presença e tudo
        /// (`MonstrosHonestos`). O erro cai para o lado barato (guardar a carta),
        /// e é o mesmo ponto cego que a regra 5.5 já tem com o `QtdMonstros`.
        /// </summary>
        bool ValeBanirDoCampoDele(int foe) =>
            QtdMonstros(foe) > 0
            || _setStCountOf(foe) > 0
            || _faceUpStOf(foe).Any(_cards.FicaEmCampo);

        /// <summary>
        /// **Quanto vale banir esta magia/armadilha dele.** Negativo = não vale.
        ///
        /// É a mesma pergunta do <see cref="ValeBanirDoCampoDele"/>, agora sobre a
        /// lista que o motor ofereceu — e ela erra calada nos dois lugares: a
        /// ordenação por `Peso` empata tudo que não está na tabela de ameaça
        /// (inclusive a magia que está resolvendo) e leva a primeira da lista.
        /// </summary>
        int ValorDeBanirSt(InteractiveDuel.Sel c)
        {
            // Virada: não sei o que é, mas sei que ela FICA — e é justamente a
            // carta que se tira do caminho antes de atacar.
            if (c.hidden || c.code == 0) return 1;
            if (!_cards.FicaEmCampo(c.code)) return -1;   // aberta e de uso único
            return 2 + Peso(c.code);
        }

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
            // CORPO CONDENADO custa ZERO. Ele morre na End Phase deste turno de
            // qualquer jeito, entao gasta-lo num tributo ou num material e' de
            // graca — o preco ja' foi pago quando a carta que o trouxe foi
            // ativada. Sem esta linha o cerebro media pelo ATK e PROTEGIA o corpo
            // que ia sumir: com um Barox (1380, do Instant Fusion) e um Petit Moth
            // (300) em campo, ele tributava o Moth e ficava com o Barox.
            if (_corpoCondenado(me, seq)) return 0;

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
                // Mesma medida do `CorpoMaisBarato` e do `DecideSelect`: um corpo
                // CONDENADO custa zero, porque ele some na End Phase de qualquer
                // jeito. E' o que faz o atalho que cobra um tributo sair de graca
                // no turno em que ha' um Instant/Ready Fusion na mesa.
                menor = Math.Min(menor, ValorDoMeuCorpo(me, m.code, m.seq));
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

            // Pergunta nova, ataque anterior ja' resolvido: a marca do atacante
            // nao pode sobrar. Marca velha faria a proxima escolha de alvo medir
            // pelo ATK de um monstro que nem esta' atacando.
            _atacanteAtk = -1;

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

            // ATAQUE DIRETO: dano de graça, e sempre a melhor jogada disponível
            // para o corpo que pode fazê-lo. Só o corpo escolhido muda com a
            // leitura.
            //
            // `canDirect` vem do BYTE do motor, não de uma conta nossa — e é por
            // isso que esta regra já cobre um caso que ninguém escreveu aqui: o
            // Amphibious Bugroth MK-11 e o Mega Fortress Whale atacam direto
            // ENQUANTO A UMI ESTIVER EM CAMPO, mesmo com o campo do oponente
            // cheio, e o motor marca o flag sozinho. O comentário antigo dizia
            // "campo do oponente vazio", e a explicação chegava assim à tela do
            // jogador — errada exatamente nos casos mais interessantes.
            var diretos = q.attackers.Where(a => a.canDirect).ToList();
            if (diretos.Count > 0)
            {
                var a = Atacante(diretos, punidora != 0, 0, me);
                bool campoVazio = QtdMonstros(foe) == 0;
                _atacanteAtk = AtkEmCampo(a.code, me, a.sequence);
                return new BattlePlay(true, a.index,
                    (campoVazio ? "campo do oponente vazio" : "passa por cima dos monstros dele") +
                    $" — ataque direto com {a.code} " +
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
            {
                _atacanteAtk = AtkEmCampo(maisForte.code, me, maisForte.sequence);
                return new BattlePlay(true, maisForte.index,
                    $"campo do oponente sem monstro — ataca com {maisForte.code}");
            }

            // Basta UM alvo que eu vença: o motor pergunta o alvo em seguida.
            var maisFraco = doOponente.OrderBy(m => m.valor).First();
            var escolhido = Atacante(q.attackers, punidora != 0, maisFraco.valor, me);
            int meuAtk = AtkEmCampo(escolhido.code, me, escolhido.sequence);

            if (meuAtk > maisFraco.valor)
            {
                // O ALVO e' escolhido depois, noutra pergunta. Sem passar adiante
                // o ATK de quem esta' atacando, aquela escolha caia no criterio
                // generico (o de maior ATK impresso) e batia justamente em quem
                // esta decisao acabou de recusar enfrentar.
                _atacanteAtk = meuAtk;
                return new BattlePlay(true, escolhido.index,
                    $"ATK {meuAtk} supera o alvo mais fraco ({maisFraco.code} vale {maisFraco.valor}) " +
                    $"— ataca com {escolhido.code}" +
                    (punidora != 0 ? $" [o mais barato que ainda vence: ele tem {punidora} baixada]" : ""));
            }

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
        /// <summary>
        /// A carta da MÃO que está parada por falta de corpo, e o corpo que a
        /// acordaria — também da mão.
        ///
        /// "Parada" aqui é literal: ela não está em `activatable`. A pergunta que
        /// o cérebro passa a fazer é a que faltava — *"eu tenho como pôr em campo
        /// o corpo que essa carta pede?"* —, e a resposta vale porque o corpo
        /// pedido é um monstro que também está na minha mão, esperando um ritual.
        /// </summary>
        (uint carta, uint corpo) ParadaPorFaltaDeCorpo(InteractiveDuel.Question q, int me)
        {
            foreach (uint c in _handOf(me))
            {
                if (q.activatable.Any(a => a.code == c)) continue;   // ela já pode sair
                var exige = _cards.ExigeCorpo(c);
                if (exige.raca == 0) continue;

                // Já tenho o corpo em campo? Então ela não está parada por isto —
                // está por outro motivo, e inventar um ritual não resolveria.
                bool jaTem = MonstrosFaceUp(me).Any(m => Serve(m, exige));
                if (jaTem) continue;

                uint naMao = _handOf(me).FirstOrDefault(m => Serve(m, exige));
                if (naMao != 0) return (c, naMao);
            }
            return (0, 0);
        }

        /// <summary>Este monstro é o corpo que a carta pede (raça e nível)?</summary>
        bool Serve(uint code, (uint raca, int nivel) exige)
        {
            var st = _cards.Stats(code);
            return st.IsMonster && (st.Race & exige.raca) != 0 && st.Level >= exige.nivel;
        }

        /// <summary>
        /// O ritual que traz o corpo capaz de acordar uma carta da mão.
        ///
        /// A escolha entre dois rituais precisa saber o que cada um pode invocar,
        /// e o Lua nem sempre diz: `Ritual.AddProcGreaterCode(c, 8, nil, 5405694)`
        /// nomeia a carta, mas o Chaos Form filtra por ARQUÉTIPO e não nomeia
        /// ninguém. Então a regra é conservadora: um ritual que nomeia códigos só
        /// serve se o corpo desejado estiver entre eles; um que não nomeia nenhum
        /// é candidato. Errar para menos aqui deixa a jogada como era antes —
        /// errar para mais gastaria o ritual e não acordaria nada.
        ///
        /// A escolha do MONSTRO vem depois, no `DecideSelect`: o motor pergunta
        /// qual invocar, e sem a marca ele cairia no critério genérico (o de maior
        /// ATK) e traria o Guerreiro de volta.
        /// </summary>
        Play? RitualQueAcorda(InteractiveDuel.Question q, int me)
        {
            var (carta, corpo) = ParadaPorFaltaDeCorpo(q, me);
            if (carta == 0) return null;

            var rituais = q.activatable.Where(a => EhRitual(a.code)).ToList();
            if (rituais.Count == 0) return null;

            var escolhido = rituais.FirstOrDefault(a =>
            {
                var nomeados = _cards.RitualInvoca(a.code);
                return nomeados.Count == 0 || nomeados.Contains(corpo);
            });
            if (escolhido.code == 0) return null;

            // Com um ritual só e ele servindo, isto não muda a jogada — mas o
            // `_proximoRitualCorpo` ainda importa: é ele que faz a ESCOLHA do
            // monstro sair certa.
            _proximoRitualCorpo = corpo;
            return new Play("activate", escolhido.index,
                $"Ritual {escolhido.code}: invoca {corpo} para acordar {carta}, que esta' parada na mao");
        }

        /// <summary>
        /// O corpo que o próximo ritual deve pôr em campo — decidido pela regra,
        /// cumprido pelo `DecideSelect`. Zero quando não há preferência.
        /// </summary>
        uint _proximoRitualCorpo;

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
            int atk = st.AtkValue, def = st.DefValue;

            // **O equipamento que está na minha mão faz parte desta conta.**
            //
            // A posição é decidida ANTES de a regra do equipamento rodar, e a
            // regra do equipamento só reforça quem está DE PÉ — então um corpo
            // que entra deitado nunca recebe o reforço que estava reservado para
            // ele, e o reforço nunca chega a existir. O relato foi exatamente
            // este: o inseto entrou em DEFESA e ganhou o equipamento assim
            // mesmo, ficando com ATK maior que o do monstro do jogador (número
            // que aquela batalha nem usa) e DEF abaixo do ATK dele.
            //
            // Somando o bônus antes de comparar, o mesmo inseto entra DE PÉ e o
            // equipamento passa a valer.
            var reforco = ReforcoNaMaoPara(code, me);
            if (reforco.bonus > 0)
            {
                atk += reforco.bonus;
                def += reforco.bonusDef;
                _log($"posicao de {code}: conta o {reforco.code} da minha mao " +
                     $"({st.AtkValue}/{st.DefValue} vira {atk}/{def})");
            }

            if (atk > def)
            {
                _log($"posicao de {code} ({atk}/{def}): ataque (ATK > DEF)");
                return POS_ATAQUE;
            }

            var (bate, porque) = BaterRendeMaisQueAParede(atk, def, 1 - me);
            _log($"posicao de {code} ({atk}/{def}): " +
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
        /// A próxima seleção é o corpo que o Foolish Burial vai ENTERRAR — posta
        /// pela regra 5.56 e consumida pelo `DecideSelect`. Mesmo padrão do
        /// `_proximoEquipDoDeck`.
        ///
        /// Sem ela a escolha cai no critério genérico (maior ATK impresso), que
        /// no deck do Yugi Chaos enterra o Black Luster Soldier — um Ritual, que
        /// nunca mais sai do cemitério. O combo vai junto, calado.
        /// </summary>
        bool _proximoEnterroDoDeck;

        /// <summary>
        /// A próxima seleção é o alvo de uma REMOÇÃO DE CAMPO (a Chaos Scepter
        /// Blast e a classe dela) — posta pela regra 5.505 ou pela janela de
        /// corrente, consumida pelo `DecideSelect`.
        ///
        /// Sem ela a lista — monstro e magia/armadilha dos DOIS lados — não casa
        /// com ramo nenhum e cai no critério genérico, que ordena por maior ATK
        /// **sem perguntar de quem é a carta**. Foi assim que o NPC baniu o
        /// próprio monstro de 2900.
        /// </summary>
        bool _remocaoDeCampo;

        /// <summary>
        /// De que eu precisava quando decidi enterrar — ver <see cref="PrecisoDe"/>.
        /// É o que separa as três razões para preferir um corpo a outro, e por
        /// isso mora aqui e não no `DecideSelect`: quem enxerga a mesa é a regra;
        /// a seleção só vê a lista de cartas que o motor ofereceu.
        /// </summary>
        PrecisoDe _enterroPara = PrecisoDe.Corpo;

        /// <summary>
        /// A magia/armadilha do oponente que a próxima remoção deve mirar —
        /// decidida por `AlvoDaRemocaoSt` e consumida pelo `DecideSelect`. Mesmo
        /// padrão do `_proximoAlvoEquipFraco`: a regra sabe o alvo certo, mas quem
        /// responde a seleção é a chamada seguinte.
        /// </summary>
        uint _proximoAlvoStPerigosa;

        /// <summary>
        /// O monstro que o Templo vai banir — decidido por `MotivoDoTemplo` e
        /// consumido pelo `DecideSelect`. Mesmo padrão do
        /// `_proximoAlvoStPerigosa`: sem isto a seleção cai no critério genérico
        /// (o de maior ATK) e o Templo baniria o monstro errado — justamente o
        /// que segurava o campo, em vez do que ia morrer sozinho.
        /// </summary>
        uint _proximoAlvoDoTemplo;

        /// <summary>
        /// A ZONA do meu monstro que deve receber o próximo equipamento —
        /// decidida por `MelhorEquipPor` e cumprida pelo `DecideSelect`. −1 =
        /// nenhuma.
        ///
        /// Sem isto as duas pontas discordavam em silêncio: a regra escolhia a
        /// carta pensando num alvo (o que está DE PÉ, onde o bônus de ATK rende)
        /// e a seleção seguinte caía no critério genérico — maior ATK impresso
        /// —, que é justamente o monstro deitado, para quem aquele bônus não
        /// vale nada.
        /// </summary>
        int _proximoAlvoDoEquip = -1;

        /// <summary>
        /// A próxima seleção de monstro MEU em campo é um CUSTO (o release da
        /// Insect Imitation), não um alvo: paga-se com o corpo mais barato, não
        /// com o melhor.
        ///
        /// O custo dela chega como `MSG_SELECT_CARD`, não como
        /// `MSG_SELECT_TRIBUTE` (é `Duel.SelectReleaseGroupCost`), então o ramo
        /// de tributo do `DecideSelect` não o via e a regra genérica —
        /// "alvo/reborn: o mais forte" — sacrificava o MAIOR monstro do campo.
        /// A regra 5.4 sempre disse, no comentário, que tributava o mais fraco;
        /// o código fazia o contrário, e nada acusava.
        /// </summary>
        bool _proximoTributoBarato;

        /// <summary>
        /// **O ATK vivo de quem acabou de declarar ataque** — −1 quando nao ha'
        /// ataque pendente.
        ///
        /// O ataque tem DOIS passos no motor: o `SELECT_BATTLECMD` escolhe o
        /// ATACANTE, e logo depois um `MSG_SELECT_CARD` escolhe o ALVO. A
        /// `DecideBattle` decidia atacar porque vencia o alvo **mais fraco** do
        /// outro lado, e a escolha do alvo caia no criterio generico do
        /// `DecideSelect` — *o de maior ATK IMPRESSO*. Duas pontas, duas contas:
        /// ele declarava contra o 1500 e batia no 2400 equipado.
        ///
        /// Era isto o relato *"se meu monstro tem uns 3 buff que aumentaram o
        /// ATK dele bastante, o NPC nao enxerga e decide atacar igual com um
        /// mais fraco"*: a leitura de ATK ao vivo ja' existia e estava certa —
        /// so' que quem escolhia em QUEM bater nao a usava.
        /// </summary>
        int _atacanteAtk = -1;

        /// <summary>Alvo legal do Templo: Nv≤4 e Fish/Sea Serpent/Aqua.</summary>
        bool AlcancadoPeloTemplo(uint code)
        {
            var st = _cards.Stats(code);
            return st.IsMonster && st.Level > 0 && st.Level <= 4
                   && (st.Race & (R_FISH | R_SEASERPENT | R_AQUA)) != 0;
        }

        /// <summary>
        /// Vale ativar o Templo AGORA — e em quem?
        ///
        /// A pergunta é uma só: "vou perder este monstro?". Banir sem motivo é
        /// pior que não fazer nada — o monstro sai do campo, deixa de bloquear, e
        /// só volta na End Phase de um turno MEU (`Duel.IsTurnPlayer(tp)` no Lua).
        /// Banido à toa no meu turno ele volta no fim dele e nada mudou; banido à
        /// toa no turno do oponente, eu fico sem bloqueador de graça.
        ///
        /// Dois motivos, nesta ordem:
        ///
        ///   A. **Condenado.** Instant Fusion e Ready Fusion trazem uma Fusão do
        ///      Extra que elas mesmas DESTROEM na End Phase. Banido, o monstro
        ///      não está em campo para ser destruído, e o Templo o devolve na
        ///      mesma End Phase — o corpo fica de vez. Neste deck só o Rare Fish
        ///      (Nv4, Fish) cabe nas duas regras: as outras quatro Fusões são
        ///      Nv5/6 e o Templo não as alcança.
        ///
        ///   B. **Ameaçado.** O oponente acabou de ativar algo que destrói
        ///      monstro. O efeito do Templo é RÁPIDO (`EFFECT_TYPE_QUICK_O`),
        ///      então sai no turno dele e o monstro escapa.
        ///
        /// E uma trava, que veio de ver o NPC jogando bem: se eu JÁ TENHO como
        /// trazer o monstro de volta — Torrential Reborn baixado, Premature Burial
        /// na mão — deixar morrer é melhor que banir. O Torrential Reborn revive
        /// E queima 500 por cabeça; o Templo só devolve. Gastar o uso do Templo
        /// aqui é abrir mão da jogada melhor.
        ///
        /// `_setStOf(me)` são as MINHAS cartas baixadas: não é leitura escondida
        /// nem depende do nível do NPC — são cartas dele, que ele mesmo baixou.
        /// </summary>
        (bool ativar, uint alvo, string porque) MotivoDoTemplo(int me, string gatilhoKind, uint gatilhoCode, int gatilhoPlayer)
        {
            // A MESMA oferta cobre duas coisas diferentes, e confundi-las custa a
            // carta inteira: enquanto o Templo está BAIXADO, o que o motor oferece
            // é a ativação da CARTA (o efeito de banir mora em `LOCATION_SZONE` e
            // exige que ela já esteja em campo). Pôr o Templo em campo é sempre
            // bom e não custa nada — o nome dele vira "Umi", que é o que liga o
            // The Legendary Fisherman. Tratar isso como "banir sem motivo" e
            // recusar deixaria o Templo baixado a partida inteira.
            if (_setStOf(me).Contains(FORGOTTEN_TEMPLE))
                return (true, 0, "poe o Templo em campo — o nome dele vira Umi e liga o Fisherman");

            var elegiveis = _fieldOf(me).Where(AlcancadoPeloTemplo).ToList();
            if (elegiveis.Count == 0) return (false, 0, null);

            bool podeReviver = _setStOf(me).Contains(TORRENTIAL_REBORN)
                               || NaMao(me, PREMATURE_BURIAL);

            // A. O corpo com prazo de validade — agora pela MARCA de verdade, e
            //    não mais pelo tipo da carta.
            //
            //    Antes ele era reconhecido por `TYPE_FUSION`, com o argumento de
            //    que "num deck sem Polymerization, uma Fusão em campo só pode ter
            //    vindo do Instant/Ready Fusion". O argumento vale para ESTE deck e
            //    para mais nenhum: num deck com Polymerization, o palpite mandaria
            //    banir o melhor corpo do campo — que ia FICAR — achando que o
            //    estava salvando de uma destruição que não viria.
            //
            //    Quem marca hoje é o motor, pelo que ACONTECEU: a carta que
            //    resolveu condena, e o monstro que chegou do Extra logo depois é
            //    ele (`InteractiveDuel._condenadas`).
            uint condenado = ZonasCondenadas(me)
                .Select(z => z.code)
                .FirstOrDefault(c => elegiveis.Contains(c));
            if (condenado != 0)
            {
                if (podeReviver)
                    return (false, 0, $"guarda o Templo: {condenado} morre na End Phase, mas eu a revivo sem gastar o uso");
                return (true, condenado, $"bane {condenado} antes da End Phase — ela seria destruida pela propria carta que a trouxe");
            }

            // B. O outro lado acabou de ativar destruição de monstro.
            //
            //    Com a Umi em campo, alguns dos meus são IMUNES A MAGIA — e banir
            //    um deles para escapar de uma magia é queimar o uso do Templo
            //    contra uma ameaça que não existe. Por isso a ameaça é filtrada
            //    contra cada candidato, e não julgada uma vez só.
            if (gatilhoKind == "activation" && gatilhoPlayer == 1 - me
                && gatilhoCode != 0 && Perfil(gatilhoCode).DestroiMonstro)
            {
                bool ameacaEhMagia = (_cards.Stats(gatilhoCode).Type & TYPE_SPELL) != 0;
                var expostos = elegiveis.Where(c => !(ameacaEhMagia && ImuneAMagia(c))).ToList();
                if (expostos.Count == 0)
                    return (false, 0, $"guarda o Templo: {gatilhoCode} e' magia e os meus estao imunes com a Umi em campo");

                uint salvar = expostos.OrderByDescending(c => _cards.Stats(c).AtkValue).First();
                return (true, salvar, $"bane {salvar} para escapar de {gatilhoCode}");
            }

            return (false, 0, null);
        }

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
            // O TEMPLO DO MAKO, antes da regra do corpo de graça — que é
            // justamente quem o disparava errado. Ver `MotivoDoTemplo`.
            var templo = q.choices.FirstOrDefault(c => c.code == FORGOTTEN_TEMPLE);
            if (templo.code == FORGOTTEN_TEMPLE)
            {
                var (ativar, alvo, porque) = MotivoDoTemplo(me, q.chainTriggerKind, q.chainTriggerCode, q.chainTriggerPlayer);
                if (ativar)
                {
                    _proximoAlvoDoTemplo = alvo;
                    _jaEncadeou = true;
                    PorqueDaCadeia = $"Templo: {porque}";
                    _log($"chain: {PorqueDaCadeia}");
                    return templo.index;
                }
                _log($"chain: guarda o Templo — {porque ?? "nenhum monstro meu esta' em risco"}");
            }

            // CORPO DE GRAÇA. A carta que tem regra própria fica de fora: o
            // Templo é marcado como INVOCAÇÃO ESPECIAL pelo banco (0x100000) por
            // causa do retorno na End Phase, e sem esta trava ele caía aqui como
            // "põe corpo em campo" — quando ativar TIRA um corpo do campo. Era o
            // que fazia o Mako banir o próprio monstro em toda janela de corrente.
            //
            // **A MESMA ARMADILHA, uma segunda vez, e agora lida da carta.** A
            // Chaos Scepter Blast também vem marcada como INVOCAÇÃO ESPECIAL — e
            // o corpo dela não vem de ATIVAR: vem de ela ser DESTRUÍDA pelo
            // oponente na zona de magia (`SalvaSeDestruida`, o mesmo leitor que a
            // regra 2.5 usa para decidir baixá-la). Ativar não põe corpo nenhum
            // em campo: bane 1 carta, e com o campo dele vazio essa carta é
            // minha. Foi o relato — *"usou o Chaos Scepter Blast no próprio
            // monstro, e era o de ATK maior no campo (2900)"*.
            //
            // Por ID seria a terceira lista a manter; pelo Lua vale para a
            // próxima carta que tiver essa forma, sem uma linha nova aqui.
            var corpoDeGraca = q.choices.FirstOrDefault(
                c => !CONTRA.ContainsKey(c.code) && !COM_REGRA_PROPRIA.Contains(c.code)
                     && Perfil(c.code).InvocaEspecial
                     && !_cards.SalvaSeDestruida(c.code));
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

                // Mesmo argumento para quem tem REGRA PRÓPRIA: ela já olhou e
                // disse não. A regra genérica abaixo parte de "o motor só abre a
                // janela no momento certo", e isso é falso para efeito de
                // `EVENT_FREE_CHAIN` — o Templo do Mako é oferecido em TODA
                // janela de corrente, e sem esta linha ele era ativado em todas.
                if (COM_REGRA_PROPRIA.Contains(c.code)) continue;

                // E MESMO ARGUMENTO, terceira vez, para quem COBRA UMA CARTA por
                // ativar. A Dark Factory of More Production é quick e free-chain:
                // ela aparece em TODA janela de corrente, e a regra genérica a
                // ativava em todas — cada vez pagando um monstro por 1 compra.
                // Vista no log de um duelo real, três vezes na mesma partida.
                //
                // Não é "nunca use": no Main Phase ela continua passando pela
                // regra 0.15, que pesa o custo. O que não pode é sair no reflexo
                // de uma janela que o motor abre por outro motivo qualquer.
                if (Perfil(c.code).Descarta)
                {
                    _log($"chain: nao gasto {c.code} numa janela qualquer — ela cobra uma carta, " +
                         "e o Main Phase decide isso com criterio");
                    continue;
                }

                // E MESMO ARGUMENTO, quarta vez, para quem ALCANCA O CAMPO DOS
                // DOIS LADOS. A regra logo abaixo e' a mais crua do arquivo —
                // "ativa em resposta", sem criterio nenhum — e ela parte de que o
                // motor so' abre a janela no momento certo. Para um efeito
                // `EVENT_FREE_CHAIN` isso e' falso: a janela abre sempre.
                //
                // Com o campo dele VAZIO, uma carta que tira do campo so' alcanca
                // as MINHAS — e o `DecideSelect` generico, que ordena por maior
                // ATK sem perguntar de quem e', escolhe o meu melhor monstro. Foi
                // exatamente o relato, e o log do duelo o mostra inteiro: Monster
                // Reborn traz um 2900, ele ataca, e na janela seguinte a Chaos
                // Scepter Blast bane esse mesmo 2900.
                //
                // O Main Phase ja' faz esta conta (a regra 5.5 exige campo dele
                // com carta); a janela de corrente nao fazia nenhuma.
                if (_cards.TiraDoCampoDosDoisLados(c.code) && !ValeBanirDoCampoDele(foe))
                {
                    _log($"chain: guarda {c.code} — no campo dele nao ha' nada que valha a " +
                         "remocao (a magia que ele acabou de ativar vai para o cemiterio " +
                         "sozinha); a unica coisa que ela alcancaria sou eu");
                    continue;
                }

                if (!REMOCAO_ST.Contains(c.code))
                {
                    // A marca so' vale para quem TIRA do campo: e' ela que diz ao
                    // `DecideSelect` que a pergunta seguinte e' uma remocao.
                    _remocaoDeCampo = _cards.TiraDoCampoDosDoisLados(c.code);
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
                // O CORPO CONDENADO nao entra nesta conta, dos dois lados. Ela
                // responde "quem ganha a batalha?", e ele nao briga: o motor nao o
                // deixa atacar (`EFFECT_CANNOT_ATTACK`) e ele morre na End Phase
                // deste turno, entao nem chega ao turno seguinte para defender.
                // Contando-o, o NPC concluia que dominava a mesa e guardava a
                // trava e o reforco — com o campo ficando vazio logo depois.
                if (_corpoCondenado(player, m.seq)) continue;
                int atk = AtkEmCampo(m.code, player, m.seq);
                if (atk > max) max = atk;
            }
            return max;
        }
    }
}

/**
 * Lista 1 — o pool restrito da primeira fase (jogador e os 3 NPCs jogam só com
 * isto): todos os monstros Normais (vanilla) + esta seleção de magia/armadilha.
 *
 * Todas as cartas daqui são REAIS e clássicas, escolhidas por serem simples e
 * fáceis de "adaptar" — e como já existem no ocgcore, o Lua delas já roda no
 * motor sem precisarmos escrever efeito nenhum.
 */

export const LISTA1_SPELLTRAP = [
  // --- núcleo (staples) ---
  44095762, // Mirror Force (Normal Trap)
  12580477, // Raigeki
  83764718, // Monster Reborn
  55144522, // Pot of Greed
  18144506, // Harpie's Feather Duster
  5318639,  // Mystical Space Typhoon
  60082869, // Dust Tornado (Normal Trap)

  // --- magias gerais ---
  53129443, // Dark Hole
  72302403, // Swords of Revealing Light
  66788016, // Fissure
  79759861, // Tribute to The Doomed
  72892473, // Card Destruction
  95281259,  // The Warrior Returning Alive
  70828912, // Premature Burial
  13048472, // Pre-Preparation of Rites

  // --- o pacote "Normal grande" ---
  //
  // As duas andam juntas: a Art acha o corpo no deck, as Regras o põem em campo
  // SEM tributo e sem gastar a Invocação Normal do turno. Separadas valem pouco.
  //
  // Elas são o que faz um deck vanilla competir nesta Lista, que é feita de
  // monstros Normais: sem uma forma de baixar um Nv7 de graça, todo Normal
  // grande é carta morta na mão esperando dois tributos.
  10667321, // Ancient Rules — Invocação Especial de 1 Normal Nv5+ da mão
  79816536, // Summoner's Art — busca 1 Normal Nv5+ do deck

  // --- armadilhas ---
  4206964,  // Trap Hole
  62279055, // Magic Cylinder
  12607053, // Waboku
  14315573, // Negate Attack (Counter Trap)
  56120475, // Sakuretsu Armor
  97077563, // Call of the Haunted — revive 1 monstro do cemitério (Armadilha Contínua)

  // --- as duas primeiras coleções do TCG ---
  // Legend of Blue Eyes White Dragon (LOB, 1x2002) e Metal Raiders (MRD,
  // 6x2002): as magias/armadilhas dessas duas coleções que ainda faltavam.
  // A lista de cada coleção veio do ygoprodeck (o mesmo banco de onde saem as
  // artes) e cada id abaixo foi conferido no `ygo-data` — todas têm script Lua
  // no ocgcore, então o efeito roda de verdade, nada é decorativo.
  // O que NÃO está aqui já estava na Lista 1 (os dois ciclos de equipamento,
  // os campos, o burn, Raigeki/Dark Hole/Pot of Greed/Mirror Force...).

  // LOB
  50045299, // Dragon Capture Jar — todo Dragão do campo vira Defesa e trava lá
  63102017, // Stop Defense — passa 1 monstro do oponente para Ataque
  83887306, // Two-Pronged Attack — destrói 2 monstros SEUS e 1 do oponente
  51482758, // Remove Trap — destrói 1 armadilha com a face para cima
  82542267, // Gravedigger Ghoul — bane até 2 monstros do cemitério do oponente
  38199696, // Red Medicine — +500 LP
  11868825, // Goblin's Secret Remedy — +600 LP

  // MRD — controle e destruição
  4031928,  // Change of Heart — toma 1 monstro do oponente até a End Phase
  19613556, // Heavy Storm — destrói TODA magia/armadilha do campo (os dois lados)
  56830749, // Share the Pain — você tributa 1 monstro, o oponente também
  25880422, // Block Attack — passa 1 monstro do oponente para Defesa
  52097679, // Shield & Sword — troca ATK e DEF originais de todos até o fim do turno
  5758500,  // Soul Release — bane até 5 cartas de qualquer cemitério
  41142615, // The Cheerful Coffin — descarta até 3 monstros da mão (alimenta
            // Monster Reborn / Call of the Haunted / Premature Burial)
  90219263, // Elegant Egotist — com 1 "Harpie Lady" em campo, Invoca Especialmente
            // 1 Harpie Lady/Harpie Lady Sisters da mão OU DO DECK (as duas são
            // Normais, já entram pela regra do `inLista1`)

  // MRD — armadilhas de contra (a primeira negação da Lista 1)
  41420027, // Solemn Judgment — paga metade dos LP e nega invocação OU magia/armadilha
  77414722, // Magic Jammer — descarta 1 carta e nega 1 Magia
  3819470,  // Seven Tools of the Bandit — paga 1000 LP e nega 1 Armadilha
  98069388, // Horn of Heaven — tributa 1 monstro e nega 1 invocação
  3027001,  // Fake Trap — se armadilhas suas seriam destruídas, morre no lugar delas
  88279736, // Robbin' Goblin — dano de batalha faz o oponente descartar 1 carta

  // MRD — equipamentos (inclusive os que se equipam no monstro do OPONENTE)
  83225447, // Stim-Pack — +700 ATK, mas −200 a cada Standby sua
  98495314, // Sword of Deep-Seated — +500 ATK/DEF e volta pro topo do deck ao ir pro cemitério
  20436034, // Ring of Magnetism — −500 ATK/DEF no equipado, e o oponente só pode atacar ele
  50152549, // Paralyzing Potion — o equipado (não-Máquina) não pode atacar
  24668830, // Germ Infection — o equipado (não-Máquina) perde 300 ATK a cada Standby dele

  // --- equipamentos clássicos: +300 ATK/DEF por TIPO ---
  // O ciclo inteiro da era clássica, um equipamento por Tipo de monstro.
  // Pouco ATK, bem básicos, e todos com Lua pronto no ocgcore.
  1435851,  // Dragon Treasure — Dragão
  91595718, // Book of Secret Arts — Mago
  61854111, // Legendary Sword — Guerreiro
  46009906, // Beast Fangs — Besta
  25769732, // Machine Conversion Factory — Máquina
  77007920, // Laser Cannon Armor — Inseto
  77027445, // Power of Kaishin — Aqua (o TIPO Aqua, não o atributo ÁGUA)
  51267887, // Raise Body Heat — Dinossauro
  39774685, // Vile Germs — Planta
  15052462, // Violet Crystal — Zumbi (o "cristal roxo")
  1557499,  // Silver Bow and Arrow — Fada
  4614116,  // Dark Energy — Demônio
  37820550, // Electro-Whip — Trovão
  98252586, // Follow Wind — Besta Alada
  36607978, // Mystical Moon — Besta-Guerreira

  // --- equipamentos clássicos: +400 ATK / −200 DEF por ATRIBUTO ---
  // O outro ciclo da mesma era; estes seis fecham a série (um por atributo).
  37120512, // Sword of Dark Destruction — TREVAS
  2370081,  // Steel Shell — ÁGUA
  18937875, // Burning Spear — FOGO
  39897277, // Elf's Light — LUZ
  55321970, // Gust Fan — VENTO
  98374133, // Invigoration — TERRA

  // --- equipamento clássico avulso (fora dos dois ciclos) ---
  32268901, // Salamandra — +700 de ATK a monstro de FOGO

  // --- burn simples (dano fixo) ---
  19523799, // Ookazi (800)
  46130346, // Hinotama (500)
  76103675, // Sparks (200)
  73134081, // Final Flame (600)
  46918794, // Tremendous Fire (1000/500)

  // --- campos básicos (terreno) ---
  59197169, // Yami
  87430998, // Forest
  50913601, // Mountain
  86318356, // Sogen
  22702055, // Umi
  23424603, // Wasteland

  // --- golpes assinatura dos monstros dos NPCs ---
  2314238,  // Dark Magic Attack — Dark Magician (Yugi)
  63391643, // Thousand Knives — Dark Magician (Yugi)
  17655904, // Burst Stream of Destruction — Blue-Eyes White Dragon (Kaiba)
  52684508, // Inferno Fire Blast — Red-Eyes Black Dragon (Joey)

  // --- fusão ---
  // A Polymerization é o único "motor" de fusão de que a Lista 1 precisa: a
  // receita de cada monstro fundido mora no Lua da PRÓPRIA carta fundida, não
  // aqui. Ver `inLista1` no fim deste arquivo.
  24094653, // Polymerization
  26902560, // Fusion Sage — busca 1 Polymerization no deck (consistência da fusão)
  32807846, // Reinforcement of the Army — busca 1 Guerreiro Nv≤4 do deck

  // Substitutos de matéria. Não são vanilla (têm efeito), mas o efeito já vem
  // pronto do ocgcore: cada um declara `EFFECT_FUSION_SUBSTITUTE` no PRÓPRIO
  // script, e o motor os aceita no lugar de qualquer matéria nomeada. Valem da
  // mão, do campo E do cemitério.
  79109599, // King of the Swamp — substituto + descarta para buscar Polymerization
  30451366, // Mystical Sheep #1 — só substituto
  71625222, // Time Wizard (Mago do Tempo) — sorteio de moeda: destrói monstros do oponente ou do próprio campo
  50259460, // Versago the Destroyer — só substituto
  53493204, // Goddess with the Third Eye — só substituto
  99426834, // Beastking of the Swamp — só substituto
  31786629, // thunder dragon

  // --- Sincro / Xyz (teste) ---
  // Nem Sincro nem Xyz são Normal/Fusion, então `inLista1` não pega sozinho —
  // precisam entrar aqui explicitamente, um por um.
  44508094, // Stardust Dragon — Sincro Nv8 (Tuner + não-Tuner somando 8)
  // Rose, Warrior of Revenge — Tuner Nv4 (material do Stardust, com Battle Ox).
  // NÃO é Debris Dragon (a escolha "óbvia", por ser Dragão como o Stardust):
  // ele registra `EFFECT_CANNOT_BE_SYNCHRO_MATERIAL` no próprio script
  // (c14943837.lua) e barra a invocação mesmo com material de sobra — medido
  // empiricamente no `--test-synchro`. Rose não tem essa restrição.
  1557341,  // Rose, Warrior of Revenge
  84013237, // Number 39: Utopia — Xyz Rank 4 (2 materiais Nv4, ex.: 2x Battle Ox)

  // --- Toon (o deck do Pegasus) ---
  // Toon World habilita os dois lados do pacote: os Toons "clássicos" abaixo
  // só entram por Invocação-Especial (spsummon) enquanto ele está em campo, e
  // os "modernos" (Normais/tributo comuns) ganham ataque direto e são
  // destruídos junto se ele sair. Tudo script real do ocgcore — ver
  // `--test-toon` e `duel-server/src/NpcBrain.cs`.
  15259703, // Toon World (Magia Contínua) — ativa pagando 1000 LP
  89997728, // Toon Table of Contents — busca 1 carta "Toon" do deck (Toon World primeiro)
  // Clássicos: "Não pode ser Invocado/Set normalmente. Invoca-se por Invocação
  // Especial da MÃO enquanto controla Toon World" (alguns pedem tributo).
  65458948, // Toon Mermaid (Nv4 1400/1500) — sem tributo
  91842653, // Toon Summoned Skull (Nv6 2500/1200) — tributa 1 monstro
  90960358, // Toon Dark Magician Girl (Nv6 2000/1700) — tributa 1 monstro
  53183600, // Blue-Eyes Toon Dragon (Nv8 3000/2500) — tributa 2 monstros
  // Modernos: Invocação Normal comum (com tributo se o nível pedir); o bônus
  // Toon (ataque direto, destruído se Toon World sair) vem de graça no Lua.
  42386471, // Toon Gemini Elf (Nv4 1900/900)
  79875176, // Toon Cannon Soldier (Nv4 1400/1300)
  16392422, // Toon Masked Sorcerer (Nv4 900/1400)
  15270885, // Toon Goblin Attack Force (Nv4 2300/0)
  83629030, // Toon Cyber Dragon (Nv5 2100/1600) — 1 tributo
  21296502, // Toon Dark Magician (Nv7 2500/2100) — 1 tributo
  31733941, // Red-Eyes Toon Dragon (Nv7 2400/2000) — 1 tributo
  28112535, // Toon Barrel Dragon (Nv7 2600/2200) — 1 tributo
  61190918, // Toon Buster Blader (Nv7 2600/2300) — 1 tributo
  7171149,  // Toon Ancient Gear Golem (Nv8 3000/3000) — 2 tributos

  // --- linha da Mariposa (o deck do Weevil) ---
  // O Petit Moth (Nv1 300/200) é vanilla e já entra sozinho pela regra do
  // `inLista1`; o resto da evolução não é, mas nenhum efeito precisa ser
  // escrito: a contagem de turnos dentro do casulo mora no Lua da própria
  // carta no ocgcore. Equipe o Cocoon num Petit Moth e, conforme os SEUS
  // turnos passam, ele pode ser tributado por uma mariposa cada vez maior.
  40240595, // Cocoon of Evolution (Nv3 0/2000) — equipa-se da mão a 1 Petit
            // Moth; enquanto equipado, o Petit Moth usa o ATK/DEF do casulo
  87756343, // Larvae Moth (Nv2 500/400) — 2º turno dentro do casulo
  14141448, // Great Moth (Nv8 2600/2500) — 4º turno
  48579379, // Perfectly Ultimate Great Moth (Nv8 3500/3000) — 6º turno
  96965364, // Insect Imitation — tributa 1 monstro e invoca especialmente do
            // DECK 1 Inseto de nível +1 (o atalho pra chegar no casulo)
  3492538,  // Insect Armor with Laser Cannon — equipamento de Inseto (+700).
            // Não é o mesmo que Laser Cannon Armor (77007920, +300), lá em cima

  // --- rituais SEM efeito (vanilla) ---
  5405694,  // Black Luster Soldier (Nv 8, 3000/2500)
  65393205, // Chakra (Nv 7, 2450/2000)
  91782219, // Crab Turtle (Nv 8, 2550/2500)
  99721536, // Dokurorider (Nv 6, 1900/1850)
  31890399, // Fiend's Mirror (Nv 6, 2100/1800)
  62337487, // Fortress Whale (Nv 7, 2350/2150)
  90844184, // Garma Sword (Nv 7, 2550/2150)
  30243636, // Hungry Burger (Nv 6, 2000/1850)
  26932788, // Javelin Beetle (Nv 8, 2450/2550)
  30208479, // Magician of Black Chaos (Nv 8, 2800/2600)
  4849037,  // Performance of Sword (Nv 6, 1950/1850)
  3627449,  // Skull Guardian (Nv 7, 2050/2500)
  33951077, // Super War-Lion (Nv 7, 2300/2100)
  49064413, // The Masked Beast (Nv 8, 3200/1800)
  69123138, // Zera the Mant (Nv 8, 2800/2300)

  // --- magias de ritual correspondentes ---
  14094090, // Super Soldier Ritual
  21082832, // Chaos Form
  31066283, // Revival of Dokurorider
  39399168, // Resurrection of Chakra
  41182875, // Javelin Beetle Pact
  43417563, // Commencement Dance
  43694075, // Novox's Prayer
  45948430, // Super Soldier Synthesis
  52472775, // Prayers of the Voiceless Voice
  54539105, // War-Lion Ritual
  55761792, // Black Luster Ritual
  76792184, // Black Magic Ritual
  76806714, // Turtle Oath
  77454922, // Fortress Whale's Oath
  78577570, // Garma Sword Oath
  80811661, // Hamburger Recipe
  81756897, // Zera Ritual
  81933259, // Beastly Mirror Ritual
  94377247, // Curse of the Masked Beast
];

/**
 * Os TIPOS de monstro que entram por REGRA (casamento exato com o `tl` do
 * índice), sem precisar listar id por id.
 *
 * Monstro Normal entra por não ter efeito nenhum — nada a implementar.
 *
 * Fusão VANILLA (`tl === 'Fusion Monster'`, sem "/Effect") entra pelo mesmo
 * motivo, e isso é menos óbvio: ela tem script `.lua`, mas o script só declara
 * a RECEITA (`Fusion.AddProcMix(...)`), não um efeito. Como o script já vem do
 * ocgcore, a carta funciona sem escrevermos nada. São 58 fusões nessa condição,
 * todas com script — conferido contra a pasta de scripts.
 *
 * Elas precisam da Polymerization (24094653), que está na lista de magias, e do
 * Extra Deck sendo enviado ao motor (`extra` no POST /start).
 *
 * O casamento é EXATO de propósito: `Tuner/Normal Monster` e
 * `Pendulum/Normal Monster` NÃO entram por "Normal Monster". Um `includes()`
 * aqui mudaria a Lista 1 em silêncio (mais 51 cartas) só por causa de uma
 * mudança de estilo.
 */
export const LISTA1_TIPOS = ['Normal Monster', 'Fusion Monster'];

// ---------------------------------------------------------------------------
// Estado VIVO. As duas constantes acima são o padrão de fábrica (o que viaja
// dentro do `.exe`); o editor da Área de Teste (`web/listas.html`) publica a
// lista no Supabase e `aplicarLista1` a instala aqui no boot. Sem isso, o
// cliente conferiria contra a lista embutida e o servidor contra a publicada —
// e a divergência só apareceria na hora de salvar um deck.
//
// `inLista1` continua SÍNCRONA (é chamada dentro de `filter` no pool inteiro);
// quem hidrata é `cardlists.js`, uma vez por página.
// ---------------------------------------------------------------------------
let SET = new Set(LISTA1_SPELLTRAP);
let TIPOS = new Set(LISTA1_TIPOS);

/** A carta (entrada do índice) faz parte da Lista 1? */
export function inLista1(card) {
  if (SET.has(card.id)) return true;
  if (card.t !== 'M') return false;
  return TIPOS.has(card.tl);
}

/** O conteúdo atual da Lista 1, no formato que o editor edita e publica. */
export function fonteDaLista1() {
  return { tipos: [...TIPOS], ids: [...SET] };
}

/**
 * Troca o conteúdo da Lista 1. Campo ausente mantém o que já estava — assim
 * uma publicação só com `ids` não zera os tipos por engano.
 */
export function aplicarLista1(fonte) {
  if (!fonte || typeof fonte !== 'object') return;
  if (Array.isArray(fonte.tipos)) TIPOS = new Set(fonte.tipos.map(String));
  if (Array.isArray(fonte.ids)) SET = new Set(fonte.ids.map(Number).filter(Number.isFinite));
}

/** Volta ao padrão de fábrica (usado pelo botão "restaurar" do editor). */
export function restaurarLista1() {
  SET = new Set(LISTA1_SPELLTRAP);
  TIPOS = new Set(LISTA1_TIPOS);
}

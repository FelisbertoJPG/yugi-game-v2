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

  // --- armadilhas ---
  4206964,  // Trap Hole
  62279055, // Magic Cylinder
  12607053, // Waboku
  14315573, // Negate Attack (Counter Trap)
  56120475, // Sakuretsu Armor

  // --- equipamentos por tipo (pouco ATK, bem básicos) ---
  1435851,  // Dragon Treasure — Dragão
  91595718, // Book of Secret Arts — Mago
  61854111, // Legendary Sword — Guerreiro
  46009906, // Beast Fangs — Besta
  25769732, // Machine Conversion Factory — Máquina
  77007920, // Laser Cannon Armor — Inseto
  77027445, // Power of Kaishin — ÁGUA
  51267887, // Raise Body Heat — Dinossauro
  32268901, // Salamandra — FOGO
  37120512, // Sword of Dark Destruction — TREVAS
  39774685, // Vile Germs — Planta

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

const SET = new Set(LISTA1_SPELLTRAP);

/** A carta (entrada do índice) faz parte da Lista 1? */
export function inLista1(card) {
  return SET.has(card.id) || (card.t === 'M' && card.tl === 'Normal Monster');
}

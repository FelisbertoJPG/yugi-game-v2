/**
 * Decodificadores dos bitfields do ocgcore.
 *
 * Só é necessário se você for ler o `cards.cdb` cru (via sql.js no browser,
 * node:sqlite, etc). Se você usar o `cards.json` gerado pelo build.py, os
 * dados já vêm decodificados e este módulo é opcional.
 *
 * Os valores abaixo vêm de `data/constants.json`, que por sua vez é parseado
 * de `script/constant.lua` — a fonte de verdade do próprio motor.
 */

export const TYPE = {
  MONSTER: 0x1, SPELL: 0x2, TRAP: 0x4, NORMAL: 0x10, EFFECT: 0x20,
  FUSION: 0x40, RITUAL: 0x80, TRAPMONSTER: 0x100, SPIRIT: 0x200,
  UNION: 0x400, GEMINI: 0x800, TUNER: 0x1000, SYNCHRO: 0x2000,
  TOKEN: 0x4000, MAXIMUM: 0x8000, QUICKPLAY: 0x10000, CONTINUOUS: 0x20000,
  EQUIP: 0x40000, FIELD: 0x80000, COUNTER: 0x100000, FLIP: 0x200000,
  TOON: 0x400000, XYZ: 0x800000, PENDULUM: 0x1000000, SPSUMMON: 0x2000000,
  LINK: 0x4000000, SKILL: 0x8000000,
};

export const ATTRIBUTE = {
  EARTH: 0x1, WATER: 0x2, FIRE: 0x4, WIND: 0x8,
  LIGHT: 0x10, DARK: 0x20, DIVINE: 0x40,
};

export const RACE = {
  WARRIOR: 0x1, SPELLCASTER: 0x2, FAIRY: 0x4, FIEND: 0x8, ZOMBIE: 0x10,
  MACHINE: 0x20, AQUA: 0x40, PYRO: 0x80, ROCK: 0x100, WINGEDBEAST: 0x200,
  PLANT: 0x400, INSECT: 0x800, THUNDER: 0x1000, DRAGON: 0x2000,
  BEAST: 0x4000, BEASTWARRIOR: 0x8000, DINOSAUR: 0x10000, FISH: 0x20000,
  SEASERPENT: 0x40000, REPTILE: 0x80000, PSYCHIC: 0x100000, DIVINE: 0x200000,
  CREATORGOD: 0x400000, WYRM: 0x800000, CYBERSE: 0x1000000,
  ILLUSION: 0x2000000,
};

export const LINK_MARKER = {
  BOTTOM_LEFT: 0x1, BOTTOM: 0x2, BOTTOM_RIGHT: 0x4, LEFT: 0x8,
  RIGHT: 0x20, TOP_LEFT: 0x40, TOP: 0x80, TOP_RIGHT: 0x100,
};

/** Zonas — usadas nas mensagens do motor durante o duelo. */
export const LOCATION = {
  DECK: 0x1, HAND: 0x2, MZONE: 0x4, SZONE: 0x8, GRAVE: 0x10,
  REMOVED: 0x20, EXTRA: 0x40, OVERLAY: 0x80,
};

/** Posições de carta. */
export const POS = {
  FACEUP_ATTACK: 0x1, FACEDOWN_ATTACK: 0x2,
  FACEUP_DEFENSE: 0x4, FACEDOWN_DEFENSE: 0x8,
};

/** Valor sentinela do ygopro para ATK/DEF "?" */
export const UNKNOWN_STAT = -2;

const RACE_LABELS = {
  WARRIOR: 'Warrior', SPELLCASTER: 'Spellcaster', FAIRY: 'Fairy',
  FIEND: 'Fiend', ZOMBIE: 'Zombie', MACHINE: 'Machine', AQUA: 'Aqua',
  PYRO: 'Pyro', ROCK: 'Rock', WINGEDBEAST: 'Winged Beast', PLANT: 'Plant',
  INSECT: 'Insect', THUNDER: 'Thunder', DRAGON: 'Dragon', BEAST: 'Beast',
  BEASTWARRIOR: 'Beast-Warrior', DINOSAUR: 'Dinosaur', FISH: 'Fish',
  SEASERPENT: 'Sea Serpent', REPTILE: 'Reptile', PSYCHIC: 'Psychic',
  DIVINE: 'Divine-Beast', CREATORGOD: 'Creator God', WYRM: 'Wyrm',
  CYBERSE: 'Cyberse', ILLUSION: 'Illusion',
};

/** Retorna os nomes das flags ativas em `value`. */
export function decodeFlags(value, table) {
  const out = [];
  for (const [name, bit] of Object.entries(table)) {
    if ((value & bit) === bit && bit !== 0) out.push(name);
  }
  return out;
}

/** O campo `level` do cdb empacota nível + escalas de Pêndulo. */
export function decodeLevel(level) {
  return {
    level: level & 0xff,
    // Convenção do ygopro: lscale nos bits 24-31, rscale nos bits 16-23.
    lscale: (level >>> 24) & 0xff,
    rscale: (level >>> 16) & 0xff,
  };
}

/** Em monstros Link, o campo `def` guarda os link markers, não a defesa. */
export function decodeLinkMarkers(def) {
  return decodeFlags(def, LINK_MARKER);
}

/** O `setcode` empacota até 4 arquétipos de 16 bits cada. */
export function decodeSetcodes(setcode) {
  const out = [];
  // BigInt: setcode pode passar de 32 bits.
  let v = BigInt(setcode);
  for (let i = 0; i < 4; i++) {
    const part = Number((v >> BigInt(16 * i)) & 0xffffn);
    if (part) out.push(part);
  }
  return out;
}

/** `ot` é um bitfield de legalidade. */
export function decodeLegality(ot) {
  const out = [];
  if (ot & 0x1) out.push('OCG');
  if (ot & 0x2) out.push('TCG');
  return out;
}

export function raceLabel(race) {
  const [first] = decodeFlags(race, RACE);
  return first ? (RACE_LABELS[first] ?? first) : null;
}

export function attributeLabel(attribute) {
  const [first] = decodeFlags(attribute, ATTRIBUTE);
  return first ?? null;
}

/** Converte uma linha crua de `datas` + `texts` no mesmo formato do cards.json. */
export function decodeRow(row) {
  const types = decodeFlags(row.type, TYPE);
  const isMonster = types.includes('MONSTER');
  const isLink = types.includes('LINK');
  const isPendulum = types.includes('PENDULUM');
  const { level, lscale, rscale } = decodeLevel(row.level);

  const card = {
    id: row.id,
    name: row.name,
    desc: row.desc,
    types,
    legal: decodeLegality(row.ot),
    alias: row.alias,
    archetypes: decodeSetcodes(row.setcode),
  };

  if (isMonster) {
    card.atk = row.atk;
    card.def = isLink ? null : row.def;
    card.level = level;
    card.levelLabel = isLink ? 'Link' : types.includes('XYZ') ? 'Rank' : 'Level';
    card.attribute = attributeLabel(row.attribute);
    card.race = raceLabel(row.race);
    card.scales = isPendulum ? { left: lscale, right: rscale } : null;
    card.linkMarkers = isLink ? decodeLinkMarkers(row.def) : null;
  }

  return card;
}

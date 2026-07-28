/**
 * Cartas customizadas — importadas do formato de um "card maker" (gerador de
 * imagem, ex.: yugioh-card-maker) para dentro do Deck Builder.
 *
 * O que dá e o que NÃO dá para importar:
 *   - Dá: nome, categoria, atributo, raça, ATK/DEF, subtipo de magia/armadilha,
 *     texto e a arte. Vira o "esqueleto" da carta.
 *   - Não dá: a LÓGICA do efeito. O motor (ocgcore) roda Lua, e o card maker
 *     não gera Lua. Por isso toda carta importada nasce com a tag `sem-efeito`.
 *
 * A arte crua vem em base64 (2 a 3 MB por carta). Guardar isso no localStorage
 * estoura a cota (~5 MB), então reduzimos para um JPEG compacto no import.
 *
 * Persistência: localStorage, igual aos decks (storage.js). Preso ao navegador.
 */

const KEY = 'ygo:customCards';
const ID_BASE = 900000000; // acima do maior id real (~1e8), dentro do uint32 do motor

// ----------------------------------------------------------- armazenamento

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? [] : JSON.parse(raw);
  } catch {
    return [];
  }
}

function write(cards) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards));
    return true;
  } catch (e) {
    console.error('[customcards] falha ao gravar (cota do localStorage?)', e);
    return false;
  }
}

/** @returns {object[]} todas as cartas customizadas salvas. */
export function listCustom() {
  return read();
}

export function getCustom(id) {
  id = Number(id);
  return read().find((c) => c.id === id) ?? null;
}

/** Próximo id livre na faixa customizada. */
export function nextCustomId() {
  const max = read().reduce((m, c) => Math.max(m, c.id), ID_BASE);
  return max + 1;
}

/**
 * Insere ou atualiza uma carta. Se não tiver id, recebe um novo na faixa custom.
 * @returns {object} a carta salva (com id).
 */
export function saveCustom(card) {
  const cards = read();
  if (!card.id) card.id = nextCustomId();
  const i = cards.findIndex((c) => c.id === card.id);
  if (i === -1) cards.push(card);
  else cards[i] = card;
  write(cards);
  return card;
}

export function deleteCustom(id) {
  id = Number(id);
  const cards = read().filter((c) => c.id !== id);
  return write(cards);
}

// ----------------------------------------------------------- mapeamentos

// Moldura do card maker -> categoria de jogo + "espécie" do monstro.
const FRAME = {
  normal: { cat: 'Monster', kind: 'Normal' },
  effect: { cat: 'Monster', kind: 'Effect' },
  ritual: { cat: 'Monster', kind: 'Ritual' },
  fusion: { cat: 'Monster', kind: 'Fusion' },
  synchro: { cat: 'Monster', kind: 'Synchro' },
  xyz: { cat: 'Monster', kind: 'Xyz' },
  link: { cat: 'Monster', kind: 'Link' },
  pendulum: { cat: 'Monster', kind: 'Pendulum' },
  spell: { cat: 'Spell', kind: null },
  trap: { cat: 'Trap', kind: null },
};

// Subtipo de magia/armadilha (campo `sf`) -> rótulo.
const SUBTYPE = {
  NORMAL: 'Normal', CONTINUOUS: 'Continuous', FIELD: 'Field', EQUIP: 'Equip',
  'QUICK-PLAY': 'Quick-Play', RITUAL: 'Ritual', COUNTER: 'Counter',
};

// Raças em PT (o card maker localiza) -> canônico em inglês, como no banco.
const RACE_PT = {
  'Maquina': 'Machine', 'Máquina': 'Machine', 'Dragao': 'Dragon', 'Dragão': 'Dragon',
  'Guerreiro': 'Warrior', 'Mago': 'Spellcaster', 'Feiticeiro': 'Spellcaster',
  'Fada': 'Fairy', 'Demonio': 'Fiend', 'Demônio': 'Fiend', 'Zumbi': 'Zombie',
  'Besta': 'Beast', 'Besta Alada': 'Winged Beast', 'Aqua': 'Aqua', 'Peixe': 'Fish',
  'Inseto': 'Insect', 'Planta': 'Plant', 'Rocha': 'Rock', 'Reptil': 'Reptile',
  'Réptil': 'Reptile', 'Trovao': 'Thunder', 'Trovão': 'Thunder', 'Dinossauro': 'Dinosaur',
  'Serpente Marinha': 'Sea Serpent', 'Piroxeno': 'Pyro', 'Psiquico': 'Psychic',
  'Psíquico': 'Psychic', 'Guerreiro-Fera': 'Beast-Warrior', 'Divindade': 'Divine-Beast',
};

/** Raças canônicas para o datalist do formulário. */
export const RACES = [
  'Aqua', 'Beast', 'Beast-Warrior', 'Cyberse', 'Dinosaur', 'Divine-Beast',
  'Dragon', 'Fairy', 'Fiend', 'Fish', 'Insect', 'Machine', 'Plant', 'Psychic',
  'Pyro', 'Reptile', 'Rock', 'Sea Serpent', 'Spellcaster', 'Thunder', 'Warrior',
  'Winged Beast', 'Wyrm', 'Zombie',
];

export const ATTRIBUTES = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];
export const MONSTER_KINDS = ['Normal', 'Effect', 'Ritual', 'Fusion', 'Synchro', 'Xyz', 'Link', 'Pendulum'];
export const SUBTYPES = Object.values(SUBTYPE);

const EXTRA_KINDS = new Set(['Fusion', 'Synchro', 'Xyz', 'Link']);

/** Monta o typeLabel no formato que o resto do sistema entende (isExtraDeck). */
export function buildTypeLabel(cat, { kind, subtype } = {}) {
  if (cat === 'Spell') return `${subtype || 'Normal'} Spell`;
  if (cat === 'Trap') return `${subtype || 'Normal'} Trap`;
  // Monstro
  const parts = [];
  if (kind && kind !== 'Normal' && kind !== 'Effect') parts.push(kind);
  parts.push(kind === 'Normal' ? 'Normal' : 'Effect');
  return `${parts.join('/')} Monster`;
}

const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const numOrNull = (s) => {
  const t = String(s ?? '').trim();
  if (t === '' ) return null;
  if (t === '?') return -2;         // convenção do banco para "?"
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Lê o JSON de um card maker e extrai o que der para os campos de jogo.
 * Não decide nada sozinho sobre o que falta — devolve os campos e a lista de
 * pendências para o formulário completar.
 *
 * @returns {{ draft: object, missing: string[], art: string|null }}
 */
export function parseCardmaker(json) {
  const frame = FRAME[json.fr] ?? { cat: 'Monster', kind: 'Effect' };
  const cat = frame.cat;

  const draft = {
    name: json.na || '',
    cat,
    kind: frame.kind,
    subtype: cat === 'Monster' ? null : (SUBTYPE[json.sf] || 'Normal'),
    attribute: cat === 'Monster' ? (json.at || 'DARK') : null,
    race: cat === 'Monster' ? (RACE_PT[(json.ta || [])[0]] || (json.ta || [])[0] || '') : null,
    level: cat === 'Monster' ? numOrNull(json.level ?? json.lv) : null, // o maker costuma NÃO ter nível
    atk: cat === 'Monster' ? (numOrNull(json.atk) ?? 0) : null,
    def: (cat === 'Monster' && frame.kind !== 'Link') ? (numOrNull(json.def) ?? 0) : null,
    desc: strip(json.ef),
    tags: ['custom', 'sem-efeito'],
  };

  const missing = [];
  if (!draft.name) missing.push('name');
  if (cat === 'Monster') {
    if (draft.level == null) missing.push('level');
    if (!draft.race) missing.push('race');
  }

  const art = typeof json.ad === 'string' && json.ad.startsWith('data:') ? json.ad : null;
  return { draft, missing, art };
}

/**
 * Monta o objeto final da carta customizada (o que vai para o localStorage e
 * para o índice do YgoDB) a partir dos campos confirmados no formulário.
 */
export function buildCard(fields, art) {
  const cat = fields.cat;
  const t = cat === 'Monster' ? 'M' : cat === 'Spell' ? 'S' : 'T';
  const tl = buildTypeLabel(cat, { kind: fields.kind, subtype: fields.subtype });
  const isMonster = cat === 'Monster';
  return {
    id: fields.id || 0,
    name: fields.name.trim(),
    t,
    tl,
    at: isMonster ? fields.attribute : null,
    r: isMonster ? fields.race : (fields.subtype || null),
    lv: isMonster ? Number(fields.level) : null,
    atk: isMonster ? Number(fields.atk) : null,
    def: (isMonster && fields.kind !== 'Link') ? Number(fields.def) : null,
    a: [],
    desc: fields.desc || '',
    tags: normalizeTags(fields.tags),
    art: art || null,
    custom: true,
  };
}

/** Normaliza uma string ou lista de tags em lista limpa e sem duplicatas. */
export function normalizeTags(tags) {
  const list = Array.isArray(tags)
    ? tags
    : String(tags || '').split(',');
  const out = [];
  for (const raw of list) {
    const t = raw.trim().toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  if (!out.includes('custom')) out.unshift('custom');
  return out;
}

/** Um id vai para o Extra Deck? (mesma regra do deck.js, só para aviso na UI.) */
export function isExtraKind(kind) {
  return EXTRA_KINDS.has(kind);
}

// ----------------------------------------------------- moldura automática

// Cores aproximadas das molduras do Yu-Gi-Oh, por tipo.
const FRAME_COLORS = {
  Normal: { bg: '#c9a86a', body: '#e8d9b0', text: '#2a2013' },
  Effect: { bg: '#b96b3c', body: '#e6b98f', text: '#2a160c' },
  Ritual: { bg: '#5878b7', body: '#aec1e4', text: '#0e1830' },
  Fusion: { bg: '#8a5aa8', body: '#c9acd9', text: '#1c0f26' },
  Synchro: { bg: '#d8d5cc', body: '#f2f0ea', text: '#222222' },
  Xyz: { bg: '#2a2c33', body: '#5a5e6a', text: '#f0f0f0' },
  Link: { bg: '#2f6aa0', body: '#98b9d6', text: '#08131f' },
  Pendulum: { bg: '#3f9d8f', body: '#a7d8cf', text: '#08201c' },
  Spell: { bg: '#1f9a86', body: '#a3ddcf', text: '#062019' },
  Trap: { bg: '#bd5a86', body: '#e6afc6', text: '#2a0c19' },
};

function frameKey(cat, kind) {
  if (cat === 'Spell') return 'Spell';
  if (cat === 'Trap') return 'Trap';
  return FRAME_COLORS[kind] ? kind : 'Effect';
}

function coverDraw(ctx, img, x, y, w, h) {
  const ir = img.naturalWidth / img.naturalHeight;
  const r = w / h;
  let sw, sh, sx, sy;
  if (ir > r) { sh = img.naturalHeight; sw = sh * r; sx = (img.naturalWidth - sw) / 2; sy = 0; }
  else { sw = img.naturalWidth; sh = sw / r; sx = 0; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawFit(ctx, text, cx, y, maxW, basePx) {
  let size = basePx;
  ctx.font = `bold ${Math.round(size)}px Georgia, serif`;
  while (ctx.measureText(text).width > maxW && size > 8) {
    size -= 1;
    ctx.font = `bold ${Math.round(size)}px Georgia, serif`;
  }
  ctx.fillText(text, cx, y);
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  if (!text) return;
  const words = String(text).split(/\s+/);
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lineH;
      line = word;
      if (++lines >= maxLines) { ctx.fillText('…', x, y); return; }
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

/**
 * Desenha uma carta "esqueleto" com moldura colorida pelo tipo, a partir dos
 * campos + a arte crua (o desenho). Usada quando o usuário NÃO sobe a imagem
 * renderizada. Estilo próprio (não é a moldura oficial da Konami).
 * @returns {Promise<string>} data URL (image/jpeg)
 */
export function renderFramedCard(fields, artDataUrl, { w = 400, quality = 0.85 } = {}) {
  return new Promise((resolve) => {
    const h = Math.round((w * 86) / 59);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const col = FRAME_COLORS[frameKey(fields.cat, fields.kind)];
    const isMonster = fields.cat === 'Monster';

    const paint = (img) => {
      const pad = Math.round(w * 0.045);
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = col.body;
      ctx.fillRect(pad, pad, w - 2 * pad, h - 2 * pad);

      const ix = pad + pad * 0.4;
      const iw = w - 2 * (pad + pad * 0.4);

      // nome
      const nameH = Math.round(w * 0.10);
      ctx.fillStyle = '#00000022';
      ctx.fillRect(ix, pad + pad * 0.4, iw, nameH);
      ctx.fillStyle = col.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawFit(ctx, fields.name || '—', ix + iw / 2, pad + pad * 0.4 + nameH / 2, iw - 8, w * 0.05);

      // arte (quadrada)
      const artY = pad + pad * 0.4 + nameH + pad * 0.35;
      const artX = ix;
      const artW = iw;
      const artH = artW; // janela quadrada
      ctx.fillStyle = '#00000066';
      ctx.fillRect(artX, artY, artW, artH);
      if (img) coverDraw(ctx, img, artX + 2, artY + 2, artW - 4, artH - 4);
      else {
        ctx.fillStyle = col.text;
        ctx.font = `${Math.round(w * 0.03)}px Georgia, serif`;
        ctx.fillText('(sem arte)', artX + artW / 2, artY + artH / 2);
      }

      // linha de tipo
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      let ty = artY + artH + pad * 0.7;
      ctx.fillStyle = col.text;
      ctx.font = `bold ${Math.round(w * 0.03)}px Georgia, serif`;
      const lvl = fields.level != null && fields.level !== '' ? ` · Nv ${fields.level}` : '';
      const typeLine = isMonster
        ? `[ ${fields.race || '?'} / ${fields.kind}${fields.attribute ? ' · ' + fields.attribute : ''}${lvl} ]`
        : `[ ${fields.subtype || 'Normal'} ${fields.cat === 'Spell' ? 'Spell' : 'Trap'} ]`;
      ctx.fillText(typeLine, artX, ty);

      // caixa de texto do efeito
      ty += pad * 0.4;
      const bottom = h - pad - (isMonster ? Math.round(w * 0.06) : pad * 0.4);
      const boxH = bottom - ty;
      if (boxH > 10) {
        ctx.fillStyle = '#ffffffcc';
        ctx.fillRect(artX, ty, artW, boxH);
        ctx.fillStyle = '#141414';
        const fs = Math.round(w * 0.026);
        ctx.font = `${fs}px Georgia, serif`;
        wrapText(ctx, fields.desc || '', artX + 5, ty + fs + 3, artW - 10, fs + 3, Math.floor(boxH / (fs + 3)) - 1);
      }

      // ATK/DEF
      if (isMonster) {
        ctx.fillStyle = col.text;
        ctx.font = `bold ${Math.round(w * 0.036)}px Georgia, serif`;
        ctx.textAlign = 'right';
        const atk = fields.atk === -2 ? '?' : (fields.atk ?? 0);
        const def = fields.kind === 'Link' ? '—' : (fields.def === -2 ? '?' : (fields.def ?? 0));
        ctx.fillText(`ATK/${atk}   DEF/${def}`, artX + artW, h - pad - pad * 0.2);
        ctx.textAlign = 'left';
      }

      resolve(canvas.toDataURL('image/jpeg', quality));
    };

    if (artDataUrl) {
      const im = new Image();
      im.onload = () => paint(im);
      im.onerror = () => paint(null);
      im.src = artDataUrl;
    } else {
      paint(null);
    }
  });
}

/**
 * Reduz um data URL de imagem para um JPEG compacto (cabe no localStorage).
 * Preserva a proporção; limita a largura a `maxW`.
 * @returns {Promise<string>} novo data URL (image/jpeg)
 */
export function downscaleDataUrl(dataUrl, { maxW = 400, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('não consegui carregar a imagem da carta'));
    img.src = dataUrl;
  });
}

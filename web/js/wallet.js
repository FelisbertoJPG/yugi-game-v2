/**
 * Carteira do jogador: DP (moeda) e Coleção (cartas que ele possui).
 *
 * Tudo em localStorage, como o resto — quando houver backend, só esta camada
 * muda. O DP começa em 2000; vencer um Adversário dá +100; abrir um booster na
 * Loja custa 100. A Coleção guarda quantas cópias de cada carta o jogador tem
 * (pacotes dão duplicatas); o Deck Builder "real" só oferece o que está aqui.
 */

import { pushFile, pullFile } from '/web/js/projectstore.js';

const KEY_DP = 'ygo:dp';
const KEY_COL = 'ygo:collection';
const KEY_PITY = 'ygo:pity';

export const START_DP = 2000;
export const BOOSTER_PRICE = 100;
export const WIN_REWARD = 100;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    mirrorWallet();   // espelha DP + coleção + pity em store/wallet.json (git)
    return true;
  } catch (e) { console.error('[wallet] falha ao gravar', key, e); return false; }
}

/** Junta os 3 pedaços da carteira num arquivo só e devolve ao disco. */
function mirrorWallet() {
  pushFile('wallet', {
    dp: read(KEY_DP, START_DP),
    collection: read(KEY_COL, {}),
    pity: read(KEY_PITY, {}),
  });
}

/** Traz store/wallet.json (disco) para o localStorage. Chame no boot. */
export async function hydrateWallet() {
  const data = await pullFile('wallet');
  if (!data || typeof data !== 'object') return false;
  if ('dp' in data) localStorage.setItem(KEY_DP, JSON.stringify(data.dp));
  if ('collection' in data) localStorage.setItem(KEY_COL, JSON.stringify(data.collection));
  if ('pity' in data) localStorage.setItem(KEY_PITY, JSON.stringify(data.pity));
  return true;
}

// ------------------------------------------------------------------ DP

/** Saldo de DP. Na primeira vez, semeia com START_DP. */
export function getDP() {
  const raw = localStorage.getItem(KEY_DP);
  if (raw === null) { write(KEY_DP, START_DP); return START_DP; }
  const n = Number(JSON.parse(raw));
  return Number.isFinite(n) ? n : START_DP;
}

export function addDP(n) {
  const v = Math.max(0, getDP() + Math.round(n));
  write(KEY_DP, v);
  return v;
}

/** Tenta gastar `n` DP. Devolve true se tinha saldo. */
export function spendDP(n) {
  const cur = getDP();
  if (cur < n) return false;
  write(KEY_DP, cur - n);
  return true;
}

// ------------------------------------------------------------------ Coleção

/** Coleção como objeto { [id]: quantidade }. */
export function getCollection() {
  const c = read(KEY_COL, {});
  return c && typeof c === 'object' ? c : {};
}

/** Quantas cópias o jogador tem desta carta. */
export function ownedCount(id) {
  return getCollection()[Number(id)] ?? 0;
}

export function ownsCard(id) {
  return ownedCount(id) > 0;
}

/** Ids que o jogador possui (ao menos 1 cópia). */
export function ownedIds() {
  return Object.entries(getCollection())
    .filter(([, n]) => n > 0)
    .map(([id]) => Number(id));
}

/** Adiciona cartas à coleção (aceita duplicatas). Devolve a coleção nova. */
export function addCards(ids) {
  const col = getCollection();
  for (const raw of ids) {
    const id = Number(raw);
    if (!id) continue;
    col[id] = (col[id] ?? 0) + 1;
  }
  write(KEY_COL, col);
  return col;
}

export function totalCards() {
  return Object.values(getCollection()).reduce((s, n) => s + n, 0);
}

// ------------------------------------------------------------------ pity (SR garantida)

/** Quantos pacotes deste booster já foram abertos (contador do "a cada 10"). */
export function getPity(key) {
  return read(KEY_PITY, {})[key] ?? 0;
}

/** Registra a abertura de 1 pacote deste booster; devolve o novo contador. */
export function bumpPity(key) {
  const p = read(KEY_PITY, {});
  p[key] = (p[key] ?? 0) + 1;
  write(KEY_PITY, p);
  return p[key];
}

/**
 * Carteira do jogador: DP (moeda) e Coleção (cartas que ele possui).
 *
 * Tudo em localStorage, como o resto — quando houver backend, só esta camada
 * muda. O DP começa em 2000; vencer um Adversário dá +100; abrir um booster na
 * Loja custa 100. A Coleção guarda quantas cópias de cada carta o jogador tem
 * (pacotes dão duplicatas); o Deck Builder "real" só oferece o que está aqui.
 */

import { pushFile, pullFileEx } from '/web/js/projectstore.js';
// Só a constante: `boosters.js` não importa daqui, então não há ciclo.
import { UR_PITY_DP } from '/web/js/boosters.js';

const KEY_DP = 'ygo:dp';
const KEY_COL = 'ygo:collection';
const KEY_PITY = 'ygo:pity';
const KEY_URSPEND = 'ygo:urSpend';   // DP gasto em pacotes desde a última UR garantida

export const START_DP = 2000;
export const BOOSTER_PRICE = 100;
export const WIN_REWARD = 100;

/**
 * Quanto vale VENDER uma cópia, por raridade (Inventário → Cards).
 *
 * Uma carta que não está em nenhum booster não tem raridade. Ela vale como
 * Normal — mesmo critério que o Deck Builder já usa ao tratá-la como carta
 * farta, então o jogador não descobre duas regras diferentes para o mesmo caso.
 */
export const SELL_PRICE = { N: 5, R: 10, SR: 20, UR: 100 };

export const sellPriceOf = (rarity) => SELL_PRICE[rarity] ?? SELL_PRICE.N;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
/**
 * O disco só pode ser sobrescrito DEPOIS de a gente ter lido o disco.
 *
 * Sem esta trava, abrir uma página com o localStorage vazio antes de a leitura
 * terminar (ou quando ela falha) faz o `getDP()` semear 2000 DP e espelhar o
 * padrão por cima de uma carteira real. É perda de dado silenciosa, e o arquivo
 * é a única cópia que viaja entre máquinas.
 */
let leuODisco = false;

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    mirrorWallet();   // espelha DP + coleção + pity em store/wallet.json (git)
    return true;
  } catch (e) { console.error('[wallet] falha ao gravar', key, e); return false; }
}

/** Junta os 3 pedaços da carteira num arquivo só e devolve ao disco. */
function mirrorWallet() {
  if (!leuODisco) {
    console.warn('[wallet] gravação ignorada: o disco ainda não foi lido '
               + '(chame hydrateWallet() no boot antes de mexer na carteira)');
    return;
  }
  pushFile('wallet', {
    dp: read(KEY_DP, START_DP),
    collection: read(KEY_COL, {}),
    pity: read(KEY_PITY, {}),
    urSpend: read(KEY_URSPEND, 0),
  });
}

/**
 * Traz store/wallet.json (disco) para o localStorage. Chame no boot.
 *
 * Libera o espelhamento mesmo quando o arquivo ainda não existe — aí criá-lo é
 * justamente o certo. Só continua travado se a leitura falhar de vez (sem
 * servidor), caso em que gravar por cima seria arriscado.
 */
export async function hydrateWallet() {
  const { alcancou, data } = await pullFileEx('wallet');
  leuODisco = alcancou;          // só libera o espelho se o disco respondeu
  if (!alcancou) {
    console.warn('[wallet] sem servidor: usando só o localStorage, sem gravar no disco');
    return false;
  }
  if (!data || typeof data !== 'object') return false;
  if ('dp' in data) localStorage.setItem(KEY_DP, JSON.stringify(data.dp));
  if ('collection' in data) localStorage.setItem(KEY_COL, JSON.stringify(data.collection));
  if ('pity' in data) localStorage.setItem(KEY_PITY, JSON.stringify(data.pity));
  // Carteira gravada antes da UR garantida não tem o campo: começa do zero, que
  // é o certo — ninguém deve herdar progresso de um contador que não existia.
  if ('urSpend' in data) localStorage.setItem(KEY_URSPEND, JSON.stringify(data.urSpend));
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

/** Quantas cartas DIFERENTES o jogador possui. */
export function distinctCards() {
  return Object.values(getCollection()).filter((n) => n > 0).length;
}

/**
 * Vende cópias da coleção por DP.
 *
 * `lotes`: `[{ id, qty, rarity }]`. Cada lote é limitado ao que o jogador
 * realmente tem — a tela pode estar desatualizada (outra aba, outro booster
 * aberto), e é aqui, onde a coleção é lida, que dá para garantir que ninguém
 * venda uma carta que não possui.
 *
 * Coleção e DP mudam juntos ou não mudam: se nada for vendável, nem grava.
 *
 * @returns {{ok: boolean, total: number, vendidas: number, dp: number}}
 */
export function sellCards(lotes) {
  const col = getCollection();
  let total = 0;
  let vendidas = 0;

  for (const { id, qty, rarity } of lotes ?? []) {
    const key = Number(id);
    const tem = col[key] ?? 0;
    const n = Math.min(Math.max(0, Math.round(Number(qty) || 0)), tem);
    if (!n) continue;
    col[key] = tem - n;
    if (col[key] <= 0) delete col[key];
    total += n * sellPriceOf(rarity);
    vendidas += n;
  }

  if (!vendidas) return { ok: false, total: 0, vendidas: 0, dp: getDP() };
  write(KEY_COL, col);
  return { ok: true, total, vendidas, dp: addDP(total) };
}

/**
 * Remove cartas da Coleção SEM pagar DP.
 *
 * É o oposto de vender: aqui a carta não vale nada porque não existe mais no
 * jogo — sobrou de um booster que foi apagado ou reescrito durante o
 * balanceamento. Pagar por ela injetaria DP a partir de registro morto, que é
 * justamente o que se está limpando.
 *
 * @param {Array<number>} ids cartas a apagar (TODAS as cópias de cada uma)
 * @returns {{ok: boolean, distintas: number, copias: number}}
 */
export function removeCards(ids) {
  const col = getCollection();
  let distintas = 0, copias = 0;

  for (const id of ids ?? []) {
    const key = Number(id);
    const tem = col[key] ?? 0;
    if (!tem) continue;
    copias += tem;
    distintas++;
    delete col[key];
  }

  if (!distintas) return { ok: false, distintas: 0, copias: 0 };
  write(KEY_COL, col);
  return { ok: true, distintas, copias };
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

// ------------------------------------------------- pity da UR (por DP gasto)

/**
 * Contador GLOBAL de DP gasto em pacotes desde a última UR garantida.
 *
 * É por DP, e não por pacote, porque cada booster pode ter o seu preço: contar
 * pacotes faria um booster caro chegar à garantia com o mesmo esforço de um
 * barato. Global (e não por booster) porque a garantia é do jogador — ele
 * acumula abrindo o que quiser e resgata onde houver UR.
 *
 * O ciclo NÃO é consumido aqui: quem abre o pacote confirma que a UR foi mesmo
 * entregue antes de chamar `consumeUrPity()`. Um booster sem UR não pode
 * queimar o progresso de 10.000 DP do jogador.
 */
export function getUrSpend() {
  const n = Number(read(KEY_URSPEND, 0));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Soma o gasto de um pacote ao contador. Devolve o novo total. */
export function addUrSpend(dp) {
  const v = getUrSpend() + Math.max(0, Math.round(Number(dp) || 0));
  write(KEY_URSPEND, v);
  return v;
}

/** Já deu para a UR garantida? */
export function urPityReady() {
  return getUrSpend() >= UR_PITY_DP;
}

/** Desconta UM ciclo (guarda o troco para o próximo). Só após entregar a UR. */
export function consumeUrPity() {
  const v = Math.max(0, getUrSpend() - UR_PITY_DP);
  write(KEY_URSPEND, v);
  return v;
}

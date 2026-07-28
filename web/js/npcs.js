/**
 * NPCs — os 3 adversários da primeira fase e seus decks.
 *
 * Cada NPC tem VÁRIOS decks próprios (você monta cada um no Deck Builder, modo
 * NPC via `deck.html?npc=<id>&deck=<índice|new>`). Assim dá pra ir criando decks
 * cada vez mais fortes para o mesmo NPC e escolher qual fica ativo — o ativo é o
 * que ele leva pro duelo. Cada deck tem sua própria "carta que dropa" (signature).
 *
 * Persistência: localStorage, igual às cartas customizadas. Estrutura por NPC:
 *   { decks: [ { name, main:[], extra:[], signatureId, updatedAt } ], activeIndex }
 */

import { Deck } from './deck.js';

/** Os 3 NPCs fixos desta fase. `signatureId` é o drop padrão de um deck novo. */
export const NPCS = [
  { id: 'kaiba', name: 'Seto Kaiba', theme: 'Blue-Eyes', signatureId: 89631139 },
  { id: 'joey', name: 'Joey Wheeler', theme: 'Red-Eyes', signatureId: 74677422 },
  { id: 'yugi', name: 'Yugi Muto', theme: 'Dark Magician', signatureId: 46986414 },
];

const KEY = 'ygo:npcDecks';

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? {} : JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAll(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
    return true;
  } catch (e) {
    console.error('[npcs] falha ao gravar', e);
    return false;
  }
}

export function getNpc(id) {
  return NPCS.find((n) => n.id === id) ?? null;
}

/**
 * Normaliza o registro de um NPC para o formato { decks:[], activeIndex }.
 * Migra o formato antigo (deck único achatado) sem perder nada.
 */
function normalize(rec, npc) {
  if (rec && Array.isArray(rec.decks)) {
    return { decks: rec.decks, activeIndex: Math.min(rec.activeIndex ?? 0, Math.max(0, rec.decks.length - 1)) };
  }
  // formato antigo: { main, extra, signatureId, activeDeckName? }
  if (rec && (rec.main || rec.extra)) {
    return {
      decks: [{
        name: 'Deck 1',
        main: rec.main ?? [],
        extra: rec.extra ?? [],
        signatureId: rec.signatureId ?? npc.signatureId,
        updatedAt: rec.updatedAt ?? null,
      }],
      activeIndex: 0,
    };
  }
  return { decks: [], activeIndex: 0 };
}

/** Estado normalizado do NPC (com migração aplicada). */
export function getNpcState(id) {
  const npc = getNpc(id);
  if (!npc) return null;
  return normalize(readAll()[id], npc);
}

function persist(id, state) {
  const all = readAll();
  all[id] = state;
  return writeAll(all);
}

const toDeck = (npc, d) =>
  new Deck({ name: d?.name ?? npc.name, main: d?.main ?? [], extra: d?.extra ?? [] });

/** Os decks do NPC, cada um com Deck + signature. */
export function getNpcDecks(id) {
  const npc = getNpc(id);
  const st = getNpcState(id);
  if (!npc || !st) return [];
  return st.decks.map((d, i) => ({
    index: i, name: d.name, deck: toDeck(npc, d),
    signatureId: d.signatureId ?? npc.signatureId, updatedAt: d.updatedAt ?? null,
  }));
}

/** Um deck específico do NPC por índice. */
export function getNpcDeckAt(id, index) {
  return getNpcDecks(id)[index] ?? null;
}

/** O deck ativo do NPC (o que vai pro duelo), ou null se ainda não montou nenhum. */
export function getNpcActiveDeck(id) {
  const st = getNpcState(id);
  if (!st || !st.decks.length) return null;
  return getNpcDeckAt(id, st.activeIndex) ?? getNpcDeckAt(id, 0);
}

/**
 * Cria/atualiza um deck do NPC. `index` null (ou fora do range) cria um novo.
 * Deixa o deck salvo como o ativo. @returns {number} o índice usado.
 */
export function saveNpcDeckAt(id, index, { name, deck, signatureId }) {
  const npc = getNpc(id);
  if (!npc) return -1;
  const st = getNpcState(id);
  const entry = {
    name: (name || '').trim() || `Deck ${st.decks.length + 1}`,
    main: [...deck.main],
    extra: [...deck.extra],
    signatureId: Number(signatureId) || npc.signatureId,
    updatedAt: new Date().toISOString(),
  };
  let i = index;
  if (i == null || i < 0 || i >= st.decks.length) {
    st.decks.push(entry);
    i = st.decks.length - 1;
  } else {
    st.decks[i] = entry;
  }
  st.activeIndex = i;
  persist(id, st);
  return i;
}

/** Remove um deck do NPC (mantém a lista consistente). */
export function deleteNpcDeck(id, index) {
  const st = getNpcState(id);
  if (!st || index < 0 || index >= st.decks.length) return false;
  st.decks.splice(index, 1);
  st.activeIndex = Math.max(0, Math.min(st.activeIndex, st.decks.length - 1));
  return persist(id, st);
}

/** Define qual deck do NPC fica ativo. */
export function setNpcActiveIndex(id, index) {
  const st = getNpcState(id);
  if (!st || index < 0 || index >= st.decks.length) return false;
  st.activeIndex = index;
  return persist(id, st);
}

/** Lista os 3 NPCs com seus decks e o ativo resolvidos (para a página /npcs). */
export function listNpcState() {
  return NPCS.map((n) => {
    const st = getNpcState(n.id);
    return {
      ...n,
      decks: getNpcDecks(n.id),
      activeIndex: st.activeIndex,
      active: getNpcActiveDeck(n.id),
    };
  });
}

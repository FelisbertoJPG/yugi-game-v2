/**
 * NPCs — os 3 adversários da primeira fase e seus decks.
 *
 * Cada NPC tem VÁRIOS decks próprios (você monta cada um no Deck Builder, modo
 * NPC via `deck.html?npc=<id>&deck=<índice|new>`). Assim dá pra ir criando decks
 * cada vez mais fortes para o mesmo NPC e escolher qual fica ativo — o ativo é o
 * que ele leva pro duelo. Cada deck tem sua própria "carta que dropa" (signature).
 *
 * PERSISTÊNCIA: os decks de NPC são conteúdo do jogo, então moram em arquivos
 * `.ydk` dentro de `decks/npc/<npcId>/` e viajam no git. O localStorage guarda
 * apenas qual deck está ativo (preferência local, não conteúdo) e serve de
 * reserva quando o servidor de desenvolvimento não está no ar para gravar.
 *
 * A leitura do disco é assíncrona, mas os consumidores continuam síncronos:
 * chame `loadNpcDecks()` uma vez no boot para hidratar o cache em memória.
 */

import { Deck } from './deck.js';
import {
  listProjectDecks, saveProjectDeck, deleteProjectDeck, npcDeckPath, canWrite,
} from './projectdecks.js';

/** Os 3 NPCs fixos desta fase. `signatureId` é o drop padrão de um deck novo. */
export const NPCS = [
  { id: 'kaiba', name: 'Seto Kaiba', theme: 'Blue-Eyes', signatureId: 89631139 },
  { id: 'joey', name: 'Joey Wheeler', theme: 'Red-Eyes', signatureId: 74677422 },
  { id: 'yugi', name: 'Yugi Muto', theme: 'Dark Magician', signatureId: 46986414 },
];

const KEY = 'ygo:npcDecks';       // legado: decks que ficaram só no navegador
const KEY_ACTIVE = 'ygo:npcActive';  // preferência local de qual deck está ativo

// Recompensa padrão (DP) por vencer um deck de NPC, quando o deck não define a
// sua. Espelha o WIN_REWARD da carteira — repetido aqui para não acoplar os NPCs
// (conteúdo do jogo) ao módulo de economia.
const DEFAULT_REWARD = 100;

/**
 * Cache em memória, hidratado por `loadNpcDecks()`.
 * `{ [npcId]: [{ name, main, extra, signatureId, updatedAt, path }] }`
 */
let cache = {};
let loaded = false;
let writable = false;

export function getNpc(id) {
  return NPCS.find((n) => n.id === id) ?? null;
}

/** Já dá para gravar no projeto (servidor de desenvolvimento no ar)? */
export const canPersistToProject = () => writable;
export const isLoaded = () => loaded;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { console.error('[npcs] falha ao gravar', key, e); return false; }
}

/** Decks que ficaram no localStorage antes de existir a pasta decks/. */
function legacyDecks(npcId) {
  const rec = readJson(KEY, {})[npcId];
  if (!rec) return [];
  if (Array.isArray(rec.decks)) return rec.decks;
  if (rec.main || rec.extra) {
    return [{
      name: 'Deck 1', main: rec.main ?? [], extra: rec.extra ?? [],
      signatureId: rec.signatureId, updatedAt: rec.updatedAt ?? null,
    }];
  }
  return [];
}

/**
 * Carrega os decks dos NPCs a partir de `decks/npc/`. Chame uma vez no boot,
 * antes de renderizar. Decks legados do localStorage entram como reserva
 * apenas quando o NPC ainda não tem nada versionado no projeto.
 */
export async function loadNpcDecks() {
  writable = await canWrite();
  const all = await listProjectDecks();

  cache = {};
  for (const npc of NPCS) cache[npc.id] = [];

  for (const { path, meta, deck } of all) {
    const m = /^npc\/([^/]+)\//.exec(path);
    if (!m) continue;                       // decks de jogador ficam de fora
    const npcId = m[1];
    if (!cache[npcId]) continue;            // pasta de um NPC que não existe mais
    const sig = Number(meta.signature) || getNpc(npcId)?.signatureId;
    cache[npcId].push({
      name: meta.name || deck.name,
      main: deck.main,
      extra: deck.extra,
      signatureId: sig,
      // A moldura é só ilustração; sem ela, a carta que dropa serve de capa.
      coverId: Number(meta.cover) || sig,
      // Quanto DP este deck dá ao ser vencido (0 é válido: um NPC sem prêmio).
      rewardDp: Number.isFinite(Number(meta.reward)) ? Number(meta.reward) : DEFAULT_REWARD,
      updatedAt: meta.updated ?? null,
      path,
    });
  }

  for (const npc of NPCS) {
    cache[npc.id].sort((a, b) => a.name.localeCompare(b.name));
    if (!cache[npc.id].length) {
      // nada no projeto: aproveita o que houver no navegador, sem path (ainda
      // não versionado) — a UI mostra isso e oferece migrar.
      cache[npc.id] = legacyDecks(npc.id).map((d) => ({ ...d, path: null }));
    }
  }

  loaded = true;
  return cache;
}

/** Estado do NPC: os decks em cache + qual está ativo. */
export function getNpcState(id) {
  const npc = getNpc(id);
  if (!npc) return null;
  const decks = cache[id] ?? [];
  const active = readJson(KEY_ACTIVE, {})[id] ?? 0;
  return { decks, activeIndex: Math.min(active, Math.max(0, decks.length - 1)) };
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
    coverId: d.coverId ?? d.signatureId ?? npc.signatureId,
    rewardDp: Number.isFinite(Number(d.rewardDp)) ? Number(d.rewardDp) : DEFAULT_REWARD,
    // `path` null = o deck ainda não está versionado no projeto (só no navegador).
    path: d.path ?? null,
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
 * Cria/atualiza um deck do NPC, gravando o `.ydk` em `decks/npc/<id>/`.
 * `index` null (ou fora do range) cria um novo. Deixa o deck salvo como ativo.
 *
 * Assíncrono porque escreve em arquivo. Se o servidor de desenvolvimento não
 * estiver no ar, o `.ydk` é baixado e o resultado indica isso — o deck NÃO
 * entra no projeto sozinho nesse caso.
 *
 * @returns {Promise<{index:number, path?:string, downloaded?:boolean, error?:string}>}
 */
export async function saveNpcDeckAt(id, index, { name, deck, signatureId, coverId, rewardDp }) {
  const npc = getNpc(id);
  if (!npc) return { index: -1, error: 'NPC inexistente' };

  const list = cache[id] ?? (cache[id] = []);
  const finalName = (name || '').trim() || `Deck ${list.length + 1}`;
  const sig = Number(signatureId) || npc.signatureId;
  const cover = Number(coverId) || sig;
  // 0 é um prêmio válido (NPC que não dá DP), então só cai no padrão quando o
  // valor não é um número — não use `||`, que trocaria 0 por 100.
  const reward = Number.isFinite(Number(rewardDp)) ? Math.max(0, Number(rewardDp)) : DEFAULT_REWARD;
  const entry = {
    name: finalName,
    main: [...deck.main],
    extra: [...deck.extra],
    signatureId: sig,
    coverId: cover,
    rewardDp: reward,
    updatedAt: new Date().toISOString(),
    path: null,
  };

  const old = (index != null && index >= 0 && index < list.length) ? list[index] : null;
  const path = npcDeckPath(id, finalName);

  const r = await saveProjectDeck(path, deck, {
    name: finalName, npc: id, signature: sig, cover, reward, updated: entry.updatedAt,
  });
  entry.path = r.ok ? r.path : null;

  // Renomear muda o arquivo: apaga o antigo para não ficarem dois.
  if (r.ok && old?.path && old.path !== entry.path) {
    await deleteProjectDeck(old.path);
  }

  let i = index;
  if (i == null || i < 0 || i >= list.length) { list.push(entry); i = list.length - 1; }
  else list[i] = entry;

  setNpcActiveIndex(id, i);
  return { index: i, path: entry.path, downloaded: r.downloaded, error: r.error };
}

/** Remove um deck do NPC, apagando o arquivo do projeto. */
export async function deleteNpcDeck(id, index) {
  const list = cache[id] ?? [];
  if (index < 0 || index >= list.length) return false;
  const [removed] = list.splice(index, 1);
  if (removed?.path) await deleteProjectDeck(removed.path);
  const st = getNpcState(id);
  setNpcActiveIndex(id, Math.max(0, Math.min(st.activeIndex, list.length - 1)));
  return true;
}

/** Define qual deck do NPC fica ativo. Preferência local — não vai para o git. */
export function setNpcActiveIndex(id, index) {
  const all = readJson(KEY_ACTIVE, {});
  all[id] = Math.max(0, index);
  return writeJson(KEY_ACTIVE, all);
}

/**
 * Sobe para o projeto os decks que ainda estão só no localStorage.
 * @returns {Promise<{migrated:number, failed:number}>}
 */
export async function migrateLegacyToProject() {
  let migrated = 0, failed = 0;
  for (const npc of NPCS) {
    const list = cache[npc.id] ?? [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].path) continue;                       // já está no projeto
      const d = new Deck({ name: list[i].name, main: list[i].main, extra: list[i].extra });
      const r = await saveNpcDeckAt(npc.id, i, {
        name: list[i].name, deck: d,
        signatureId: list[i].signatureId, coverId: list[i].coverId,
      });
      if (r.path) migrated++; else failed++;
    }
  }
  return { migrated, failed };
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

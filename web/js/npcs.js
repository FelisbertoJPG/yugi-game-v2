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
  listProjectDecks, saveProjectDeck, deleteProjectDeck, npcDeckPath, canWrite, slugify,
} from './projectdecks.js';
import { pushFile, pullFileEx } from './projectstore.js';

/** Os 3 NPCs fixos desta fase. `signatureId` é o drop padrão de um deck novo. */
const BASE_NPCS = [
  { id: 'kaiba', name: 'Seto Kaiba', theme: 'Blue-Eyes', signatureId: 89631139 },
  { id: 'joey', name: 'Joey Wheeler', theme: 'Red-Eyes', signatureId: 74677422 },
  { id: 'yugi', name: 'Yugi Muto', theme: 'Dark Magician', signatureId: 46986414 },
];

const KEY = 'ygo:npcDecks';       // legado: decks que ficaram só no navegador
const KEY_ACTIVE = 'ygo:npcActive';  // preferência local de qual deck está ativo
const KEY_CUSTOM = 'ygo:customNpcs'; // adversários criados na Área de Teste
const KEY_BASE_META = 'ygo:baseNpcMeta'; // campanha/tabuleiro dos 3 NPCs FIXOS (overlay, não tem onde mais morar)

// Recompensa padrão (DP) por vencer um deck de NPC, quando o deck não define a
// sua. Espelha o WIN_REWARD da carteira — repetido aqui para não acoplar os NPCs
// (conteúdo do jogo) ao módulo de economia.
const DEFAULT_REWARD = 100;

/**
 * NPCs = os 3 fixos + os adversários criados na Área de Teste ("+ criar
 * adversário"). Exportado como array MUTÁVEL (em vez de função) porque várias
 * páginas fazem `for (const npc of NPCS)` depois de um `await hydrate...()` —
 * dá para simplesmente adicionar/remover itens aqui que todo mundo já importou
 * enxerga a mudança (mesma referência de array). A leitura inicial do
 * localStorage é SÍNCRONA (não espera o disco) para o `getNpc(id)` já funcionar
 * de cara nas páginas que resolvem o NPC da URL antes de qualquer `await`
 * (ex.: duel.html); `hydrateCustomNpcs()` sincroniza com `store/npcs.json`
 * depois, para os adversários criados em outra máquina aparecerem também.
 */
applyBaseMeta();  // campanha/tabuleiro dos fixos, do que já houver salvo no navegador
export const NPCS = [...BASE_NPCS, ...readCustom()];

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

function readCustom() {
  const arr = readJson(KEY_CUSTOM, []);
  return Array.isArray(arr) ? arr : [];
}

// Mesma trava do wallet.js/boosters.js: só espelha no projeto depois de ter
// lido o disco, senão um "criar adversário" antes do hydrate correria o risco
// de um pull posterior sobrescrever o próprio adversário recém-criado.
let leuCustomDisco = false;

function writeCustom(list) {
  writeJson(KEY_CUSTOM, list);
  if (leuCustomDisco) pushFile('npcs', list);   // store/npcs.json (vai no git)
  else console.warn('[npcs] gravação de adversário customizado não espelhada: disco ainda não foi lido');
}

// Os 3 NPCs fixos não têm registro próprio (são um array const embutido no
// código), então campanha/tabuleiro deles vivem num overlay à parte —
// { [npcId]: {campaign, board} } — aplicado por cima de BASE_NPCS.
let leuBaseMetaDisco = false;

function readBaseMeta() {
  const obj = readJson(KEY_BASE_META, {});
  return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
}

function writeBaseMeta(meta) {
  writeJson(KEY_BASE_META, meta);
  if (leuBaseMetaDisco) pushFile('npc-base-meta', meta);   // store/npc-base-meta.json
  else console.warn('[npcs] gravação de metadados do NPC fixo não espelhada: disco ainda não foi lido');
}

function applyBaseMeta() {
  const meta = readBaseMeta();
  for (const npc of BASE_NPCS) {
    const m = meta[npc.id] || {};
    npc.campaign = m.campaign || null;
    npc.board = m.board || null;
    // Sem nível salvo, iniciante — os 3 fixos são a fase 1, e quem quiser um
    // Kaiba que lê a sua mão marca isso no "editar configurações".
    npc.level = m.level === 'avancado' ? 'avancado' : 'iniciante';
  }
}

/** Reconstrói NPCS = fixos + customizados, preservando a MESMA referência de array. */
function rebuildNpcList() {
  NPCS.length = 0;
  NPCS.push(...BASE_NPCS, ...readCustom());
}

/** Traz store/npcs.json (disco) para o localStorage. Chame no boot de cada página. */
export async function hydrateCustomNpcs() {
  const { alcancou, data } = await pullFileEx('npcs');
  leuCustomDisco = alcancou;
  if (alcancou && Array.isArray(data)) writeJson(KEY_CUSTOM, data);

  const baseMeta = await pullFileEx('npc-base-meta');
  leuBaseMetaDisco = baseMeta.alcancou;
  if (baseMeta.alcancou && baseMeta.data && typeof baseMeta.data === 'object') {
    writeJson(KEY_BASE_META, baseMeta.data);
  }
  applyBaseMeta();

  rebuildNpcList();
  return alcancou;
}

/**
 * Cria um novo adversário (id gerado a partir do nome, único entre os
 * existentes). Sem deck ainda — o jogador monta o 1º deck normalmente, como
 * com os NPCs fixos. `signatureId`/cover ficam null até existir um deck.
 *
 * `campaign` (texto livre — vira uma "Campanha" na página /adversario assim
 * que 1+ NPC tiver esse mesmo nome, sem precisar cadastrar campanha em lugar
 * nenhum) e `board` (path de um tabuleiro salvo em `boards/`, ver
 * `projectboards.js`) são OPCIONAIS. Aqui só pra criação de customizado — os
 * 3 NPCs fixos ganham/trocam campanha via `updateNpc` (não têm construtor
 * próprio, então não passam por `createNpc`).
 */
/**
 * Níveis de adversário. A diferença é UMA só: o avançado **lê** a mão e as
 * cartas baixadas do jogador, e por isso mede o impacto de cada carta (não cai
 * em isca de negação, não ataca a parede virada, não se estende contra um
 * Raigeki que ele viu). Os dois jogam com as mesmas regras — o iniciante só
 * decide com o que está à vista, como um humano decidiria.
 *
 * Quem não tem nível definido é iniciante: é o padrão, e é o que todo NPC
 * criado antes disto existir continua sendo.
 */
export const NPC_LEVELS = [
  { id: 'iniciante', label: 'Iniciante', hint: 'joga só com o que está à vista' },
  { id: 'avancado', label: 'Avançado', hint: 'lê sua mão e suas cartas baixadas' },
];

export const npcLevel = (npc) => (npc?.level === 'avancado' ? 'avancado' : 'iniciante');
export const npcLevelLabel = (npc) =>
  NPC_LEVELS.find((l) => l.id === npcLevel(npc))?.label ?? 'Iniciante';

const normalizeLevel = (level) => (level === 'avancado' ? 'avancado' : 'iniciante');

export function createNpc(name, theme, { campaign, board, level } = {}) {
  const finalName = (name ?? '').trim();
  if (!finalName) return { ok: false, error: 'dê um nome ao adversário' };

  const ids = new Set(NPCS.map((n) => n.id));
  let id = slugify(finalName, 'npc');
  if (ids.has(id)) {
    let n = 2;
    while (ids.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }

  const npc = {
    id, name: finalName, theme: (theme ?? '').trim(), signatureId: null, custom: true,
    campaign: (campaign ?? '').trim() || null,
    board: board || null,
    level: normalizeLevel(level),
  };
  writeCustom([...readCustom(), npc]);
  NPCS.push(npc);
  cache[id] = [];
  return { ok: true, npc };
}

/**
 * Atualiza um adversário existente. Para os customizados, nome/tema/campanha/
 * tabuleiro (os decks continuam intactos — isso só mexe nos metadados). Para
 * os 3 NPCs FIXOS da fase 1, só campanha/tabuleiro mudam — nome/tema/deck
 * continuam com a identidade original (Kaiba é sempre Kaiba).
 */
export function updateNpc(id, { name, theme, campaign, board, level } = {}) {
  const npc = NPCS.find((n) => n.id === id);
  if (!npc) return { ok: false, error: 'adversário inexistente' };

  const finalCampaign = (campaign ?? '').trim() || null;
  const finalBoard = board || null;
  const finalLevel = normalizeLevel(level);

  if (!npc.custom) {
    npc.campaign = finalCampaign;
    npc.board = finalBoard;
    npc.level = finalLevel;
    const meta = readBaseMeta();
    meta[id] = { campaign: finalCampaign, board: finalBoard, level: finalLevel };
    writeBaseMeta(meta);
    return { ok: true, npc };
  }

  const finalName = (name ?? '').trim();
  if (!finalName) return { ok: false, error: 'dê um nome ao adversário' };

  npc.name = finalName;
  npc.theme = (theme ?? '').trim();
  npc.campaign = finalCampaign;
  npc.board = finalBoard;
  npc.level = finalLevel;

  writeCustom(readCustom().map((n) => (n.id === id ? { ...n, ...npc } : n)));
  return { ok: true, npc };
}

/**
 * Nomes de campanha distintos entre os adversários (customizados), na ordem
 * em que apareceram. Usado pela aba "Campanhas" em /adversario pra montar as
 * seções sem precisar de uma tela de gerenciar campanha separada.
 */
export function listCampaignNames() {
  const seen = new Set();
  const out = [];
  for (const n of NPCS) {
    if (n.campaign && !seen.has(n.campaign)) { seen.add(n.campaign); out.push(n.campaign); }
  }
  return out;
}

/** Remove um adversário CUSTOMIZADO (os 3 fixos não podem ser excluídos), com seus decks. */
export async function deleteNpc(id) {
  const npc = NPCS.find((n) => n.id === id);
  if (!npc || !npc.custom) return { ok: false, error: 'não é um adversário customizado' };

  for (const d of cache[id] ?? []) if (d.path) await deleteProjectDeck(d.path);
  delete cache[id];

  writeCustom(readCustom().filter((n) => n.id !== id));
  const i = NPCS.findIndex((n) => n.id === id);
  if (i >= 0) NPCS.splice(i, 1);

  const active = readJson(KEY_ACTIVE, {});
  delete active[id];
  writeJson(KEY_ACTIVE, active);
  return { ok: true };
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

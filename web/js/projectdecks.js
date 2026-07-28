/**
 * Decks guardados NO PROJETO (pasta `decks/`), não no navegador.
 *
 * Por que isso existe: o `localStorage` morre com a limpeza de dados do
 * navegador e não acompanha você para outra máquina. Deck de NPC é conteúdo do
 * jogo — precisa viajar no git junto com o código. Esta camada grava `.ydk`
 * dentro de `decks/`, então um `git commit` leva os decks junto.
 *
 * Escrever no disco depende do servidor de desenvolvimento (`npm run dev`, que
 * expõe `/__decks/*` só para localhost). Se ele não estiver no ar, a leitura
 * ainda funciona via HTTP estático e a gravação cai para download do arquivo.
 *
 * Layout:
 *   decks/npc/<npcId>/<slug>.ydk    decks dos adversários
 *   decks/player/<slug>.ydk         seus decks
 */

import { Deck } from './deck.js';

const API = '/__decks';

/** Nome de arquivo seguro e previsível: "Yugi Chaos!" -> "yugi_chaos" */
export function slugify(name, fallback = 'deck') {
  const s = String(name ?? '')
    // NFD separa a letra do acento; \p{Diacritic} remove os acentos soltos.
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || fallback;
}

let serverOk = null;   // null = ainda não sabemos

/** O servidor de desenvolvimento está no ar e aceita gravar? */
export async function canWrite() {
  if (serverOk !== null) return serverOk;
  try {
    const r = await fetch(`${API}/list`);
    serverOk = r.ok;
  } catch {
    serverOk = false;
  }
  return serverOk;
}

/**
 * Lê todos os decks do projeto.
 * @returns {Promise<Array<{path, meta, deck}>>}
 */
export async function listProjectDecks() {
  try {
    const r = await fetch(`${API}/list`);
    if (!r.ok) throw new Error(String(r.status));
    const { decks = [] } = await r.json();
    serverOk = true;
    return decks.map(({ path, content, meta }) => ({
      path,
      meta: meta ?? {},
      deck: Deck.fromYdk(content, meta?.name || path.split('/').pop().replace(/\.ydk$/i, '')),
    }));
  } catch {
    serverOk = false;
    return [];
  }
}

/**
 * Grava um deck no projeto. Se o servidor não estiver disponível, baixa o
 * arquivo para você colocar em `decks/` na mão.
 * @returns {Promise<{ok: boolean, path?: string, downloaded?: boolean, error?: string}>}
 */
export async function saveProjectDeck(path, deck, meta = {}) {
  const content = deck.toYdk(meta);
  try {
    const r = await fetch(`${API}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
    serverOk = true;
    return { ok: true, path: j.path };
  } catch (e) {
    serverOk = false;
    download(path.split('/').pop(), content);
    return { ok: false, downloaded: true, error: String(e.message ?? e) };
  }
}

export async function deleteProjectDeck(path) {
  try {
    const r = await fetch(`${API}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok, error: j.error };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  }
}

/** Caminho canônico de um deck de NPC dentro de decks/. */
export const npcDeckPath = (npcId, name) =>
  `npc/${slugify(npcId, 'npc')}/${slugify(name, 'deck')}.ydk`;

/** Caminho canônico de um deck seu. */
export const playerDeckPath = (name) => `player/${slugify(name, 'deck')}.ydk`;

function download(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

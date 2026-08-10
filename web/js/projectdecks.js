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
import { cabecalhoAuth, req, sessao } from '/web/js/supabase.js';

const API = '/__decks';

/**
 * Os decks se dividem em dois mundos, e a diferença é de SEGURANÇA, não de
 * arrumação:
 *
 *   `npc/…`     conteúdo do jogo. Continua em `decks/` no disco, versionado no
 *               git, editável pelo Booster/NPC Builder. Não é progresso de
 *               ninguém, então não há o que proteger.
 *
 *   `player/…`  SEU deck. Foi para o Supabase (`decks_jogador`), e gravar passa
 *               por `salvar_deck()`, que confere carta a carta contra a sua
 *               coleção. Enquanto isso era um `.ydk` no disco, abrir o arquivo
 *               num editor e escrever o id de uma Blue-Eyes que você nunca
 *               abriu era o bastante — a checagem de posse morava no builder,
 *               ou seja, do lado de quem estava sendo conferido.
 */
const ehDoJogador = (path) => /^player[/\\]/.test(String(path ?? ''));

/** `player/<slug>.ydk` <-> o `nome` da linha em `decks_jogador`. */
const nomeDeDeck = (path) => String(path).replace(/^player[/\\]/, '').replace(/\.ydk$/i, '');
const caminhoDeDeck = (nome) => `player/${nome}.ydk`;

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
    const r = await fetch(`${API}/list`, { headers: await cabecalhoAuth() });
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
  const out = [];

  // 1. conteúdo do jogo (npc/…), do disco.
  try {
    const r = await fetch(`${API}/list`, { headers: await cabecalhoAuth() });
    if (!r.ok) throw new Error(String(r.status));
    const { decks = [] } = await r.json();
    serverOk = true;
    for (const { path, content, meta } of decks) {
      if (ehDoJogador(path)) continue;          // os seus vêm do banco, abaixo
      out.push({
        path,
        meta: meta ?? {},
        deck: Deck.fromYdk(content, meta?.name || path.split('/').pop().replace(/\.ydk$/i, '')),
      });
    }
  } catch {
    serverOk = false;
  }

  // 2. os seus, do Supabase. Falha aqui não derruba a lista de NPCs: sem rede o
  //    Deck Builder ainda serve para montar deck de adversário.
  if (sessao()) {
    const r = await req('decks_jogador?select=nome,ydk&order=nome');
    if (r.ok && Array.isArray(r.dados)) {
      for (const { nome, ydk } of r.dados) {
        out.push({
          path: caminhoDeDeck(nome),
          meta: { name: nome },
          deck: Deck.fromYdk(ydk, nome),
        });
      }
    }
  }

  return out;
}

/**
 * Grava um deck no projeto. Se o servidor não estiver disponível, baixa o
 * arquivo para você colocar em `decks/` na mão.
 * @returns {Promise<{ok: boolean, path?: string, downloaded?: boolean, error?: string}>}
 */
export async function saveProjectDeck(path, deck, meta = {}) {
  const content = deck.toYdk(meta);

  // O SEU deck vai para o banco, onde `salvar_deck()` confere cada carta contra
  // a sua coleção. Não há queda para download aqui de propósito: um .ydk baixado
  // e devolvido à mão é exatamente o caminho que a conferência existe para
  // fechar.
  if (ehDoJogador(path)) {
    const nome = nomeDeDeck(path);
    const r = await req('rpc/salvar_deck', {
      method: 'POST',
      body: { p_nome: nome, p_ydk: content },
    });
    if (r.ok) return { ok: true, path: caminhoDeDeck(nome) };
    return {
      ok: false,
      error: /nao possui/i.test(r.error ?? '')
        ? r.error.replace(/^.*?cartas que voce/i, 'cartas que você')
        : (r.error || 'não consegui salvar'),
    };
  }

  try {
    const r = await fetch(`${API}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await cabecalhoAuth()) },
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
  if (ehDoJogador(path)) {
    const r = await req('rpc/apagar_deck', {
      method: 'POST',
      body: { p_nome: nomeDeDeck(path) },
    });
    return { ok: r.ok && !!r.dados?.ok, error: r.error };
  }

  try {
    const r = await fetch(`${API}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await cabecalhoAuth()) },
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

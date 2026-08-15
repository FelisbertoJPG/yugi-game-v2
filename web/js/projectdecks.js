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
  const npcPorCaminho = new Map();   // disco primeiro, banco por cima

  // 1. conteúdo do jogo (npc/…), do disco.
  try {
    const r = await fetch(`${API}/list`, { headers: await cabecalhoAuth() });
    if (!r.ok) throw new Error(String(r.status));
    const { decks = [] } = await r.json();
    serverOk = true;
    for (const { path, content, meta } of decks) {
      if (ehDoJogador(path)) continue;          // os seus vêm do banco, abaixo
      npcPorCaminho.set(path, {
        path,
        meta: meta ?? {},
        deck: Deck.fromYdk(content, meta?.name || path.split('/').pop().replace(/\.ydk$/i, '')),
      });
    }
  } catch {
    serverOk = false;
  }

  // 1b. os decks de NPC PUBLICADOS. Mesma regra dos tabuleiros: o banco vence o
  //     disco (é ele que recebe o deck montado em outra máquina), e um deck que
  //     só existe no disco continua na lista — sumir seria pior que duplicar.
  //     A leitura é aberta, então funciona até sem login.
  {
    const r = await req('decks_npc?select=npc,nome,ydk&order=npc,nome');
    if (r.ok && Array.isArray(r.dados)) {
      for (const { npc, nome, ydk } of r.dados) {
        const path = `npc/${npc}/${nome}.ydk`;
        const meta = metaDoYdk(ydk);
        npcPorCaminho.set(path, {
          path,
          meta: { ...meta, name: meta.name || nome },
          deck: Deck.fromYdk(ydk, meta.name || nome),
        });
      }
    }
  }
  out.push(...npcPorCaminho.values());

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
 *
 * `opcoes.livre` é o modo ADMIN da Área de Teste: manda `p_livre` para
 * `salvar_deck`, que então pula as conferências de JOGO (posse, teto de cópias,
 * pontos, lista compartilhada e pool permitido) e grava assim mesmo. O servidor
 * confere que quem pediu é admin — aqui é só o pedido. Ver a migration 0024.
 *
 * @returns {Promise<{ok: boolean, path?: string, downloaded?: boolean, error?: string}>}
 */
export async function saveProjectDeck(path, deck, meta = {}, opcoes = {}) {
  const content = deck.toYdk(meta);

  // O SEU deck vai para o banco, onde `salvar_deck()` confere cada carta contra
  // a sua coleção. Não há queda para download aqui de propósito: um .ydk baixado
  // e devolvido à mão é exatamente o caminho que a conferência existe para
  // fechar.
  if (ehDoJogador(path)) {
    const nome = nomeDeDeck(path);
    const r = await req('rpc/salvar_deck', {
      method: 'POST',
      body: { p_nome: nome, p_ydk: content, ...(opcoes.livre ? { p_livre: true } : {}) },
    });
    if (r.ok) return { ok: true, path: caminhoDeDeck(nome), livre: !!opcoes.livre };
    return {
      ok: false,
      error: /nao possui/i.test(r.error ?? '')
        ? r.error.replace(/^.*?cartas que voce/i, 'cartas que você')
        : (r.error || 'não consegui salvar'),
    };
  }

  // Deck de NPC: salvar É publicar, como os tabuleiros. Ele nasce dentro do
  // jogo (que grava em %LOCALAPPDATA%, não no repositório), então sem o banco
  // um adversário montado aqui não chegava em mais ninguém — foi o que
  // aconteceu com o deck do Pegasus, que precisou ser inserido na mão.
  const remoto = await publicarDeckNpc(path, content);

  try {
    const r = await fetch(`${API}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await cabecalhoAuth()) },
      body: JSON.stringify({ path, content }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
    serverOk = true;
    return { ok: true, path: j.path, publicado: remoto.ok, erroRemoto: remoto.error };
  } catch (e) {
    serverOk = false;
    // Publicou mas não achou o disco: o deck NÃO está perdido — ele já chega
    // em quem joga. Baixar por cima disso só confundiria.
    if (remoto.ok) return { ok: true, path, publicado: true, semDisco: true };
    download(path.split('/').pop(), content);
    return { ok: false, downloaded: true, error: String(e.message ?? e) };
  }
}

/**
 * Os `#chave valor` do topo de um .ydk (`#name`, `#signature`, `#cover`,
 * `#reward`). O dev-server já devolve isto pronto no `/list`; para o deck que
 * vem do BANCO só existe o texto, e sem parsear aqui o adversário perderia
 * capa, assinatura e prêmio ao ser lido de lá.
 *
 * `#created by ...` fica de fora: é a linha padrão do formato ygopro, não
 * metadado nosso.
 */
function metaDoYdk(ydk) {
  const meta = {};
  for (const cru of String(ydk ?? '').split(/\r?\n/)) {
    const l = cru.trim();
    if (!l.startsWith('#') || l.startsWith('#main') || l.startsWith('#extra')) continue;
    const m = /^#(\w+)\s+(.*)$/.exec(l);
    if (!m || m[1] === 'created') continue;
    const n = Number(m[2]);
    meta[m[1]] = Number.isFinite(n) && /^\d+$/.test(m[2].trim()) ? n : m[2].trim();
  }
  return meta;
}

/** `npc/<id>/<nome>.ydk` -> `{npc, nome}`, que é a chave de `decks_npc`. */
function partesDoNpc(path) {
  const p = String(path).split('/');
  if (p[0] !== 'npc' || p.length < 3) return null;
  return { npc: p[1], nome: p[2].replace(/\.ydk$/i, '') };
}

/** Upsert em `decks_npc`. Sem sessão de admin devolve `{ok:false}` e segue. */
async function publicarDeckNpc(path, ydk) {
  const alvo = partesDoNpc(path);
  if (!alvo) return { ok: false, error: 'nao e deck de npc' };

  const cabecalho = await cabecalhoAuth();
  if (!cabecalho.authorization) return { ok: false, error: 'sem sessão' };

  const r = await req('decks_npc?on_conflict=npc,nome', {
    method: 'POST',
    body: { npc: alvo.npc, nome: alvo.nome, ydk },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (r.ok) return { ok: true };
  return {
    ok: false,
    error: /row-level security|permission/i.test(r.error ?? '')
      ? 'só um admin publica deck de adversário'
      : (r.error || 'não consegui publicar'),
  };
}

export async function deleteProjectDeck(path) {
  if (ehDoJogador(path)) {
    const r = await req('rpc/apagar_deck', {
      method: 'POST',
      body: { p_nome: nomeDeDeck(path) },
    });
    return { ok: r.ok && !!r.dados?.ok, error: r.error };
  }

  // Apaga nos DOIS: deixar a linha no banco faria o deck ressuscitar na
  // leitura seguinte, já que o banco vence o disco.
  const alvo = partesDoNpc(path);
  const remoto = alvo
    ? await req(`decks_npc?npc=eq.${encodeURIComponent(alvo.npc)}` +
                `&nome=eq.${encodeURIComponent(alvo.nome)}`, { method: 'DELETE' })
    : { ok: false };

  try {
    const r = await fetch(`${API}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await cabecalhoAuth()) },
      body: JSON.stringify({ path }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok, error: j.error, apagadoNoBanco: remoto.ok };
  } catch (e) {
    return { ok: remoto.ok, error: remoto.ok ? null : String(e.message ?? e) };
  }
}

/* ------------------------------------------------------------------ o banco
 *
 * As duas funções abaixo falam SÓ com `decks_jogador`, sem passar pelo disco
 * nem pelos decks de NPC. Existem para a Área de Teste poder mostrar (e
 * apagar) exatamente o que está gravado no banco DESTA conta — que é outra
 * coisa que a lista do Deck Builder, montada a partir do `localStorage`
 * hidratado. Quando as duas discordam, é justamente essa diferença que se
 * quer ver.
 */

/** Os decks desta conta que estão no banco. Sem sessão, lista vazia. */
export async function listarDecksNoBanco() {
  if (!sessao()) return { ok: false, error: 'sem sessão', decks: [] };
  const r = await req('decks_jogador?select=nome,ydk,atualizado_em&order=nome');
  if (!r.ok || !Array.isArray(r.dados)) return { ok: false, error: r.error, decks: [] };
  return {
    ok: true,
    decks: r.dados.map(({ nome, ydk, atualizado_em }) => {
      const deck = Deck.fromYdk(ydk, nome);
      return { nome, atualizadoEm: atualizado_em, main: deck.main.length, extra: deck.extra.length };
    }),
  };
}

/**
 * Apaga um deck desta conta no banco. `apagar_deck` filtra por `usuario_id =
 * auth.uid()`, então não há como apagar o deck de outra pessoa nem sendo admin.
 */
export async function apagarDeckNoBanco(nome) {
  const r = await req('rpc/apagar_deck', { method: 'POST', body: { p_nome: nome } });
  if (!r.ok) return { ok: false, error: r.error || 'não consegui apagar' };
  // `{ok:false}` do RPC = não havia linha com esse nome (já apagado em outra aba).
  return { ok: !!r.dados?.ok, error: r.dados?.ok ? null : 'esse deck não está no banco' };
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

/**
 * Registro de "listas de cartas" — pools restritos que uma banlist pode
 * governar, e que o servidor usa para recusar um deck fora do pool.
 *
 * Uma lista tem duas partes, e a divisão é o ponto do arquivo:
 *
 *   - **tipos**: os `tl` do índice que entram por REGRA (`Normal Monster`,
 *     `Fusion Monster`…). Não dá para listar 1005 monstros à mão.
 *   - **ids**: as cartas escolhidas uma a uma (magia/armadilha, Sincro, Xyz…).
 *
 * O `filter` de cada lista é derivado desses dois — é o que `banlist.html`,
 * o Deck Builder e o Booster Builder consultam.
 *
 * ## Onde isto mora
 *
 * O padrão de fábrica está em `lista1.js` (viaja dentro do `.exe`). A verdade
 * viva está no Supabase, em `conteudo/cardlists`, publicada pelo editor
 * `web/listas.html` — antes disto, acrescentar uma carta à Lista 1 exigia
 * editar `lista1.js`, rodar `tools/publicar-conteudo.mjs` e publicar um
 * Release. Agora é salvar na Área de Teste.
 *
 * ## As duas chaves no banco (e por que são duas)
 *
 *   `conteudo/cardlists`  a FONTE (tipos + ids), que só o editor lê.
 *   `conteudo/<id>`       o RESULTADO: o array plano de ids permitidos.
 *
 * `salvar_deck` (migration 0008) roda no Postgres, que não tem o banco de
 * cartas — ele não consegue avaliar "todo monstro Normal". Por isso o
 * navegador, que TEM o índice, resolve a regra e publica o resultado. Republicar
 * o resultado é obrigatório depois de um `npm run data:build` que mude o
 * conjunto; o botão "salvar" do editor faz as duas gravações de uma vez.
 *
 * O resultado NÃO é espelhado em `store/`: é derivado (o cliente recalcula
 * sozinho a partir da fonte + índice) e só existe para o servidor conferir.
 */
import {
  inLista1, aplicarLista1, fonteDaLista1, restaurarLista1,
  LISTA1_TIPOS, LISTA1_SPELLTRAP,
} from './lista1.js';
import { pullFileEx, pushFileGuardado } from './projectstore.js';
import { req } from './supabase.js';

const CHAVE = 'cardlists';

/**
 * Mutável de propósito: `banlist.html` importa a referência no topo do módulo e
 * lê depois do boot. Trocar o array por um novo deixaria o import apontando
 * para o antigo, então a hidratação escreve DENTRO dele.
 */
export const CARD_LISTS = [];

export function getCardList(id) {
  return CARD_LISTS.find((l) => l.id === id) ?? CARD_LISTS[0];
}

/** Só a parte editável (sem o `filter`), que é o que vai para o banco. */
export function fonteDasListas() {
  return CARD_LISTS.map((l) => ({ id: l.id, label: l.label, tipos: [...l.tipos], ids: [...l.ids] }));
}

// ------------------------------------------------------------------ normalização

function normalizarLista(bruta) {
  const id = String(bruta?.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    label: String(bruta?.label ?? id).trim() || id,
    tipos: Array.isArray(bruta?.tipos) ? [...new Set(bruta.tipos.map(String))] : [],
    ids: Array.isArray(bruta?.ids)
      ? [...new Set(bruta.ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))]
      : [],
  };
}

/** Filtro puro (sem efeito nenhum), a partir de tipos + ids. */
function construirFiltro(lista) {
  const ids = new Set(lista.ids);
  const tipos = new Set(lista.tipos);
  return (card) => ids.has(card.id) || (card.t === 'M' && tipos.has(card.tl));
}

/**
 * Instala uma lista. A Lista 1 é a exceção: em vez de um filtro novo ela
 * ALIMENTA a `inLista1` de sempre, que meia dúzia de módulos importa direto —
 * assim o import continua valendo e a hidratação chega a todos eles de uma vez.
 */
function comFiltro(lista) {
  if (lista.id === 'lista1') {
    aplicarLista1({ tipos: lista.tipos, ids: lista.ids });
    return { ...lista, filter: inLista1 };
  }
  return { ...lista, filter: construirFiltro(lista) };
}

function padrao() {
  return [{ id: 'lista1', label: 'Lista 1', tipos: [...LISTA1_TIPOS], ids: [...LISTA1_SPELLTRAP] }];
}

/** Instala um conjunto de listas (in-place, ver o comentário de CARD_LISTS). */
export function aplicarListas(listas) {
  const normalizadas = (Array.isArray(listas) ? listas : [])
    .map(normalizarLista)
    .filter(Boolean);
  // Sem nenhuma lista válida, o padrão de fábrica: um pool vazio recusaria
  // todo deck do jogo, o que é bem pior que uma lista desatualizada.
  const finais = normalizadas.length ? normalizadas : padrao();
  if (!finais.some((l) => l.id === 'lista1')) restaurarLista1();
  CARD_LISTS.length = 0;
  CARD_LISTS.push(...finais.map(comFiltro));
  return CARD_LISTS;
}

aplicarListas(padrao());

// ------------------------------------------------------------------ persistência

let leuODisco = false;

/**
 * Traz as listas publicadas (Supabase, com queda para `store/cardlists.json`).
 * Chame no boot de toda página que filtra pelo pool — sem isto a página usa o
 * padrão de fábrica e discorda do servidor.
 */
export async function hydrateCardLists() {
  const { alcancou, data } = await pullFileEx(CHAVE);
  leuODisco = alcancou;
  if (!alcancou || !data) return false;
  const listas = Array.isArray(data) ? data : data.listas;
  if (!Array.isArray(listas) || !listas.length) return false;
  aplicarListas(listas);
  return true;
}

/**
 * **As cartas do deck que a lista ativa NÃO aceita** — os ids, sem repetição.
 *
 * Esta é a mesma pergunta que `salvar_deck` faz no servidor ("está no pool
 * permitido?"), e ela precisava existir também aqui: sem ela o Deck Builder
 * deixava montar e salvar um deck fora da lista, o banco recusava, e o deck
 * ficava **só naquele navegador** — com o jogador achando que tinha um deck.
 * O aviso existia, mas chegava depois de o trabalho estar feito.
 *
 * `briefDe(id)` devolve a entrada do índice (o `db.brief` do builder). Carta
 * que o índice não conhece é dada como FORA: é o caso de uma carta customizada
 * (id ≥ 900000000, sem Lua) e de um id digitado errado, e os dois o servidor
 * recusa igual. Sem lista nenhuma (`null`), devolve vazio — "não sei qual é a
 * lista" nunca pode virar "o seu deck está errado".
 */
export function foraDaLista(ids, lista, briefDe) {
  if (!lista || typeof lista.filter !== 'function') return [];
  const fora = new Set();
  for (const id of ids ?? []) {
    const card = briefDe?.(id) ?? null;
    if (!card || !lista.filter(card)) fora.add(Number(id));
  }
  return [...fora];
}

/** O array plano de ids que o servidor confere, resolvido contra o índice. */
export function resolverLista(lista, cartas) {
  const f = construirFiltro(normalizarLista(lista));
  const ids = new Set(cartas.filter(f).map((c) => c.id));
  // Ids escolhidos à mão que não existem mais no índice ainda valem: o servidor
  // só confere pertinência, e sumir com eles calaria um erro de digitação.
  for (const id of lista.ids ?? []) ids.add(Number(id));
  return [...ids].sort((a, b) => a - b);
}

async function publicarResolvida(id, ids) {
  const r = await req('conteudo?on_conflict=chave', {
    method: 'POST',
    body: { chave: id, dados: ids },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (r.ok) return { ok: true };
  return {
    ok: false,
    error: /row-level security|permission/i.test(r.error ?? '')
      ? 'só um admin pode publicar lista de cartas'
      : (r.error || 'não consegui publicar'),
  };
}

/**
 * Salva as listas e publica o resultado de cada uma, nesta ordem:
 *
 *   1. instala localmente (a página passa a filtrar pelo que acabou de salvar);
 *   2. `conteudo/cardlists` + `store/cardlists.json` — a fonte;
 *   3. `conteudo/<id>` — o resultado que `salvar_deck` confere.
 *
 * `cartas` é o índice inteiro (`db.filter({})`), necessário para o passo 3.
 */
export async function salvarListas(listas, cartas) {
  const fonte = aplicarListas(listas).map((l) => ({
    id: l.id, label: l.label, tipos: [...l.tipos], ids: [...l.ids],
  }));

  pushFileGuardado(CHAVE, { listas: fonte }, leuODisco);

  const publicadas = [];
  const erros = [];
  for (const l of fonte) {
    const ids = resolverLista(l, cartas);
    const r = await publicarResolvida(l.id, ids);
    if (r.ok) publicadas.push({ id: l.id, n: ids.length });
    else erros.push(`${l.id}: ${r.error}`);
  }
  return { ok: erros.length === 0, publicadas, erros };
}

/** Apaga a lista resolvida do banco (usado ao excluir uma lista inteira). */
export async function apagarListaPublicada(id) {
  const r = await req(`conteudo?chave=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { ok: r.ok, error: r.error };
}

export { fonteDaLista1 };

/**
 * Carteira do jogador: DP (moeda) e Coleção (cartas que ele possui).
 *
 * O DADO MORA NO SUPABASE, não em disco. Antes isto era um `store/wallet.json`
 * no PC do jogador — abrir num editor e trocar `"dp": 2000` por `"dp": 999999`
 * era todo o trabalho. Agora a carteira é uma linha em `carteiras`, o dono só
 * tem permissão de LER, e toda mudança passa por uma função no banco que aplica
 * a regra do jogo (migration `0004_economia_no_servidor.sql`).
 *
 * Consequência para quem usa este módulo: os LEITORES continuam síncronos
 * (`getDP()`, `ownsCard()`, …), servidos por um cache em memória que
 * `hydrateWallet()` preenche no boot — as dezenas de pontos que só exibem
 * saldo não mudaram. Já as MUTAÇÕES viraram async e passaram a ser pedidos:
 * o cliente diz "abrir pacote", e é o servidor que decide o que sai e o quanto
 * custa. Não existe mais `addDP`/`spendDP`/`addCards` — se existissem, a trava
 * no banco seria decoração.
 */

import { req, sessao } from '/web/js/supabase.js';

const KEY_CACHE = 'ygo:wallet-cache';

export const START_DP = 2000;
export const BOOSTER_PRICE = 100;
export const WIN_REWARD = 100;

/** Espelha `eco_const()` no banco — mas quem MANDA é o banco. Aqui é só exibição. */
export const SELL_PRICE = { N: 5, R: 10, SR: 20, UR: 100 };
export const sellPriceOf = (rarity) => SELL_PRICE[rarity] ?? SELL_PRICE.N;

/** Última carteira conhecida. Null até `hydrateWallet()`. */
let cache = null;

function guardarCache(w) {
  cache = w;
  // Só para a tela não piscar em branco no boot seguinte enquanto a rede
  // responde. NÃO é fonte da verdade: editar isto não dá DP a ninguém, porque
  // toda operação é conferida no servidor contra a linha de lá.
  try { localStorage.setItem(KEY_CACHE, JSON.stringify(w)); } catch { /* quota */ }
  return w;
}

function lerCache() {
  if (cache) return cache;
  try {
    const cru = localStorage.getItem(KEY_CACHE);
    if (cru) cache = JSON.parse(cru);
  } catch { /* ignora */ }
  return cache;
}

const vazia = () => ({ dp: 0, collection: {}, pity: {}, urSpend: 0 });

/**
 * Traz a carteira do banco. Chame no boot, ANTES de ler qualquer coisa.
 * Sem sessão devolve false e o resto responde zerado — nenhuma tela deve
 * inventar saldo por conta própria.
 */
export async function hydrateWallet() {
  if (!sessao()) { cache = null; return false; }
  const r = await req('rpc/carteira_minha', { method: 'POST', body: {} });
  if (!r.ok || !r.dados || typeof r.dados !== 'object') {
    lerCache();                     // offline: mostra o último saldo conhecido
    return false;
  }
  guardarCache(r.dados);
  return true;
}

// ------------------------------------------------------------------ leitura

export function getDP() {
  return Number(lerCache()?.dp ?? 0);
}

export function getCollection() {
  const c = lerCache()?.collection;
  return c && typeof c === 'object' ? c : {};
}

export const ownedCount = (id) => getCollection()[Number(id)] ?? 0;
export const ownsCard = (id) => ownedCount(id) > 0;

export function ownedIds() {
  return Object.entries(getCollection())
    .filter(([, n]) => n > 0)
    .map(([id]) => Number(id));
}

export function totalCards() {
  return Object.values(getCollection()).reduce((s, n) => s + n, 0);
}

export function distinctCards() {
  return Object.values(getCollection()).filter((n) => n > 0).length;
}

/** Quantos pacotes deste booster já foram abertos (contador da SR garantida). */
export const getPity = (key) => lerCache()?.pity?.[key] ?? 0;

/** DP gasto em pacotes desde a última UR garantida. */
export const getUrSpend = () => Number(lerCache()?.urSpend ?? 0);

// ----------------------------------------------------------------- mutações

/** Traduz o erro do PostgREST para algo que cabe num toast. */
function motivo(r, padrao) {
  const m = r?.error ?? '';
  if (/DP insuficiente/i.test(m)) return 'DP insuficiente';
  if (/nao autenticado/i.test(m)) return 'sessão expirada — entre de novo';
  if (/sem conexao/i.test(m)) return 'sem conexão';
  return m || padrao;
}

/**
 * Abre um pacote. O SERVIDOR cobra, sorteia e credita — o cliente manda só o
 * nome do booster.
 *
 * As garantias (SR a cada N pacotes, UR por DP acumulado) também são de lá:
 * eram quatro chamadas separadas no cliente (`spendDP`, `addUrSpend`,
 * `bumpPity`, `consumeUrPity`), e qualquer uma podia ser pulada por quem
 * chamasse a API na mão.
 *
 * @returns {{ok: boolean, cartas?: Array<{id:number,rarity:string}>, error?: string}}
 */
export async function abrirPacote(nomeDoBooster) {
  const r = await req('rpc/abrir_pacote', {
    method: 'POST',
    body: { p_booster: nomeDoBooster },
  });
  if (!r.ok) return { ok: false, error: motivo(r, 'não consegui abrir o pacote') };
  guardarCache(r.dados.carteira);
  return { ok: true, cartas: r.dados.cartas ?? [] };
}

/**
 * Vende cópias por DP. `lotes` = `[{id, qty}]`.
 *
 * A RARIDADE não vai junto de propósito: o servidor a procura nos boosters
 * publicados. Mandá-la daqui seria deixar o cliente vender tudo a preço de UR.
 */
export async function sellCards(lotes) {
  const r = await req('rpc/vender_cartas', {
    method: 'POST',
    body: { p_lotes: (lotes ?? []).map(({ id, qty }) => ({ id: String(id), qty })) },
  });
  if (!r.ok) return { ok: false, total: 0, vendidas: 0, dp: getDP(), error: motivo(r, 'falhou') };
  if (r.dados?.carteira) guardarCache(r.dados.carteira);
  return {
    ok: !!r.dados?.ok,
    total: r.dados?.total ?? 0,
    vendidas: r.dados?.vendidas ?? 0,
    dp: getDP(),
  };
}

/** Remove cartas da coleção SEM pagar (limpeza de carta que saiu do jogo). */
export async function removeCards(ids) {
  const r = await req('rpc/remover_cartas', {
    method: 'POST',
    body: { p_ids: (ids ?? []).map(String) },
  });
  if (!r.ok) return { ok: false, distintas: 0, copias: 0, error: motivo(r, 'falhou') };
  if (r.dados?.carteira) guardarCache(r.dados.carteira);
  return { ok: !!r.dados?.ok, distintas: r.dados?.distintas ?? 0, copias: 0 };
}

/**
 * Registra a vitória sobre um adversário e credita o prêmio.
 *
 * O VALOR e a carta de assinatura saem de `conteudo->npcs` no servidor. Antes
 * vinham do objeto do NPC carregado no navegador (`active.rewardDp`), ou seja:
 * o jogador escolhia quanto ganhava.
 *
 * Isto ainda não PROVA a vitória — o duelo roda na máquina dele. O que muda é
 * que a única coisa sob controle do cliente passou a ser *qual* adversário, não
 * *quanto*.
 */
export async function premiarVitoria(dueloId) {
  const r = await req('rpc/premiar_vitoria', {
    method: 'POST',
    body: { p_duelo: dueloId },
  });
  if (!r.ok) return { ok: false, premio: 0, carta: null, error: motivo(r, 'falhou') };
  guardarCache(r.dados.carteira);
  return { ok: true, premio: r.dados.premio ?? 0, carta: r.dados.carta ?? null };
}

/**
 * Registra o começo de um duelo e devolve o id que destrava o prêmio.
 *
 * Sem isto, `premiar_vitoria` aceitava só o nome do NPC — e chamá-la em laço
 * era DP infinito (medido: 5 chamadas, 2000 → 2500). Agora cada prêmio consome
 * um duelo registrado, uma vez só, e o servidor recusa duelo com menos de 30s.
 *
 * Continua sem PROVAR a vitória: o duelo roda no ocgcore da máquina do jogador
 * e o servidor não o vê. O que isto faz é transformar um laço de console em
 * trabalho — a solução de verdade é o duelo rodar no servidor.
 */
export async function iniciarDuelo(npcId) {
  const r = await req('rpc/iniciar_duelo', {
    method: 'POST',
    body: { p_npc: String(npcId ?? '') },
  });
  return r.ok ? r.dados : null;
}

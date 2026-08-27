/**
 * Carteira do jogador: DP (moeda) e Coleção (cartas que ele possui).
 *
 * O DADO MORA NO SUPABASE, não em disco. Antes isto era um `store/wallet.json`
 * no PC do jogador — abrir num editor e trocar `"dp"` por `"dp": 999999`
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
import { selo } from '/web/js/versao.js';

const KEY_CACHE = 'ygo:wallet-cache';

/** Espelha `start_dp` do `eco_const()` (500 desde a migration 0023). Só o banco
 *  decide o saldo de verdade — aqui é para exibir, nunca para creditar. */
export const START_DP = 500;
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

const vazia = () => ({ dp: 0, collection: {}, pity: {}, urPity: {} });

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

/** Pacotes DESTE booster desde a última UR (natural ou garantida). */
export const getUrPity = (key) => lerCache()?.urPity?.[key] ?? 0;

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
export async function abrirPacote(nomeDoBooster, quantos = 1) {
  const r = await req('rpc/abrir_pacote', {
    method: 'POST',
    // O laço dos vários pacotes mora no SERVIDOR (migration 0044), e não aqui
    // em N chamadas: as garantias são sequenciais (o `pity` sobe a cada pacote,
    // a SR sai no múltiplo de 20), e dez requisições concorrentes leriam a
    // mesma carteira e se sobrescreveriam — PERDENDO pacotes do contador. Lá é
    // uma transação só: ou saem os dez, ou nenhum.
    body: { p_booster: nomeDoBooster, p_qtd: Math.max(1, Math.min(10, Number(quantos) || 1)) },
  });
  if (!r.ok) return { ok: false, error: motivo(r, 'não consegui abrir o pacote') };
  guardarCache(r.dados.carteira);
  return { ok: true, cartas: r.dados.cartas ?? [], pacotes: r.dados.pacotes ?? 1 };
}

/**
 * Quantas vezes venci (e perdi para) cada adversário — `{ <npc>: {vitorias,
 * derrotas} }`. NÃO são consecutivas: é o total.
 *
 * O `group by` é do banco (migration 0045). Um `select` direto em `duelos`
 * funcionaria pela RLS, mas traria TODAS as linhas para o navegador contar no
 * laço — quem tem 300 duelos baixaria 300 registros para desenhar meia dúzia
 * de números.
 */
export async function vitoriasPorNpc() {
  if (!sessao()) return {};
  const r = await req('rpc/vitorias_por_npc', { method: 'POST', body: {} });
  return r.ok && r.dados && typeof r.dados === 'object' ? r.dados : {};
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
/**
 * Registra o DESFECHO do duelo — `vitoria`, `derrota`, `empate` ou `abandonado`.
 *
 * Antes só a vitória deixava rastro (era o que pagava). Perder e empatar não
 * gravavam nada, e o banco ficava com duelos eternamente "em aberto" — sem base
 * para estatística, nem para ver um padrão estranho.
 *
 * Vitória paga junto, pelo mesmo caminho de sempre. Se o prêmio for recusado (um
 * duelo curto demais, por exemplo), o RESULTADO fica registrado mesmo assim:
 * perder o dado permanente por causa do efeito colateral seria a troca errada.
 *
 * Isto NÃO prova a vitória — quem diz "venci" continua sendo o cliente. Só a
 * arena resolve, e é outro projeto.
 *
 * `duel.html` importa esta função. Ela chegou a sumir daqui — um commit de
 * outra máquina, feito por cima de uma cópia mais velha do arquivo, a
 * substituiu por `creditarDP` e deixou o import quebrado em `main` sem
 * ninguém notar. As duas convivem: são coisas diferentes.
 */
export async function encerrarDuelo(dueloId, resultado) {
  if (!dueloId) return { ok: false, error: 'sem duelo registrado' };
  const r = await req('rpc/encerrar_duelo', {
    method: 'POST',
    body: { p_duelo: dueloId, p_resultado: resultado },
  });
  if (!r.ok) return { ok: false, error: r.error };
  const d = r.dados ?? {};
  // `cartas` é a lista sorteada no pool do NPC (migration 0027); `carta` é o
  // campo antigo, de uma carta só, mantido para um servidor que ainda não tenha
  // essa migration — quem lê decide qual usar.
  //
  // `drops` é o MESMO sorteio com duas coisas que só o servidor sabe (migration
  // 0029): a GAVETA de onde a carta saiu — que é a raridade de verdade do
  // prêmio, e não a que ela tem nos boosters — e se ela é NOVA na Coleção, o que
  // só dá para responder antes do crédito. Vem `null` de um servidor sem a 0029.
  return { ok: true, resultado: d.resultado, premio: d.premio?.premio ?? null,
           cartas: Array.isArray(d.premio?.cartas) ? d.premio.cartas : null,
           drops: Array.isArray(d.premio?.drops) ? d.premio.drops : null,
           carta: d.premio?.carta ?? null, recusado: d.premio_recusado ?? null };
}

/**
 * Credita (ou debita, com valor negativo) DP — **só admin**.
 *
 * É a exceção deliberada à regra da migration 0004 ("DP só pela Loja e por
 * vencer Adversário"): quem administra o jogo precisa de saldo para testar
 * Loja, booster e estrutural, e mandar abrir o SQL Editor a cada teste é
 * atrito. Quem barra é a RLS no servidor (`eh_admin()`), não esta função —
 * jogador comum leva a recusa mesmo chamando na mão pelo console.
 */
export async function creditarDP(valor) {
  const r = await req('rpc/creditar_dp', {
    method: 'POST',
    body: { p_valor: Math.trunc(Number(valor) || 0) },
  });
  if (!r.ok) return { ok: false, error: motivo(r, 'nao consegui creditar') };
  // Relê a carteira: o RPC devolve só os números, e o cache guarda o objeto
  // inteiro (coleção, pity). Sem isto o saldo na tela ficaria velho.
  await hydrateWallet();
  return { ok: true, antes: r.dados?.antes ?? 0, depois: r.dados?.depois ?? 0 };
}

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
/**
 * **Contra quem o jogador já venceu**, direto do banco.
 *
 * É o que libera a Trilha de Duelos: cada adversário abre o próximo depois da
 * vitória. Mora no servidor de propósito — progresso não pode ser preferência
 * de navegador, senão trocar de máquina (ou limpar o site) apaga a campanha
 * inteira, e editar um `localStorage` liberaria a trilha toda.
 *
 * A RLS de `duelos` já filtra por `usuario_id = auth.uid()`, então a consulta
 * devolve só os DESTA conta sem precisar mandar quem é.
 *
 * @returns {Promise<Set<string>>} ids dos NPCs vencidos (vazio sem sessão).
 */
export async function npcsVencidos() {
  if (!sessao()) return new Set();
  const r = await req('duelos?select=npc&resultado=eq.vitoria');
  if (!r.ok || !Array.isArray(r.dados)) return new Set();
  return new Set(r.dados.map((d) => d.npc).filter(Boolean));
}

/**
 * Quais DECKS de cada adversário este jogador já derrotou.
 *
 *     { para_dox: Set{'Bem-vindo ao Labirinto'}, wevil: Set{...} }
 *
 * Separado de `npcsVencidos` porque responde outra pergunta: aquele libera o
 * PRÓXIMO ADVERSÁRIO da trilha, este libera o PRÓXIMO DECK do mesmo adversário
 * (`decksnpc.js`). Vitória anterior à migration 0033 não tem `deck_npc` e fica
 * de fora — ela não sabe qual deck caiu, e chutar destrancaria de graça o deck
 * difícil de quem só venceu o fácil.
 */
export async function decksVencidos() {
  if (!sessao()) return {};
  const r = await req('duelos?select=npc,deck_npc&resultado=eq.vitoria');
  if (!r.ok || !Array.isArray(r.dados)) return {};
  const out = {};
  for (const d of r.dados) {
    if (!d?.npc || !d?.deck_npc) continue;
    (out[d.npc] ??= new Set()).add(String(d.deck_npc));
  }
  return out;
}

/**
 * Abre o registro do duelo. `deckNpc` é o NOME do deck do adversário — é ele
 * que decide, no servidor, de que pool o drop sai e qual deck a vitória
 * destranca. Sem ele o servidor cai no pool do NPC, como antes.
 *
 * `cartas` é o MAIN + EXTRA que o motor vai receber, uma entrada por cópia.
 * É por ele que a banlist finalmente alcança o duelo (`iniciar_duelo`,
 * migration 0047): `salvar_deck` sempre cobrou a regra, mas o duelo não passa
 * por ele — o deck sai do `localStorage` e vai direto para o motor local, e o
 * único servidor no caminho recebia só o NOME do deck. Recusar salvar e deixar
 * jogar é a regra existindo nas duas pontas erradas.
 *
 * Devolve `{ id, erro }`, e não o id solto: o `erro` é o RECADO do banco — a
 * parede de versão configurada pelo admin ("peça o instalador novo") ou a carta
 * que está acima do teto. Ele era jogado fora aqui, e o duelo simplesmente não
 * era registrado: a partida rodava inteira e o prêmio era recusado no fim, sem
 * ninguém saber por quê.
 */
export async function iniciarDuelo(npcId, deckNpc, cartas) {
  const r = await req('rpc/iniciar_duelo', {
    method: 'POST',
    body: {
      p_npc: String(npcId ?? ''),
      ...(deckNpc ? { p_deck_npc: String(deckNpc) } : {}),
      // As cartas do deck do JOGADOR. Só vão quando há alguma: mandar uma lista
      // vazia diria ao banco "vou jogar com deck nenhum", e ele leria isso como
      // um deck em regra — o contrário de omitir, que faz o servidor conferir o
      // que estiver SALVO com aquele nome.
      ...(cartas?.length ? { p_cartas: cartas.map(Number) } : {}),
      // QUAL VERSAO ESTA PEDINDO PARA JOGAR. O banco compara com o piso
      // (`versao_minima`, migration 0041) e recusa abaixo dele — e um cliente
      // velho nao manda estes campos, que e' exatamente como ele e'
      // reconhecido: vazio nao alcanca piso nenhum.
      ...(await selo()),
    },
  });
  return { id: r.ok ? r.dados : null, erro: r.ok ? null : (r.error || 'nao consegui registrar o duelo') };
}

/**
 * Banlist — camada OPCIONAL por cima de uma lista de cartas (`cardlists.js`;
 * hoje só a Lista 1). `deck.js` documenta que a validação oficial (min/max,
 * máximo de 3 cópias) é "sem banlist, como pedido"; isto aqui é a peça que
 * faltava, mas deliberadamente FORA de `Deck.validate()` — é outro tipo de
 * regra (uma restrição de mesa, não regra de construção), então mora no seu
 * próprio módulo e quem quiser aplica (`validateBanlist`).
 *
 * TRÊS regras independentes, aplicadas JUNTAS sobre o mesmo deck:
 *
 *   1. **Ponto**: cada carta tagueada em `cardPoints` cobra esse custo POR
 *      CÓPIA (2 cópias de uma carta de 5 pontos = 10 pontos). A soma de
 *      Main+Extra não pode passar de `pointBudget`.
 *   2. **Banlist**: o que existe hoje oficialmente no TCG — uma carta em
 *      `cardLimits` fica presa a um teto INDIVIDUAL (1 = Limitada, 2 =
 *      Semilimitada), sem dividir nada com nenhuma outra carta. Duas cartas
 *      diferentes limitadas a 1 cada permitem 1 de CADA uma (2 no total),
 *      exatamente como Pot of Greed limitado e Solemn Judgment limitado não
 *      competem entre si na banlist oficial.
 *   3. **Lista compartilhada**: uma carta em `cardGroups` entra num grupo
 *      identificado por um número — esse número É o teto de cópias somando
 *      TODAS as cartas daquele grupo (Main+Extra juntos). É o mecanismo pra
 *      "Pote da Ganância limitado a 2 E Foolish Burial também, mas juntos
 *      não passam de 2" (1 de cada, ou 2 de um só) — o que a banlist normal
 *      NÃO consegue expressar, porque lá cada carta tem seu próprio teto.
 *
 * Cartas sem entrada em nenhum dos três mapas não são afetadas por regra
 * nenhuma (ficam no limite padrão de 3 cópias do `deck.js`).
 *
 * Persistência: mesmo padrão de `boosters.js`/`wallet.js` — localStorage é a
 * cópia de trabalho síncrona, `store/banlist.json` é a verdade versionada.
 */
import { pushFileGuardado, pullFileEx } from './projectstore.js';

const KEY = 'ygo:banlist';
const AXES = ['points', 'limit', 'group'];

/** Identidade de uma regra: o par (tipo, valor) já basta — "1 no eixo limit" só existe uma vez. */
function ruleId(type, value) { return `${type}:${value}`; }

function mapOf(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? { ...v } : {};
}

/** Qual mapa (cardPoints/cardLimits/cardGroups) pertence a este eixo. */
function mapFor(banlist, type) {
  return type === 'points' ? banlist.cardPoints
       : type === 'limit' ? banlist.cardLimits
       : banlist.cardGroups;
}

function normalize(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const listId = typeof b.listId === 'string' && b.listId ? b.listId : 'lista1';
  const cardPoints = mapOf(b.cardPoints);
  const cardLimits = mapOf(b.cardLimits);
  const cardGroups = mapOf(b.cardGroups);

  // `rules` é só bookkeeping do EDITOR (web/banlist.html): lembra quais campos
  // existem mesmo vazios (criados mas sem carta ainda). `validateBanlist`
  // nunca olha isto — só os três mapas acima importam pra validação.
  const rules = [];
  const seen = new Set();
  const addRuleEntry = (type, value) => {
    const v = Math.floor(Number(value));
    if (!(v > 0)) return;
    const id = ruleId(type, v);
    if (seen.has(id)) return;
    seen.add(id);
    rules.push({ id, type, value: v });
  };
  if (Array.isArray(b.rules)) {
    for (const r of b.rules) if (r && AXES.includes(r.type)) addRuleEntry(r.type, r.value);
  }
  // Reconstitui regras que têm carta mas não estavam na lista (ex.: JSON
  // editado na mão, ou banlist salva antes de `rules` existir).
  for (const v of Object.values(cardPoints)) addRuleEntry('points', v);
  for (const v of Object.values(cardLimits)) addRuleEntry('limit', v);
  for (const v of Object.values(cardGroups)) addRuleEntry('group', v);

  return {
    listId,
    pointBudget: Math.max(0, Number(b.pointBudget) || 0),
    cardPoints, cardLimits, cardGroups, rules,
  };
}

export function defaultBanlist() { return normalize(null); }

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? defaultBanlist() : normalize(JSON.parse(raw));
  } catch { return defaultBanlist(); }
}

// Mesma trava do wallet.js/boosters.js: só espelha no projeto depois de ter
// lido o disco, senão uma gravação antes do hydrate arrisca um pull
// posterior sobrescrever a própria mudança recém-feita.
let leuODisco = false;

function write(banlist) {
  const n = normalize(banlist);
  try {
    localStorage.setItem(KEY, JSON.stringify(n));
    // Sem ter lido a fonte a edicao NAO e' descartada: vai para a fila e sobe
    // sozinha depois (`pushFileGuardado`, em projectstore.js).
    pushFileGuardado('banlist', n, leuODisco);   // store/banlist.json (vai no git)
    return true;
  } catch (e) {
    console.error('[banlist] falha ao gravar', e);
    return false;
  }
}

/** Traz store/banlist.json (disco) para o localStorage. Chame no boot. */
export async function hydrateBanlist() {
  const { alcancou, data } = await pullFileEx('banlist');
  leuODisco = alcancou;
  if (!alcancou) {
    console.warn('[banlist] sem servidor: usando só o localStorage, sem gravar no disco');
    return false;
  }
  if (data === null || data === undefined) return false;
  try { localStorage.setItem(KEY, JSON.stringify(normalize(data))); return true; }
  catch { return false; }
}

export function getBanlist() { return read(); }

/** Grava a banlist inteira (o editor mantém o estado em memória e salva de uma vez). */
export function saveBanlist(banlist) { return write(banlist); }

/**
 * Cria um campo de regra vazio ("Ponto: 10", "Banlist: 1", "Grupo: 2") — o
 * editor chama isto ANTES de qualquer carta existir nele. Regra duplicada
 * (mesmo tipo e valor) é ignorada, não gera uma segunda cópia.
 */
export function addRule(banlist, type, value) {
  const v = Math.floor(Number(value));
  if (!(v > 0) || !AXES.includes(type)) return banlist;
  const id = ruleId(type, v);
  if (!banlist.rules.some((r) => r.id === id)) {
    banlist.rules.push({ id, type, value: v });
  }
  return banlist;
}

/** Remove o campo de regra inteiro — as cartas que estavam nele voltam a ficar sem regra. */
export function removeRule(banlist, id) {
  const rule = banlist.rules.find((r) => r.id === id);
  if (!rule) return banlist;
  banlist.rules = banlist.rules.filter((r) => r.id !== id);
  const map = mapFor(banlist, rule.type);
  for (const cid of Object.keys(map)) {
    if (Number(map[cid]) === rule.value) delete map[cid];
  }
  return banlist;
}

/**
 * Põe uma carta dentro de um campo de regra. Cada eixo (pontos/banlist/
 * grupo) é independente, mas uma carta só pode estar em UM valor do MESMO
 * eixo por vez — atribuir a um novo campo do mesmo eixo SUBSTITUI (não soma)
 * uma atribuição anterior.
 */
export function assignCardToRule(banlist, ruleIdTarget, cardId) {
  const rule = banlist.rules.find((r) => r.id === ruleIdTarget);
  if (!rule) return banlist;
  mapFor(banlist, rule.type)[String(cardId)] = rule.value;
  return banlist;
}

/** Tira a carta do eixo indicado (points/limit/group), qualquer que seja o valor atual. */
export function unassignCard(banlist, type, cardId) {
  delete mapFor(banlist, type)[String(cardId)];
  return banlist;
}

/** IDs das cartas dentro de um campo de regra — para o editor desenhar o bloco. */
export function cardsInRule(banlist, rule) {
  const map = mapFor(banlist, rule.type);
  return Object.keys(map).filter((cid) => Number(map[cid]) === rule.value).map(Number);
}

/**
 * Confere um Deck ({main:[ids], extra:[ids]}) contra a banlist. Conta
 * Main+Extra JUNTOS: a mesma carta em zonas diferentes ainda é a mesma carta
 * pra pontos/banlist/grupo (mesmo espírito da banlist oficial, que também
 * não separa por zona).
 * @returns {{ok: boolean, problems: Array, spent: number}}
 */
export function validateBanlist(deck, banlist) {
  const b = normalize(banlist);
  const all = [...(deck?.main ?? []), ...(deck?.extra ?? [])];
  const countOf = new Map();
  for (const id of all) countOf.set(id, (countOf.get(id) ?? 0) + 1);

  const problems = [];

  // 1. Ponto — orçamento agregado do deck inteiro.
  let gasto = 0;
  for (const [id, n] of countOf) {
    gasto += (Number(b.cardPoints[String(id)]) || 0) * n;
  }
  if (b.pointBudget > 0 && gasto > b.pointBudget) {
    problems.push({ type: 'points', spent: gasto, budget: b.pointBudget });
  }

  // 2. Banlist — teto INDIVIDUAL, cada carta por si (sem dividir com ninguém).
  for (const [id, n] of countOf) {
    const lim = Number(b.cardLimits[String(id)]) || 0;
    if (lim > 0 && n > lim) {
      problems.push({ type: 'limit', card: id, count: n, limit: lim });
    }
  }

  // 3. Lista compartilhada — teto somando TODAS as cartas do mesmo grupo.
  const porGrupo = new Map();   // grupo -> { soma, cartas: Map(id -> n) }
  for (const [id, n] of countOf) {
    const g = Number(b.cardGroups[String(id)]) || 0;
    if (!g) continue;
    const cur = porGrupo.get(g) ?? { soma: 0, cartas: new Map() };
    cur.soma += n;
    cur.cartas.set(id, n);
    porGrupo.set(g, cur);
  }
  for (const [grupo, info] of porGrupo) {
    if (info.soma > grupo) {
      problems.push({ type: 'group', group: grupo, count: info.soma, cards: [...info.cartas.keys()] });
    }
  }

  return { ok: problems.length === 0, problems, spent: gasto };
}

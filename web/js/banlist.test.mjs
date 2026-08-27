/**
 * Testes da banlist: Ponto (orçamento), Banlist (teto individual) e Lista
 * compartilhada (cópias divididas entre cartas).
 *   node web/js/banlist.test.mjs
 */
import {
  defaultBanlist, validateBanlist, textoDoProblema,
  addRule, removeRule, assignCardToRule, unassignCard, cardsInRule,
} from './banlist.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${name}\n        ${e.message}`); fail++; }
};

const deck = (main = [], extra = []) => ({ main, extra });

console.log('\n=== sem banlist configurada ===');
t('deck vazio de regras nunca acusa problema', () => {
  const r = validateBanlist(deck([1, 1, 2, 3]), defaultBanlist());
  assert.equal(r.ok, true);
  assert.equal(r.problems.length, 0);
});

console.log('\n=== Ponto (orçamento agregado do deck) ===');
t('gasta pontos POR CÓPIA, não por carta única', () => {
  const b = { ...defaultBanlist(), pointBudget: 100, cardPoints: { 1: 5 } };
  const r = validateBanlist(deck([1, 1, 1]), b);   // 3 cópias x 5 = 15
  assert.equal(r.spent, 15);
  assert.equal(r.ok, true);
});
t('estoura o orçamento acusa problema type=points', () => {
  const b = { ...defaultBanlist(), pointBudget: 10, cardPoints: { 1: 5 } };
  const r = validateBanlist(deck([1, 1, 1]), b);   // 15 > 10
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].type, 'points');
  assert.equal(r.problems[0].spent, 15);
  assert.equal(r.problems[0].budget, 10);
});
t('conta Main + Extra juntos', () => {
  const b = { ...defaultBanlist(), pointBudget: 10, cardPoints: { 9: 4 } };
  const r = validateBanlist(deck([9], [9]), b);    // 2 cópias x 4 = 8
  assert.equal(r.spent, 8);
  assert.equal(r.ok, true);
});
t('carta sem valor definido não gasta ponto nenhum', () => {
  const b = { ...defaultBanlist(), pointBudget: 1, cardPoints: {} };
  const r = validateBanlist(deck([1, 2, 3]), b);
  assert.equal(r.spent, 0);
  assert.equal(r.ok, true);
});
t('pointBudget 0/ausente = sem teto (mesmo com custo definido)', () => {
  const b = { ...defaultBanlist(), cardPoints: { 1: 999 } };
  const r = validateBanlist(deck([1, 1, 1]), b);
  assert.equal(r.ok, true);
});

console.log('\n=== Banlist (teto INDIVIDUAL, sem dividir com outras cartas) ===');
t('carta Limitada (1): aceita 1, recusa 2', () => {
  const b = { ...defaultBanlist(), cardLimits: { 1: 1 } };
  assert.equal(validateBanlist(deck([1]), b).ok, true);
  const r = validateBanlist(deck([1, 1]), b);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].type, 'limit');
  assert.equal(r.problems[0].card, 1);
  assert.equal(r.problems[0].count, 2);
  assert.equal(r.problems[0].limit, 1);
});
t('carta Semilimitada (2): aceita 2, recusa 3', () => {
  const b = { ...defaultBanlist(), cardLimits: { 1: 2 } };
  assert.equal(validateBanlist(deck([1, 1]), b).ok, true);
  assert.equal(validateBanlist(deck([1, 1, 1]), b).ok, false);
});
t('DUAS cartas limitadas a 1 cada NÃO competem entre si (1 de cada = ok)', () => {
  const b = { ...defaultBanlist(), cardLimits: { 1: 1, 2: 1 } };
  // é aqui que Banlist difere de Lista compartilhada: cada carta tem SEU
  // próprio teto, então 1+1 = 2 cópias no deck, sem problema nenhum.
  const r = validateBanlist(deck([1, 2]), b);
  assert.equal(r.ok, true);
});
t('carta sem limite definido usa o teto padrão do deck.js (não entra aqui)', () => {
  const b = { ...defaultBanlist(), cardLimits: {} };
  const r = validateBanlist(deck([1, 1, 1]), b);
  assert.equal(r.ok, true);
});

console.log('\n=== Lista compartilhada (cópias divididas entre cartas) ===');
t('grupo 1 sozinho se comporta como "Limitada" clássica', () => {
  const b = { ...defaultBanlist(), cardGroups: { 1: 1 } };
  const ok = validateBanlist(deck([1]), b);
  assert.equal(ok.ok, true);
  const estourou = validateBanlist(deck([1, 1]), b);
  assert.equal(estourou.ok, false);
  assert.equal(estourou.problems[0].type, 'group');
  assert.equal(estourou.problems[0].group, 1);
  assert.equal(estourou.problems[0].count, 2);
});
t('grupo 2 sozinho se comporta como "Semilimitada" clássica', () => {
  const b = { ...defaultBanlist(), cardGroups: { 1: 2 } };
  assert.equal(validateBanlist(deck([1, 1]), b).ok, true);
  assert.equal(validateBanlist(deck([1, 1, 1]), b).ok, false);
});
t('Pote da Ganância + Foolish no grupo 2: só 1 de cada, ou 2 de um só', () => {
  const b = { ...defaultBanlist(), cardGroups: { 55144522: 2, 81439173: 2 } };
  assert.equal(validateBanlist(deck([55144522, 81439173]), b).ok, true);          // 1 e 1
  assert.equal(validateBanlist(deck([55144522, 55144522]), b).ok, true);          // 2 e 0
  const r = validateBanlist(deck([55144522, 55144522, 81439173]), b);             // 2 e 1 = 3 > 2
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].group, 2);
  assert.equal(r.problems[0].count, 3);
});
t('duas cartas diferentes no MESMO grupo "3" dividem a cota', () => {
  const b = { ...defaultBanlist(), cardGroups: { 1: 3, 2: 3 } };
  // 2 cópias da carta 1 + 1 cópia da carta 2 = 3 no grupo -> ok
  assert.equal(validateBanlist(deck([1, 1, 2]), b).ok, true);
  // 2 + 2 = 4 no grupo -> estoura, mesmo cada carta isolada valendo <=3
  const r = validateBanlist(deck([1, 1, 2, 2]), b);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].group, 3);
  assert.equal(r.problems[0].count, 4);
  assert.deepEqual(new Set(r.problems[0].cards), new Set([1, 2]));
});
t('grupos diferentes não interferem entre si', () => {
  const b = { ...defaultBanlist(), cardGroups: { 1: 1, 2: 2 } };
  const r = validateBanlist(deck([1, 2, 2]), b);   // grupo1: 1 copia (ok); grupo2: 2 copias (ok)
  assert.equal(r.ok, true);
});
t('carta sem grupo não é afetada pela regra de grupo', () => {
  const b = { ...defaultBanlist(), cardGroups: { 1: 1 } };
  const r = validateBanlist(deck([2, 2, 2]), b);   // carta 2 não está em nenhum grupo
  assert.equal(r.ok, true);
});

console.log('\n=== as três regras juntas ===');
t('Ponto + Banlist + Lista compartilhada valem ao mesmo tempo sobre o mesmo deck', () => {
  const b = {
    ...defaultBanlist(), pointBudget: 10,
    cardPoints: { 1: 6 }, cardLimits: { 2: 1 }, cardGroups: { 1: 1 },
  };
  // carta 1: 2 cópias -> estoura o grupo (máx 1) E o orçamento (12 > 10)
  // carta 2: 2 cópias -> estoura o limite individual (máx 1)
  const r = validateBanlist(deck([1, 1, 2, 2]), b);
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 3);
  assert.deepEqual(new Set(r.problems.map((p) => p.type)), new Set(['points', 'limit', 'group']));
});

console.log('\n=== campos de regra (editor: web/banlist.html) ===');
t('addRule cria um campo vazio; duplicar (mesmo tipo+valor) não repete', () => {
  const b = defaultBanlist();
  addRule(b, 'group', 1);
  addRule(b, 'group', 1);
  assert.equal(b.rules.length, 1);
  assert.equal(b.rules[0].id, 'group:1');
});
t('assignCardToRule grava no eixo certo (points/limit/group)', () => {
  const b = defaultBanlist();
  addRule(b, 'points', 10);
  addRule(b, 'limit', 1);
  addRule(b, 'group', 2);
  assignCardToRule(b, 'points:10', 55144522);
  assignCardToRule(b, 'limit:1', 55144522);
  assignCardToRule(b, 'group:2', 55144522);
  assert.equal(b.cardPoints['55144522'], 10);
  assert.equal(b.cardLimits['55144522'], 1);
  assert.equal(b.cardGroups['55144522'], 2);
});
t('atribuir a uma NOVA regra do mesmo eixo move a carta (não soma)', () => {
  const b = defaultBanlist();
  addRule(b, 'points', 5);
  addRule(b, 'points', 10);
  assignCardToRule(b, 'points:5', 1);
  assignCardToRule(b, 'points:10', 1);   // move de 5 pra 10
  assert.equal(b.cardPoints['1'], 10);
  assert.deepEqual(cardsInRule(b, b.rules.find((r) => r.id === 'points:5')), []);
  assert.deepEqual(cardsInRule(b, b.rules.find((r) => r.id === 'points:10')), [1]);
});
t('unassignCard tira a carta do eixo, sem mexer nos outros', () => {
  const b = defaultBanlist();
  addRule(b, 'points', 5); addRule(b, 'limit', 1); addRule(b, 'group', 1);
  assignCardToRule(b, 'points:5', 1);
  assignCardToRule(b, 'limit:1', 1);
  assignCardToRule(b, 'group:1', 1);
  unassignCard(b, 'points', 1);
  assert.equal(b.cardPoints['1'], undefined);
  assert.equal(b.cardLimits['1'], 1);
  assert.equal(b.cardGroups['1'], 1);
});
t('removeRule apaga o campo E desatribui as cartas que estavam nele', () => {
  const b = defaultBanlist();
  addRule(b, 'group', 3);
  assignCardToRule(b, 'group:3', 1);
  assignCardToRule(b, 'group:3', 2);
  removeRule(b, 'group:3');
  assert.equal(b.rules.length, 0);
  assert.equal(b.cardGroups['1'], undefined);
  assert.equal(b.cardGroups['2'], undefined);
});
t('normalize reconstrói regras de uma banlist salva sem `rules` (compat)', () => {
  // simula um JSON salvo por uma versão anterior, sem o array `rules`
  const r = validateBanlist({ main: [1, 1], extra: [] },
    { pointBudget: 0, cardPoints: { 1: 7 }, cardGroups: {} });
  assert.equal(r.spent, 14);   // prova que cardPoints continua funcionando sem `rules`
});
t('defaultBanlist traz listId = "lista1"', () => {
  assert.equal(defaultBanlist().listId, 'lista1');
});

console.log('\n=== a frase do problema (a MESMA no builder e na porta do duelo) ===');
const nome = (id) => ({ 10667321: 'Card Destruction', 5053103: 'Battle Ox' })[id] ?? String(id);

t('teto: diz a carta, quantas tem e quantas cabem', () => {
  assert.equal(textoDoProblema({ type: 'limit', card: 10667321, count: 3, limit: 1 }, nome),
               'Card Destruction tem 3 cópias (máximo 1)');
});
t('teto ZERO e a carta BANIDA, e nao "maximo 0 copias"', () => {
  // Banida não é o degrau abaixo de Limitada: "máximo 0" faria o jogador
  // procurar a versão permitida de uma carta que não pode estar no deck.
  assert.equal(textoDoProblema({ type: 'limit', card: 10667321, count: 1, limit: 0 }, nome),
               'Card Destruction está BANIDA');
});
t('ponto e grupo tambem tem frase', () => {
  assert.match(textoDoProblema({ type: 'points', spent: 12, budget: 10 }, nome), /12\/10 pontos/);
  assert.match(textoDoProblema({ type: 'group', group: 2, count: 3, cards: [10667321, 5053103] }, nome),
               /Card Destruction e Battle Ox dividem 2 cópias, e o deck tem 3/);
});
t('sem nome resolvido, sai o CODIGO — nunca um nome inventado', () => {
  assert.equal(textoDoProblema({ type: 'limit', card: 42, count: 2, limit: 1 }),
               '42 tem 2 cópias (máximo 1)');
});
t('problema desconhecido devolve vazio (a tela nao mostra linha em branco com lixo)', () => {
  assert.equal(textoDoProblema(null), '');
  assert.equal(textoDoProblema({ type: 'coisa-nova' }), '');
});

console.log(`\n${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);

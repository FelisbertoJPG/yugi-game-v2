/**
 * Testes das listas de cartas — o pool permitido que o editor da Área de Teste
 * (`web/listas.html`) publica e que `salvar_deck` confere no servidor.
 *   node web/js/cardlists.test.mjs
 *
 * O que aqui importa é o que dá erro CALADO: uma lista publicada com o
 * conjunto errado não quebra nada na hora — o jogador só descobre quando o
 * servidor recusa um deck que a tela mostrou como legal.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import {
  CARD_LISTS, getCardList, aplicarListas, fonteDasListas, resolverLista,
} from './cardlists.js';
import {
  inLista1, LISTA1_SPELLTRAP, LISTA1_TIPOS, fonteDaLista1, aplicarObteniveis,
} from './lista1.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${name}\n        ${e.message}`); fail++; }
};

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const idx = JSON.parse(await readFile(join(ROOT, 'ygo-data', 'data', 'cards.index.json'), 'utf8'));
const TODAS = Array.isArray(idx) ? idx : (idx.cards ?? idx.data ?? Object.values(idx)[0]);

/**
 * O índice SEM arte alternativa — que é o que o navegador entrega a
 * `salvarListas`, porque lá a fonte é `db.filter({})` e o `filter` da `YgoDB`
 * descarta `alt` por padrão.
 *
 * Fazer o mesmo aqui não é detalhe: são 100 cartas de diferença, e sem isto o
 * número deste arquivo nunca podia bater com o de `conteudo/lista1` no banco —
 * ou seja, o teste dizia conferir contra o publicado e conferia contra outra
 * conta. Arte alternativa é a MESMA carta com outro id; ela não entra no pool.
 */
const CARTAS = TODAS.filter((c) => !c.alt);

/** Volta ao padrão de fábrica entre um teste e outro (o módulo tem estado). */
const padrao = () => aplicarListas([
  { id: 'lista1', label: 'Lista 1', tipos: [...LISTA1_TIPOS], ids: [...LISTA1_SPELLTRAP] },
]);

console.log('\n=== padrão de fábrica ===');
t('CARD_LISTS nasce com a Lista 1', () => {
  padrao();
  assert.equal(CARD_LISTS.length, 1);
  assert.equal(CARD_LISTS[0].id, 'lista1');
  assert.equal(CARD_LISTS[0].filter, inLista1);   // o mesmo import que o Deck Builder usa
});
t('getCardList cai na primeira lista quando o id não existe', () => {
  padrao();
  assert.equal(getCardList('nao-existe').id, 'lista1');
});
t('a regra casa o tipo EXATO, não por prefixo', () => {
  padrao();
  // `Tuner/Normal Monster` e `Pendulum/Normal Monster` NÃO estão na Lista 1.
  // Um `includes('Normal Monster')` aqui traria 51 cartas em silêncio.
  assert.equal(inLista1({ id: -1, t: 'M', tl: 'Normal Monster' }), true);
  assert.equal(inLista1({ id: -1, t: 'M', tl: 'Tuner/Normal Monster' }), false);
  assert.equal(inLista1({ id: -1, t: 'M', tl: 'Pendulum/Normal Monster' }), false);
});
t('carta avulsa entra mesmo não sendo monstro', () => {
  padrao();
  assert.equal(inLista1({ id: 44095762, t: 'T', tl: 'Normal Trap' }), true);   // Mirror Force
  assert.equal(inLista1({ id: 1, t: 'T', tl: 'Normal Trap' }), false);
});

console.log('\n=== resolução contra o índice (o que o servidor recebe) ===');
t('a Lista 1 resolvida bate com o total publicado (1086)', () => {
  padrao();
  // Se este número mudar sem ninguém ter mexido na lista, foi um
  // `npm run data:build` — e aí o `conteudo/lista1` no banco está velho.
  //
  // Em 14/08/2026 este teste passou a contar sem arte alternativa (ver CARTAS)
  // e o padrão de fábrica foi sincronizado com a lista VIVA, que tinha 22
  // cartas a mais publicadas pelo editor (`web/listas.html`) e nunca trazidas
  // de volta para cá: os pacotes do Relinquished, da fusão e do Toon, as
  // contínuas de apoio e o Armory Call. Antes disso, instalação nova e offline
  // recusava deck com qualquer uma delas — a lista embutida discordava da
  // publicada, que é exatamente o que `aplicarLista1` existe para evitar.
  //
  // Junto entraram as quatro cartas que os BOOSTERS já vendiam e a Lista 1 não
  // conhecia — De-Spell (19159413), Ritual Cage (25796442), Birthright
  // (35539880) e Swing of Memories (96765646). Ver `--test-cartas-booster`.
  //
  // 1086 é o mesmo número de `conteudo/lista1` no banco. Se os dois deixarem de
  // bater, um dos lados está velho.
  assert.equal(resolverLista(fonteDasListas()[0], CARTAS).length, 1086);
});
t('resolver = exatamente quem passa no filtro', () => {
  padrao();
  const ids = resolverLista(fonteDasListas()[0], CARTAS);
  assert.equal(ids.length, CARTAS.filter(inLista1).length);
  assert.ok(ids.includes(44095762));       // Mirror Force, avulsa
  assert.ok(!ids.includes(2511));          // Labrynth Cooclock, Effect Monster
});
t('id avulso que sumiu do índice continua na lista resolvida', () => {
  // Some sem avisar seria pior: o deck de NPC que usa a carta pararia de
  // validar e ninguém saberia que a causa foi um id errado.
  const ids = resolverLista({ id: 'x', label: 'x', tipos: [], ids: [999999999] }, CARTAS);
  assert.deepEqual(ids, [999999999]);
});
t('a lista resolvida sai ordenada e sem repetição', () => {
  const ids = resolverLista({ id: 'x', label: 'x', tipos: ['Fusion Monster'], ids: [44095762, 44095762] }, CARTAS);
  assert.deepEqual(ids, [...new Set(ids)].sort((a, b) => a - b));
});

console.log('\n=== publicar mexe no filtro que o resto do jogo usa ===');
t('acrescentar uma carta à Lista 1 muda inLista1 na hora', () => {
  padrao();
  const carta = { id: 2511, t: 'M', tl: 'Effect Monster' };
  assert.equal(inLista1(carta), false);
  const [l1] = fonteDasListas();
  aplicarListas([{ ...l1, ids: [...l1.ids, 2511] }]);
  assert.equal(inLista1(carta), true);
  padrao();
  assert.equal(inLista1(carta), false);
});
t('desmarcar um tipo tira o pool inteiro dele', () => {
  padrao();
  const [l1] = fonteDasListas();
  aplicarListas([{ ...l1, tipos: ['Normal Monster'] }]);
  assert.equal(inLista1({ id: -1, t: 'M', tl: 'Fusion Monster' }), false);
  assert.equal(inLista1({ id: -1, t: 'M', tl: 'Normal Monster' }), true);
  padrao();
});
t('uma segunda lista ganha filtro próprio, sem tocar na Lista 1', () => {
  padrao();
  const [l1] = fonteDasListas();
  aplicarListas([l1, { id: 'lista2', label: 'Lista 2', tipos: ['Xyz/Effect Monster'], ids: [] }]);
  const l2 = getCardList('lista2');
  assert.equal(l2.filter({ id: -1, t: 'M', tl: 'Xyz/Effect Monster' }), true);
  assert.equal(l2.filter({ id: 44095762, t: 'T', tl: 'Normal Trap' }), false);   // avulsa da Lista 1
  assert.equal(inLista1({ id: 44095762, t: 'T', tl: 'Normal Trap' }), true);     // e a Lista 1 intacta
  padrao();
});
t('CARD_LISTS é o MESMO array depois de aplicar (banlist.html importa a referência)', () => {
  const antes = CARD_LISTS;
  aplicarListas([{ id: 'so-esta', label: 'x', tipos: [], ids: [1] }]);
  assert.equal(CARD_LISTS, antes);
  assert.equal(CARD_LISTS.length, 1);
  padrao();
});
t('sem lista nenhuma volta ao padrão em vez de recusar o jogo todo', () => {
  aplicarListas([]);
  assert.equal(CARD_LISTS.length, 1);
  assert.equal(CARD_LISTS[0].id, 'lista1');
  assert.equal(fonteDaLista1().ids.length, LISTA1_SPELLTRAP.length);
});
t('publicar sem a Lista 1 restaura o padrão dela (não deixa um pool vazio)', () => {
  aplicarListas([{ id: 'lista2', label: 'Lista 2', tipos: [], ids: [1] }]);
  assert.equal(getCardList('lista1'), CARD_LISTS[0]);   // não existe: cai na primeira
  assert.equal(inLista1({ id: 44095762, t: 'T', tl: 'Normal Trap' }), true);
  padrao();
});
t('lista sem id é descartada', () => {
  aplicarListas([{ label: 'sem id', tipos: [], ids: [1] }]);
  assert.equal(CARD_LISTS[0].id, 'lista1');
  padrao();
});

console.log('\n=== o que o jogo ENTREGA, o jogo aceita (booster/estrutural/drop) ===');

// Uma carta real que NÃO está na Lista 1 de fábrica: Dark Factory of More
// Production, que estava num pool de drop do NPC e era injogável. É um dos 10
// casos que existiam de verdade no banco no dia desta mudança.
const OBTIDA = { id: 9064354, t: 'T', tl: 'Normal Trap' };

t('carta fora da lista, mas ENTREGUE pelo jogo, passa a valer', () => {
  padrao();
  aplicarObteniveis([]);
  assert.equal(inLista1(OBTIDA), false, 'o teste precisa começar com ela fora');
  aplicarObteniveis([OBTIDA.id]);
  assert.equal(inLista1(OBTIDA), true,
    'carta de booster/drop continua recusada — é o bug que isto conserta');
  aplicarObteniveis([]);
});

t('par CONTROLE: carta que o jogo NÃO entrega continua fora', () => {
  // Sem este par, um `inLista1` que dissesse "sim" para tudo passaria no de
  // cima e abriria o pool inteiro.
  padrao();
  aplicarObteniveis([OBTIDA.id]);
  assert.equal(inLista1({ id: 999999999, t: 'T', tl: 'Normal Trap' }), false);
  aplicarObteniveis([]);
});

t('vale para QUALQUER lista, não só a Lista 1', () => {
  aplicarObteniveis([OBTIDA.id]);
  aplicarListas([{ id: 'lista2', label: 'Lista 2', tipos: [], ids: [] }]);
  assert.equal(getCardList('lista2').filter(OBTIDA), true);
  aplicarObteniveis([]);
  padrao();
});

t('a FONTE não engole as obteníveis (senão tirar do booster não tiraria da lista)', () => {
  // `fonteDaLista1()` é o que o editor lê para salvar de volta. Se a carta
  // entrasse ali, ela viraria escolha à mão e ficaria na lista PARA SEMPRE —
  // que é o oposto de "automático".
  padrao();
  const antes = fonteDaLista1().ids.length;
  aplicarObteniveis([OBTIDA.id]);
  assert.equal(fonteDaLista1().ids.length, antes, 'a obtenível vazou para a fonte');
  assert.equal(fonteDaLista1().ids.includes(OBTIDA.id), false);
  aplicarObteniveis([]);
});

t('e a lista RESOLVIDA publicada também não as engole', () => {
  // `resolverLista` publica `conteudo/<id>`, que o servidor lê. A união é feita
  // por `lista_ativa()` a cada leitura; gravá-las aqui faria a carta continuar
  // valendo depois de sair do booster — e ninguém perceberia.
  padrao();
  const semObt = resolverLista(fonteDaLista1Completa(), CARTAS);
  aplicarObteniveis([OBTIDA.id]);
  const comObt = resolverLista(fonteDaLista1Completa(), CARTAS);
  assert.deepEqual(comObt, semObt, 'a obtenível vazou para a lista publicada');
  assert.equal(comObt.includes(OBTIDA.id), false);
  aplicarObteniveis([]);
});

function fonteDaLista1Completa() {
  return { id: 'lista1', ...fonteDaLista1() };
}

console.log(`\n${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);

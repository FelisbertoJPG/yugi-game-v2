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
import { inLista1, LISTA1_SPELLTRAP, LISTA1_TIPOS, fonteDaLista1 } from './lista1.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${name}\n        ${e.message}`); fail++; }
};

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const idx = JSON.parse(await readFile(join(ROOT, 'ygo-data', 'data', 'cards.index.json'), 'utf8'));
const CARTAS = Array.isArray(idx) ? idx : (idx.cards ?? idx.data ?? Object.values(idx)[0]);

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
t('a Lista 1 resolvida bate com o total publicado (1160)', () => {
  padrao();
  // Se este número mudar sem ninguém ter mexido na lista, foi um
  // `npm run data:build` — e aí o `conteudo/lista1` no banco está velho.
  // 1158 -> 1160 em 14/08/2026: entraram Ancient Rules (10667321) e
  // Summoner's Art (79816536), o pacote "Normal grande" do deck do Pegasus.
  assert.equal(resolverLista(fonteDasListas()[0], CARTAS).length, 1160);
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

console.log(`\n${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);

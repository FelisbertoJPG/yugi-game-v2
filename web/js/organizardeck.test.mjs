/**
 * Testes do [organizar deck] — `node web/js/organizardeck.test.mjs`.
 *
 * A regra erra CALADA: um deck na ordem errada continua sendo um deck válido,
 * com as mesmas 40 cartas, que salva e duela igual. Ninguém confere carta a
 * carta depois — o que se vê é uma lista plausível.
 *
 * O que se prova aqui são as três decisões que o olho não pega:
 *   - a CLASSIFICAÇÃO, onde a palavra engana ("Ritual Spell" não é ritual,
 *     "Normal Spell" não é monstro Normal, "Fusion/Effect" não é efeito);
 *   - a PRECEDÊNCIA entre categoria e quantidade (o Efeito de 2 cópias vem
 *     antes do Normal de 3 — é isso que o pedido diz, e o contrário também
 *     pareceria certo na tela);
 *   - e que a saída é uma PERMUTAÇÃO da entrada. Organizar não pode ser um
 *     jeito de perder carta, e uma carta que o índice não conhece (customizada,
 *     id de um banco mais novo) é justamente a que sumiria sem ninguém notar.
 */
import assert from 'node:assert/strict';
import { ordenarDeck, jaOrganizado, categoriaDaCarta, CATEGORIAS } from './organizardeck.js';

let n = 0;
const teste = (nome, fn) => { fn(); n++; console.log(`  ok  ${nome}`); };

// Um banco de mentira: só o que a classificação lê (t, tl) mais o desempate.
const BANCO = {
  1: { id: 1, name: 'Ritual A',     t: 'M', tl: 'Ritual Monster',        lv: 8, atk: 2800 },
  2: { id: 2, name: 'Ritual B',     t: 'M', tl: 'Ritual/Effect Monster', lv: 6, atk: 2000 },
  3: { id: 3, name: 'Efeito A',     t: 'M', tl: 'Effect Monster',        lv: 4, atk: 1800 },
  4: { id: 4, name: 'Efeito B',     t: 'M', tl: 'Flip/Effect Monster',   lv: 3, atk: 1200 },
  5: { id: 5, name: 'Normal A',     t: 'M', tl: 'Normal Monster',        lv: 4, atk: 1700 },
  6: { id: 6, name: 'Normal B',     t: 'M', tl: 'Tuner/Normal Monster',  lv: 2, atk: 800 },
  7: { id: 7, name: 'Magia A',      t: 'S', tl: 'Normal Spell' },
  8: { id: 8, name: 'Magia Ritual', t: 'S', tl: 'Ritual Spell' },
  9: { id: 9, name: 'Armadilha A',  t: 'T', tl: 'Normal Trap' },
  10: { id: 10, name: 'Armadilha B', t: 'T', tl: 'Counter Trap' },
  // Extra
  20: { id: 20, name: 'Fusao',  t: 'M', tl: 'Fusion/Effect Monster',  lv: 8, atk: 2500 },
  21: { id: 21, name: 'Sincro', t: 'M', tl: 'Synchro/Effect Monster', lv: 8, atk: 2500 },
  22: { id: 22, name: 'Xyz',    t: 'M', tl: 'Xyz/Effect Monster',     lv: 4, atk: 2500 },
  23: { id: 23, name: 'Link',   t: 'M', tl: 'Link/Effect Monster',    lv: null, atk: 2000 },
};
const brief = (id) => BANCO[id] ?? null;
const nomes = (ids) => ids.map((id) => brief(id)?.name ?? `?${id}`);

console.log('organizardeck.js');

// ----------------------------------------------------------- classificação
teste('a categoria sai do typeLabel, e o Extra é perguntado primeiro', () => {
  assert.equal(categoriaDaCarta(BANCO[1]), 'ritual');
  assert.equal(categoriaDaCarta(BANCO[2]), 'ritual');   // Ritual/Effect é ritual
  assert.equal(categoriaDaCarta(BANCO[3]), 'efeito');
  assert.equal(categoriaDaCarta(BANCO[5]), 'normal');
  assert.equal(categoriaDaCarta(BANCO[20]), 'fusao');   // Fusion/Effect é fusão
  assert.equal(categoriaDaCarta(BANCO[23]), 'link');
});

teste('"Ritual Spell" é MAGIA — a palavra é a mesma, a carta não', () => {
  assert.equal(categoriaDaCarta(BANCO[8]), 'magia');
});

teste('"Normal Spell"/"Normal Trap" não caem no monstro Normal', () => {
  assert.equal(categoriaDaCarta(BANCO[7]), 'magia');
  assert.equal(categoriaDaCarta(BANCO[9]), 'armadilha');
});

teste('carta que o índice não conhece cai em "outro", e "outro" é o fim', () => {
  assert.equal(categoriaDaCarta(null), 'outro');
  assert.equal(categoriaDaCarta({ t: '', tl: '' }), 'outro');
  assert.equal(CATEGORIAS[CATEGORIAS.length - 1], 'outro');
});

// ------------------------------------------------------------------- ordem
teste('a escada: ritual → efeito → normal → magia → armadilha', () => {
  const fora = [9, 7, 5, 3, 1];
  assert.deepEqual(nomes(ordenarDeck(fora, brief)),
                   ['Ritual A', 'Efeito A', 'Normal A', 'Magia A', 'Armadilha A']);
});

teste('dentro da categoria, a de mais cópias vem primeiro', () => {
  // Ritual A ×3, Ritual B ×1 — entrando na ordem inversa.
  const fora = [2, 1, 1, 1];
  assert.deepEqual(nomes(ordenarDeck(fora, brief)),
                   ['Ritual A', 'Ritual A', 'Ritual A', 'Ritual B']);
});

teste('a CATEGORIA manda mais que a quantidade: Efeito ×2 antes de Normal ×3', () => {
  const fora = [5, 5, 5, 3, 3];
  assert.deepEqual(nomes(ordenarDeck(fora, brief)),
                   ['Efeito A', 'Efeito A', 'Normal A', 'Normal A', 'Normal A']);
});

teste('o exemplo do pedido, inteiro', () => {
  const fora = [5, 9, 3, 1, 7, 1, 3, 5, 1, 5];   // embaralhado de propósito
  assert.deepEqual(nomes(ordenarDeck(fora, brief)), [
    'Ritual A', 'Ritual A', 'Ritual A',
    'Efeito A', 'Efeito A',
    'Normal A', 'Normal A', 'Normal A',
    'Magia A',
    'Armadilha A',
  ]);
});

teste('as cópias da mesma carta ficam juntas', () => {
  const saida = ordenarDeck([1, 3, 1, 3, 1], brief);
  assert.deepEqual(saida, [1, 1, 1, 3, 3]);
});

teste('empate em categoria e quantidade desempata por nível ↓ e ATK ↓', () => {
  // Efeito A (Nv4) antes de Efeito B (Nv3), uma cópia cada.
  assert.deepEqual(nomes(ordenarDeck([4, 3], brief)), ['Efeito A', 'Efeito B']);
  // Magia não tem nível nem ATK: sobra o nome.
  assert.deepEqual(nomes(ordenarDeck([8, 7], brief)), ['Magia A', 'Magia Ritual']);
});

teste('o Extra tem a escada dele: fusão → sincro → xyz → link', () => {
  assert.deepEqual(nomes(ordenarDeck([23, 22, 21, 20], brief)),
                   ['Fusao', 'Sincro', 'Xyz', 'Link']);
});

// ------------------------------------------------------------- permutação
teste('a saída é uma PERMUTAÇÃO da entrada — nada some, nada nasce', () => {
  const fora = [9, 9, 7, 5, 5, 5, 3, 3, 1, 10, 8, 6, 4, 2];
  const saida = ordenarDeck(fora, brief);
  assert.equal(saida.length, fora.length);
  assert.deepEqual([...saida].sort((a, b) => a - b), [...fora].sort((a, b) => a - b));
});

teste('carta desconhecida NÃO some: vai para o fim, com as cópias dela', () => {
  const saida = ordenarDeck([999, 1, 999, 7], brief);
  assert.equal(saida.length, 4);
  assert.deepEqual(saida, [1, 7, 999, 999]);
});

teste('lista vazia devolve lista vazia, e não quebra sem o brief', () => {
  assert.deepEqual(ordenarDeck([], brief), []);
  assert.deepEqual(ordenarDeck(null, brief), []);
  assert.deepEqual(ordenarDeck([1, 2], null), [1, 2].sort((a, b) => a - b));
});

// -------------------------------------------------------------- idempotência
teste('organizar duas vezes dá exatamente o mesmo deck', () => {
  const fora = [9, 7, 5, 5, 3, 1, 1, 1, 4, 8];
  const uma = ordenarDeck(fora, brief);
  assert.deepEqual(ordenarDeck(uma, brief), uma);
});

teste('jaOrganizado separa "organizei" de "não havia o que organizar"', () => {
  const fora = [7, 1];
  assert.equal(jaOrganizado(fora, brief), false);
  assert.equal(jaOrganizado(ordenarDeck(fora, brief), brief), true);
  assert.equal(jaOrganizado([], brief), true);
});

console.log(`\n${n} testes ok`);

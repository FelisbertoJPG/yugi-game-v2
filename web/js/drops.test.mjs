/**
 * Testes da CONFIGURACAO de drop por NPC.
 *   node web/js/drops.test.mjs
 *
 * O sorteio em si NAO esta' aqui: quem sorteia e' o servidor
 * (`premiar_vitoria`), porque o duelo roda na maquina do jogador e sortear no
 * navegador seria deixar escolher o proprio premio. O que se prova aqui e' o
 * que a TELA depende: que a configuracao aguenta ser editada por gente, e que a
 * porcentagem mostrada e' a mesma conta que o servidor faz.
 */
import {
  normalizarDrops, dropsDoNpc, chancesDe, totalDoPool, poolVazio,
  MAX_DROPS, DROP_ODDS, RARIDADES,
} from './drops.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const cfg1 = (pool, quantidade = 3) => normalizarDrops({ yugi: { quantidade, pool } }).yugi;

// ------------------------------------------------------------- normalizacao

t('o caso normal passa inteiro, com as quatro gavetas', () => {
  const c = cfg1({ UR: [1], SR: [2], R: [3], N: [4, 5] });
  assert.deepEqual(c, { quantidade: 3, pool: { UR: [1], SR: [2], R: [3], N: [4, 5] } });
});

t('a MESMA carta em duas raridades fica so na primeira (viciaria a chance)', () => {
  const c = cfg1({ UR: [7], SR: [7], N: [7, 8] });
  assert.deepEqual(c.pool.UR, [7]);
  assert.deepEqual(c.pool.SR, []);
  assert.deepEqual(c.pool.N, [8]);
});

t('id repetido, texto, zero e negativo caem fora', () => {
  const c = cfg1({ N: [5, 5, '6', 'abc', 0, -1, null] });
  assert.deepEqual(c.pool.N, [5, 6]);
});

t('o formato ANTIGO (lista simples) vira a gaveta N', () => {
  // E' onde o servidor ja' colocava quem nao esta' em booster nenhum.
  const c = cfg1([10, 20, 20]);
  assert.deepEqual(c.pool.N, [10, 20]);
  assert.equal(totalDoPool(c.pool), 2);
});

t(`quantidade e cortada em ${MAX_DROPS} e nao aceita quebrada`, () => {
  assert.equal(cfg1({ N: [1] }, 999).quantidade, MAX_DROPS);
  assert.equal(cfg1({ N: [1] }, 2.7).quantidade, 2);
});

t('pool vazio ou quantidade 0 SOME da configuracao', () => {
  // Sumir e' o certo: no servidor "sem configuracao" cai no comportamento
  // antigo (a carta de assinatura), e um registro pela metade viraria vitoria
  // sem premio nenhum.
  assert.deepEqual(normalizarDrops({ a: { quantidade: 3, pool: poolVazio() } }), {});
  assert.deepEqual(normalizarDrops({ b: { quantidade: 0, pool: { N: [1] } } }), {});
});

t('lixo no lugar do objeto nao explode', () => {
  assert.deepEqual(normalizarDrops(null), {});
  assert.deepEqual(normalizarDrops({ a: null, b: 'x', c: 42 }), {});
});

t('normalizar duas vezes da o mesmo (a operacao e estavel)', () => {
  const uma = normalizarDrops({ y: { quantidade: 99, pool: { UR: [5, 5], N: ['6'] } } });
  assert.deepEqual(normalizarDrops(uma), uma);
});

t('dropsDoNpc devolve so o do npc pedido', () => {
  const bruto = { yugi: { quantidade: 2, pool: { N: [1] } }, kaiba: { quantidade: 1, pool: { UR: [9] } } };
  assert.deepEqual(dropsDoNpc(bruto, 'yugi').pool.N, [1]);
  assert.equal(dropsDoNpc(bruto, 'joey'), null);
});

// ------------------------------------------------------------ as chances (%)

t('com as quatro raridades, a soma das chances e 100%', () => {
  const ch = chancesDe({ UR: [1], SR: [2], R: [3], N: [4] });
  assert.equal(Math.round(ch.UR + ch.SR + ch.R + ch.N), 100);
  assert.ok(ch.UR < ch.SR && ch.SR < ch.R && ch.R < ch.N, 'a ordem das raridades tem de valer');
});

t('raridade SEM carta vale 0% (nao se promete UR num pool sem UR)', () => {
  const ch = chancesDe({ UR: [], SR: [], R: [1], N: [2] });
  assert.equal(ch.UR, 0);
  assert.equal(ch.SR, 0);
  assert.equal(Math.round(ch.R + ch.N), 100);
});

t('pool de UMA raridade so da 100% para ela', () => {
  // Sem renormalizar, um pool so de N daria 52% e 48% de "nada".
  const ch = chancesDe({ UR: [], SR: [], R: [], N: [1, 2] });
  assert.equal(ch.N, 100);
});

t('pool vazio nao da chance nenhuma (e nao divide por zero)', () => {
  assert.deepEqual(chancesDe(poolVazio()), { UR: 0, SR: 0, R: 0, N: 0 });
  assert.deepEqual(chancesDe(null), { UR: 0, SR: 0, R: 0, N: 0 });
});

t('as chances saem dos PESOS, nao de numero escrito na tela', () => {
  // Se alguem mexer em DROP_ODDS, a tela acompanha sozinha — e este teste
  // continua valendo, porque ele compara com a fonte.
  const ch = chancesDe({ UR: [1], N: [2] });
  const esperado = Math.round((DROP_ODDS.UR / (DROP_ODDS.UR + DROP_ODDS.N)) * 1000) / 10;
  assert.equal(ch.UR, esperado);
});

t('RARIDADES esta na ordem da mais alta para a mais baixa', () => {
  assert.deepEqual(RARIDADES, ['UR', 'SR', 'R', 'N']);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

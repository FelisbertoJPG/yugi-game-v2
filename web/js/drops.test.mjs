/**
 * Testes da CONFIGURACAO de drop por NPC.
 *   node web/js/drops.test.mjs
 *
 * O sorteio em si NAO esta' aqui: quem sorteia e' o servidor
 * (`premiar_vitoria`, migration 0027), porque o duelo roda na maquina do
 * jogador e sortear no navegador seria deixar escolher o proprio premio. O que
 * se prova aqui e' que a configuracao aguenta ser editada por gente — id
 * repetido, texto no lugar do numero, quantidade absurda — sem virar um pool
 * que o servidor vai recusar ou, pior, um premio errado.
 */
import { normalizarDrops, dropsDoNpc, MAX_DROPS } from './drops.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

t('o caso normal passa inteiro', () => {
  const c = normalizarDrops({ yugi: { quantidade: 3, pool: [1, 2, 3, 4, 5] } });
  assert.deepEqual(c.yugi, { quantidade: 3, pool: [1, 2, 3, 4, 5] });
});

t('id REPETIDO no pool sai (sortear com repetido viciaria a chance)', () => {
  const c = normalizarDrops({ yugi: { quantidade: 1, pool: [7, 7, 7, 8] } });
  assert.deepEqual(c.yugi.pool, [7, 8]);
});

t('a ORDEM da escolha e preservada (a tela mostra na ordem em que se montou)', () => {
  const c = normalizarDrops({ yugi: { quantidade: 1, pool: [30, 10, 20] } });
  assert.deepEqual(c.yugi.pool, [30, 10, 20]);
});

t('id que nao e numero, zero ou negativo cai fora', () => {
  const c = normalizarDrops({ yugi: { quantidade: 1, pool: ['abc', 0, -5, null, 42] } });
  assert.deepEqual(c.yugi.pool, [42]);
});

t('id em TEXTO vira numero (o JSON do editor pode trazer string)', () => {
  const c = normalizarDrops({ yugi: { quantidade: 1, pool: ['46986414'] } });
  assert.deepEqual(c.yugi.pool, [46986414]);
});

t(`quantidade acima do teto e cortada em ${MAX_DROPS}`, () => {
  const c = normalizarDrops({ yugi: { quantidade: 999, pool: [1] } });
  assert.equal(c.yugi.quantidade, MAX_DROPS);
});

t('quantidade quebrada ou negativa nao vira premio', () => {
  assert.equal(normalizarDrops({ a: { quantidade: 2.7, pool: [1] } }).a.quantidade, 2);
  assert.equal(normalizarDrops({ a: { quantidade: -3, pool: [1] } }).a, undefined);
  assert.equal(normalizarDrops({ a: { quantidade: 'tres', pool: [1] } }).a, undefined);
});

t('pool vazio ou quantidade 0 SOME da configuracao', () => {
  // Sumir e' o certo: no servidor "sem configuracao" cai no comportamento
  // antigo (a carta de assinatura), e um registro pela metade viraria vitoria
  // sem premio nenhum.
  const c = normalizarDrops({ a: { quantidade: 3, pool: [] }, b: { quantidade: 0, pool: [1] } });
  assert.deepEqual(c, {});
});

t('lixo no lugar do objeto nao explode', () => {
  assert.deepEqual(normalizarDrops(null), {});
  assert.deepEqual(normalizarDrops(undefined), {});
  assert.deepEqual(normalizarDrops({ a: null, b: 'x', c: 42 }), {});
});

t('dropsDoNpc devolve so o do npc pedido, ja normalizado', () => {
  const bruto = { yugi: { quantidade: 2, pool: [1, 1, 2] }, kaiba: { quantidade: 1, pool: [9] } };
  assert.deepEqual(dropsDoNpc(bruto, 'yugi'), { quantidade: 2, pool: [1, 2] });
  assert.equal(dropsDoNpc(bruto, 'joey'), null);
  assert.equal(dropsDoNpc(bruto, null), null);
});

t('normalizar duas vezes da o mesmo (a operacao e estavel)', () => {
  const bruto = { yugi: { quantidade: 99, pool: [5, 5, '6', 'x'] } };
  const uma = normalizarDrops(bruto);
  assert.deepEqual(normalizarDrops(uma), uma);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

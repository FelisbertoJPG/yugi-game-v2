/**
 * A ordenação do pool de cartas — `node web/js/poolordem.test.mjs`
 *
 * A regra vale para CINCO telas (Deck Builder, Booster Builder, Banlist, Listas
 * de cartas e Deck Estrutural), e até agora estava escrita quatro vezes: duas em
 * módulos e duas soltas dentro do HTML. Duas dessas cópias já haviam DIVERGIDO
 * em silêncio — a do Booster Builder e a do Deck Estrutural não entendiam o
 * sufixo `-asc`, então as telas ofereciam metade das ordens e a outra metade
 * fazia o contrário do que o rótulo dizia.
 *
 * Erro de ordenação não dá erro: a lista aparece, só que na ordem errada, e
 * quem olha vê uma lista plausível. É por isso que a regra saiu do HTML.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ordenarPool, RARIDADES } from './poolordem.js';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const c = (id, extra = {}) => ({ id, atk: null, def: null, lv: null, ...extra });
const ids = (lista) => lista.map((x) => x.id);

// ------------------------------------------------------------- raridade

t('raridade desce UR → SR → R → N', () => {
  const pool = [c(1, { rarity: 'N' }), c(2, { rarity: 'UR' }), c(3, { rarity: 'R' }), c(4, { rarity: 'SR' })];
  assert.deepEqual(ids(ordenarPool(pool, 'raridade')), [2, 4, 3, 1]);
});

t('e sobe N → R → SR → UR', () => {
  const pool = [c(1, { rarity: 'N' }), c(2, { rarity: 'UR' }), c(3, { rarity: 'R' }), c(4, { rarity: 'SR' })];
  assert.deepEqual(ids(ordenarPool(pool, 'raridade-asc')), [1, 3, 4, 2]);
});

// "Sem raridade" não é um degrau da escala — é a ausência dela. Se fosse só o
// inverso, ordenar "N → UR" abriria com centenas de cartas fora de booster na
// frente, que é o oposto do que quem escolheu essa ordem quer ver.
t('carta SEM raridade fica no fim nas DUAS direções', () => {
  const pool = [c(1, {}), c(2, { rarity: 'UR' }), c(3, { rarity: 'N' })];
  assert.equal(ids(ordenarPool(pool, 'raridade')).at(-1), 1);
  assert.equal(ids(ordenarPool(pool, 'raridade-asc')).at(-1), 1,
    'invertida, a carta sem raridade veio na frente');
});

t('a raridade pode vir de fora (o Deck Builder conhece os estruturais)', () => {
  // Sem `rarity` na carta: quem responde é a função que a tela passa. É assim
  // que as 36 cartas que só existem em Deck Estrutural entram na ordem, em vez
  // de irem todas para o fim como "sem raridade".
  const pool = [c(1), c(2), c(3)];
  const doEstrutural = new Map([[1, 'N'], [2, 'UR'], [3, 'SR']]);
  assert.deepEqual(ids(ordenarPool(pool, 'raridade', (x) => doEstrutural.get(x.id))), [2, 3, 1]);
});

t('minúsculo também vale (a tag do booster é minúscula)', () => {
  const pool = [c(1, { rarity: 'n' }), c(2, { rarity: 'ur' })];
  assert.deepEqual(ids(ordenarPool(pool, 'raridade')), [2, 1]);
});

// ---------------------------------------------------- ATK / DEF / nível

t('maior ATK e menor ATK são ordens OPOSTAS', () => {
  const pool = [c(1, { atk: 100 }), c(2, { atk: 3000 }), c(3, { atk: 1500 })];
  assert.deepEqual(ids(ordenarPool(pool, 'atk')), [2, 3, 1]);
  assert.deepEqual(ids(ordenarPool(pool, 'atk-asc')), [1, 3, 2],
    'o `-asc` não foi entendido — era exatamente a divergência das cópias');
});

t('DEF e nível seguem a mesma regra', () => {
  const pool = [c(1, { def: 0 }), c(2, { def: 2000 })];
  assert.deepEqual(ids(ordenarPool(pool, 'def')), [2, 1]);
  assert.deepEqual(ids(ordenarPool(pool, 'def-asc')), [1, 2]);

  const lv = [c(1, { lv: 4 }), c(2, { lv: 8 })];
  assert.deepEqual(ids(ordenarPool(lv, 'lv')), [2, 1]);
  assert.deepEqual(ids(ordenarPool(lv, 'lv-asc')), [1, 2]);
});

// Magia e armadilha não têm ATK: `null` não é zero, e ordenar "menor ATK" com
// elas na frente esconderia os monstros que a ordem existe para mostrar.
t('carta sem ATK (magia/armadilha) fica no fim nas duas direções', () => {
  const pool = [c(1), c(2, { atk: 1000 }), c(3, { atk: 0 })];
  assert.equal(ids(ordenarPool(pool, 'atk')).at(-1), 1);
  assert.equal(ids(ordenarPool(pool, 'atk-asc')).at(-1), 1);
});

// --------------------------------------------------------------- guardas

t('sem chave, devolve a lista como estava', () => {
  const pool = [c(3), c(1), c(2)];
  assert.deepEqual(ids(ordenarPool(pool, '')), [3, 1, 2]);
});

t('nunca mexe na lista recebida (as telas guardam `poolResults`)', () => {
  const pool = [c(1, { atk: 100 }), c(2, { atk: 3000 })];
  const antes = ids(pool);
  ordenarPool(pool, 'atk');
  assert.deepEqual(ids(pool), antes);
});

t('lista vazia ou lixo não derruba a tela', () => {
  assert.deepEqual(ordenarPool([], 'raridade'), []);
  assert.deepEqual(ordenarPool(null, 'atk'), []);
  assert.deepEqual(ordenarPool(undefined, ''), []);
});

t('a escala é a mesma dos boosters', () => {
  assert.deepEqual(RARIDADES, ['UR', 'SR', 'R', 'N']);
});

// ------------------------------------------------- a varredura das telas

/**
 * O pedido era "em TODOS os builders e listagens". Uma tela que ganhe um
 * `#f-sort` depois disto e não ofereça a raridade não daria erro nenhum — ela
 * simplesmente não teria a ordem, e ninguém repara na ausência de uma opção
 * num `<select>`. Por isso a lista de telas é lida do disco, e não escrita aqui.
 */
const DIR = new URL('../', import.meta.url);
const PAGINAS = readdirSync(DIR).filter((f) => f.endsWith('.html'));

t('toda tela que ordena o pool oferece a ordem por RARIDADE', () => {
  const faltando = PAGINAS.filter((p) => {
    const html = readFileSync(new URL(p, DIR), 'utf8');
    if (!html.includes('id="f-sort"')) return false;
    return !(html.includes('value="raridade"') && html.includes('value="raridade-asc"'));
  });
  assert.deepEqual(faltando, [],
    'estas telas ordenam o pool mas não oferecem a raridade:\n        ' + faltando.join('\n        '));
});

t('e nenhuma tela voltou a ter a própria cópia da regra', () => {
  const culpadas = [];
  for (const p of PAGINAS) {
    const html = readFileSync(new URL(p, DIR), 'utf8');
    if (/function\s+sortPool\s*\(/.test(html)) culpadas.push(`${p} (sortPool)`);
    if (/function\s+ordenar\s*\(\s*lista/.test(html)) culpadas.push(`${p} (ordenar)`);
  }
  assert.deepEqual(culpadas, [],
    'a regra voltou para dentro do HTML — foi assim que duas cópias divergiram:\n        '
    + culpadas.join('\n        '));
});

t('a varredura encontrou as telas de verdade', () => {
  const comOrdem = PAGINAS.filter((p) => readFileSync(new URL(p, DIR), 'utf8').includes('id="f-sort"'));
  assert.ok(comOrdem.length >= 5, `so' ${comOrdem.length} tela(s) com #f-sort`);
  for (const obrigatoria of ['deck.html', 'banlist.html', 'listas.html', 'booster.html', 'estrutural.html']) {
    assert.ok(comOrdem.includes(obrigatoria), `${obrigatoria} ficou de fora`);
  }
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

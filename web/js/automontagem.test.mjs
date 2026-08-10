/**
 * Testes da auto montagem.
 *   node web/js/automontagem.test.mjs
 *
 * O que estes casos protegem, e por que cada um existe:
 *
 * A auto montagem erra de um jeito silencioso — ela SEMPRE devolve 40 cartas. Um
 * deck ruim e um deck bom têm o mesmo tamanho, e a diferença só aparece jogando.
 * Então o teste não pergunta "montou?", pergunta "montou o quê?": a curva de
 * tributos, o ritual sem a magia, a fusão sem material.
 */
import { montarAuto, notaMonstro, notaEfeito, ALVO } from './automontagem.js';
import { RULES } from './deck.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

// ------------------------------------------------------------------ fixtures

let proximo = 1000;
const mon = (o = {}) => ({
  id: proximo++, name: o.name ?? `Monstro ${proximo}`, t: 'M',
  tl: o.tl ?? 'Normal Monster', atk: o.atk ?? 1000, def: o.def ?? 1000, lv: o.lv ?? 4,
});
const mag = (o = {}) => ({ id: proximo++, name: o.name ?? `Magia ${proximo}`, t: 'S', tl: o.tl ?? 'Normal Spell' });
const arm = (o = {}) => ({ id: proximo++, name: o.name ?? `Armadilha ${proximo}`, t: 'T', tl: 'Normal Trap' });
const p = (card, copias = 3) => ({ card, copias });

/** Um pool grande o bastante para fechar 40 sem depender de sorte. */
function poolBasico() {
  const itens = [];
  for (let i = 0; i < 10; i++) itens.push(p(mon({ atk: 1700 - i * 50, lv: 4 })));
  for (let i = 0; i < 6; i++) itens.push(p(mag()));
  for (let i = 0; i < 6; i++) itens.push(p(arm()));
  return itens;
}

const tipos = (ids, pool) => ids.map((id) => pool.find((x) => x.card.id === id).card);

// -------------------------------------------------------------------- notas

t('nivel 4 de 1800 vale mais que nivel 6 de 2400 (o tributo custa)', () => {
  assert.ok(notaMonstro({ atk: 1800, def: 0, lv: 4 }) > notaMonstro({ atk: 2400, def: 0, lv: 6 }));
});

t('nivel 8 de 3000 perde para um nivel 4 de 1900', () => {
  assert.ok(notaMonstro({ atk: 1900, def: 0, lv: 4 }) > notaMonstro({ atk: 3000, def: 0, lv: 8 }));
});

t('parede alta compete com atacante (a DEF conta)', () => {
  assert.ok(notaMonstro({ atk: 1000, def: 2000, lv: 4 }) > notaMonstro({ atk: 1500, def: 0, lv: 4 }));
});

t('varredura de campo vale mais que ganhar vida', () => {
  assert.ok(notaEfeito('Destroy all monsters your opponent controls.')
          > notaEfeito('Gain 1000 Life Points.'));
});

t('sem texto, tudo empata (nao inventa valor que nao sabe)', () => {
  assert.equal(notaEfeito(''), notaEfeito(undefined));
});

// ------------------------------------------------------------------ o deck

t('monta 40 cartas exatas', () => {
  const pool = poolBasico();
  const { main } = montarAuto(pool);
  assert.equal(main.length, ALVO.main);
});

t('nunca passa de 3 copias da mesma carta', () => {
  const pool = poolBasico();
  const { main } = montarAuto(pool);
  const conta = {};
  for (const id of main) conta[id] = (conta[id] ?? 0) + 1;
  for (const [id, n] of Object.entries(conta)) {
    assert.ok(n <= RULES.MAX_COPIES, `carta ${id} apareceu ${n}×`);
  }
});

t('respeita as copias que o jogador REALMENTE tem', () => {
  const unico = mon({ atk: 3000, lv: 4, name: 'Raro' });
  const pool = [p(unico, 1), ...poolBasico()];
  const { main } = montarAuto(pool);
  assert.equal(main.filter((id) => id === unico.id).length, 1,
    'levou mais copias do que existem na colecao');
});

t('NAO enche o deck de monstros que precisam de tributo', () => {
  // Um pool onde os "melhores" por ATK bruto sao todos pesados: sem a trava, o
  // deck sairia com 20 monstros intributaveis e a mao travaria toda partida.
  const pool = [];
  for (let i = 0; i < 10; i++) pool.push(p(mon({ atk: 3000, lv: 8 })));
  for (let i = 0; i < 10; i++) pool.push(p(mon({ atk: 1600, lv: 4 })));
  for (let i = 0; i < 6; i++) pool.push(p(mag()));
  for (let i = 0; i < 6; i++) pool.push(p(arm()));

  const { main } = montarAuto(pool);
  const pesados = tipos(main, pool).filter((c) => Number(c.lv) >= 5).length;
  assert.ok(pesados <= ALVO.comTributo,
    `${pesados} monstros com tributo (teto e' ${ALVO.comTributo})`);
});

t('mantem uma proporcao jogavel de monstro/magia/armadilha', () => {
  const pool = poolBasico();
  const { main } = montarAuto(pool);
  const cartas = tipos(main, pool);
  const m = cartas.filter((c) => c.t === 'M').length;
  assert.ok(m >= 14 && m <= 24, `${m} monstros — fora da faixa jogavel`);
});

// ------------------------------------------------------------------ rituais

t('ritual SEM a magia dele fica de fora (seria carta morta)', () => {
  const skull = mon({ name: 'Skull Guardian', tl: 'Ritual Monster', atk: 2050, lv: 7 });
  const pool = [p(skull), ...poolBasico()];
  const { main, relatorio } = montarAuto(pool, { descOf: () => '' });

  assert.ok(!main.includes(skull.id), 'levou um ritual sem a magia');
  assert.ok(relatorio.some((l) => l.includes('Skull Guardian') && l.includes('carta morta')),
    'nao explicou por que ficou de fora');
});

t('ritual COM a magia entra, e a magia vem junto', () => {
  const skull = mon({ name: 'Skull Guardian', tl: 'Ritual Monster', atk: 2050, lv: 7 });
  const reza = mag({ name: "Novox's Prayer", tl: 'Ritual Spell' });
  const textos = { [reza.id]: 'Ritual Summon 1 "Skull Guardian" from your hand.' };

  const pool = [p(skull), p(reza), ...poolBasico()];
  const { main } = montarAuto(pool, { descOf: (id) => textos[id] ?? '' });

  assert.ok(main.includes(skull.id), 'nao levou o ritual mesmo com a magia');
  assert.ok(main.includes(reza.id), 'levou o ritual mas esqueceu a magia');
});

t('a magia de ritual certa e escolhida pelo NOME citado', () => {
  const alvo = mon({ name: 'Garma Sword', tl: 'Ritual Monster', atk: 2550, lv: 7 });
  const certa = mag({ name: "Garma Sword Oath", tl: 'Ritual Spell' });
  const errada = mag({ name: 'Outra Reza', tl: 'Ritual Spell' });
  const textos = {
    [certa.id]: 'Ritual Summon 1 "Garma Sword".',
    [errada.id]: 'Ritual Summon 1 "Outro Monstro".',
  };
  const pool = [p(alvo), p(certa), p(errada), ...poolBasico()];
  const { main } = montarAuto(pool, { descOf: (id) => textos[id] ?? '' });

  assert.ok(main.includes(certa.id), 'nao levou a magia que cita o monstro');
  assert.ok(!main.includes(errada.id), 'levou uma magia de ritual que nao serve');
});

// ------------------------------------------------------------------- fusao

t('fusao sem magia de Fusao nao entra no Extra', () => {
  const fus = { id: proximo++, name: 'Fusao X', t: 'M', tl: 'Fusion/Effect Monster', atk: 2800, lv: 8 };
  const pool = [p(fus), ...poolBasico()];
  const { extra, relatorio } = montarAuto(pool, { descOf: () => '"A" + "B"' });

  assert.equal(extra.length, 0, 'pos fusao sem como invocar');
  assert.ok(relatorio.some((l) => l.includes('Extra Deck vazio')));
});

t('fusao entra so quando os materiais estao no main', () => {
  const a = mon({ name: 'Material A', atk: 1700, lv: 4 });
  const b = mon({ name: 'Material B', atk: 1600, lv: 4 });
  const poly = mag({ name: 'Polymerization' });
  const boa = { id: proximo++, name: 'Fusao Boa', t: 'M', tl: 'Fusion/Effect Monster', atk: 2800, lv: 8 };
  const orfa = { id: proximo++, name: 'Fusao Orfa', t: 'M', tl: 'Fusion/Effect Monster', atk: 3000, lv: 9 };

  const textos = {
    [poly.id]: 'Fusion Summon 1 Fusion Monster from your Extra Deck.',
    [boa.id]: '"Material A" + "Material B"',
    [orfa.id]: '"Nao Tenho" + "Nem Isso"',
  };
  const pool = [p(a), p(b), p(poly), p(boa, 1), p(orfa, 1), ...poolBasico()];
  const { extra } = montarAuto(pool, { descOf: (id) => textos[id] ?? '' });

  assert.ok(extra.includes(boa.id), 'nao levou a fusao com os materiais no deck');
  assert.ok(!extra.includes(orfa.id), 'levou uma fusao que nao tem como invocar');
});

// ------------------------------------------------------------------ bordas

t('carta sem Lua (card maker) nunca entra', () => {
  const falsa = { ...mon({ atk: 5000, lv: 4, name: 'Custom' }), tags: ['sem-efeito'] };
  const pool = [p(falsa), ...poolBasico()];
  const { main } = montarAuto(pool);
  assert.ok(!main.includes(falsa.id), 'levou carta que o motor ignora');
});

t('colecao pequena avisa em vez de fingir', () => {
  const pool = [p(mon({ atk: 1700 })), p(mag())];
  const { main, relatorio } = montarAuto(pool);
  assert.ok(main.length < RULES.MAIN_MIN);
  // Procura o NÚMERO, não a palavra: o texto do aviso pode ser reescrito, o
  // mínimo de 40 é que não muda.
  assert.ok(relatorio.some((l) => l.includes(String(RULES.MAIN_MIN))),
    'nao avisou que faltou carta para o minimo');
});

t('pool vazio nao explode', () => {
  const { main, extra } = montarAuto([]);
  assert.equal(main.length, 0);
  assert.equal(extra.length, 0);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

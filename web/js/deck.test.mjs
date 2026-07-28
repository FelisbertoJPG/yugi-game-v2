/**
 * Testes das regras de construção de deck.
 *   node web/js/deck.test.mjs
 */
import { Deck, RULES, isExtraDeck } from './deck.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${name}\n        ${e.message}`); fail++; }
};

const mon   = (id) => ({ id, tl: 'Effect Monster' });
const fus   = (id) => ({ id, tl: 'Fusion/Effect Monster' });
const link  = (id) => ({ id, tl: 'Link/Effect Monster' });
const xyzP  = (id) => ({ id, tl: 'Xyz/Pendulum/Effect Monster' });
const pend  = (id) => ({ id, tl: 'Pendulum/Effect Monster' });
const spell = (id) => ({ id, tl: 'Quick-Play Spell' });

console.log('\n=== roteamento Main / Extra ===');
t('monstro de efeito vai para o Main', () => assert.equal(isExtraDeck(mon(1)), false));
t('magia vai para o Main',             () => assert.equal(isExtraDeck(spell(1)), false));
t('Fusion vai para o Extra',           () => assert.equal(isExtraDeck(fus(1)), true));
t('Link vai para o Extra',             () => assert.equal(isExtraDeck(link(1)), true));
t('Xyz/Pendulum vai para o Extra',     () => assert.equal(isExtraDeck(xyzP(1)), true));
t('Pendulum puro fica no Main',        () => assert.equal(isExtraDeck(pend(1)), false));

console.log('\n=== limite de 3 cópias ===');
t('aceita 3 cópias e recusa a 4a', () => {
  const d = new Deck();
  for (let i = 0; i < 3; i++) assert.equal(d.add(mon(7)).ok, true);
  const r = d.add(mon(7));
  assert.equal(r.ok, false);
  assert.match(r.reason, /3 cópias/);
  assert.equal(d.main.length, 3);
});
t('o limite soma Main + Extra da mesma carta', () => {
  const d = new Deck();
  d.main.push(9, 9);          // 2 no main
  assert.equal(d.copies(9), 2);
  d.extra.push(9);            // 1 no extra
  assert.equal(d.copies(9), 3);
  assert.equal(d.add(mon(9)).ok, false);
});

console.log('\n=== capacidade das zonas ===');
t('Main recusa a 61a carta', () => {
  const d = new Deck();
  for (let i = 0; i < RULES.MAIN_MAX; i++) d.add(mon(i));
  assert.equal(d.main.length, 60);
  const r = d.add(mon(999));
  assert.equal(r.ok, false);
  assert.match(r.reason, /Main Deck cheio/);
});
t('Extra recusa a 16a carta', () => {
  const d = new Deck();
  for (let i = 0; i < RULES.EXTRA_MAX; i++) d.add(fus(i));
  assert.equal(d.extra.length, 15);
  assert.equal(d.add(fus(999)).ok, false);
});
t('encher o Extra não bloqueia o Main', () => {
  const d = new Deck();
  for (let i = 0; i < RULES.EXTRA_MAX; i++) d.add(fus(i));
  assert.equal(d.add(mon(500)).ok, true);
});

console.log('\n=== validação ===');
t('deck vazio é inválido', () => {
  assert.equal(new Deck().validate().valid, false);
});
t('39 cartas é inválido, 40 é válido', () => {
  const d = new Deck();
  for (let i = 0; i < 39; i++) d.main.push(i);
  assert.equal(d.validate().valid, false);
  d.main.push(39);
  assert.equal(d.validate().valid, true);
});
t('60 é válido, 61 é inválido', () => {
  const d = new Deck();
  for (let i = 0; i < 60; i++) d.main.push(i);
  assert.equal(d.validate().valid, true);
  d.main.push(60);
  assert.equal(d.validate().valid, false);
});
t('extra de 15 é válido, 16 é inválido', () => {
  const d = new Deck();
  for (let i = 0; i < 40; i++) d.main.push(i);
  for (let i = 0; i < 15; i++) d.extra.push(1000 + i);
  assert.equal(d.validate().valid, true);
  d.extra.push(2000);
  assert.equal(d.validate().valid, false);
});
t('4 cópias inseridas na marra são pegas pela validação', () => {
  const d = new Deck();
  for (let i = 0; i < 36; i++) d.main.push(i);
  d.main.push(77, 77, 77, 77);
  assert.equal(d.main.length, 40);
  const v = d.validate();
  assert.equal(v.valid, false);
  assert.match(v.errors[0], /77/);
});

console.log('\n=== remoção e agrupamento ===');
t('remove só uma cópia', () => {
  const d = new Deck();
  d.add(mon(5)); d.add(mon(5)); d.add(mon(5));
  d.remove(5, 'main');
  assert.equal(d.copies(5), 2);
});
t('removeAll limpa todas', () => {
  const d = new Deck();
  d.add(mon(5)); d.add(mon(5));
  d.removeAll(5, 'main');
  assert.equal(d.copies(5), 0);
});
t('grouped agrupa mantendo a ordem', () => {
  const d = new Deck();
  d.add(mon(1)); d.add(mon(2)); d.add(mon(1));
  assert.deepEqual(d.grouped('main'), [{ id: 1, count: 2 }, { id: 2, count: 1 }]);
});

console.log('\n=== formato .ydk (o que o ocgcore vai ler) ===');
t('exporta com as seções corretas', () => {
  const d = new Deck({ name: 'T', main: [1, 1, 2], extra: [9] });
  const lines = d.toYdk().trim().split('\n');
  const i = lines.indexOf('#main');
  assert.ok(i > 0, 'precisa ter a seção #main');
  assert.deepEqual(lines.slice(i + 1, i + 4), ['1', '1', '2']);
  assert.equal(lines[i + 4], '#extra');
  assert.equal(lines[i + 5], '9');
  assert.equal(lines[i + 6], '!side');
});
t('ids ficam antes de qualquer metadado', () => {
  // Se um metadado escapasse para depois do #main, viraria "id" invalido.
  const d = new Deck({ name: 'T', main: [1], extra: [] });
  const lines = d.toYdk({ npc: 'yugi' }).trim().split('\n');
  const i = lines.indexOf('#main');
  assert.ok(lines.slice(0, i).every((l) => l.startsWith('#')));
});
t('ida e volta preserva o deck', () => {
  const d = new Deck({ name: 'X', main: [10, 10, 11], extra: [20] });
  const back = Deck.fromYdk(d.toYdk());
  assert.deepEqual(back.main, d.main);
  assert.deepEqual(back.extra, d.extra);
});
t('importa .ydk real do ygopro e descarta o side', () => {
  const ydk = `#created by ygopro\n#main\n89631139\n89631139\n#extra\n1861629\n!side\n46986414\n`;
  const d = Deck.fromYdk(ydk);
  assert.deepEqual(d.main, [89631139, 89631139]);
  assert.deepEqual(d.extra, [1861629]);
  assert.equal(d.main.includes(46986414), false, 'side não deve entrar');
});
t('ignora lixo e linhas vazias', () => {
  const d = Deck.fromYdk('#main\n\n  123  \nabc\n0\n#extra\n');
  assert.deepEqual(d.main, [123]);
});

console.log('\n=== metadados no .ydk (decks de NPC no projeto) ===');
t('grava e recupera os metadados', () => {
  const d = new Deck({ name: 'Yugi Chaos', main: [1], extra: [] });
  const back = Deck.fromYdk(d.toYdk({ npc: 'yugi', signature: 46986414 }));
  assert.equal(back.meta.npc, 'yugi');
  assert.equal(back.meta.signature, '46986414');
  assert.equal(back.name, 'Yugi Chaos', 'o nome volta do metadado');
});
t('metadado nao contamina as cartas', () => {
  const d = new Deck({ name: 'X', main: [10, 20], extra: [] });
  const back = Deck.fromYdk(d.toYdk({ npc: 'yugi', signature: 999 }));
  assert.deepEqual(back.main, [10, 20], 'signature nao pode virar carta');
});
t('nao deixa metadado sobrescrever marcador do formato', () => {
  const d = new Deck({ name: 'X', main: [5], extra: [] });
  const ydk = d.toYdk({ main: 'invasor', extra: 'invasor', side: 'invasor' });
  assert.equal((ydk.match(/^#main$/gm) ?? []).length, 1);
  assert.deepEqual(Deck.fromYdk(ydk).main, [5]);
});
t('.ydk de outra ferramenta volta com meta vazio', () => {
  const d = Deck.fromYdk('#created by ygopro\n#main\n89631139\n#extra\n!side\n');
  assert.deepEqual(d.meta, {});
  assert.deepEqual(d.main, [89631139]);
});
t('metadado com acento/espaco sobrevive', () => {
  const d = new Deck({ name: 'Deck do Yugi — Caos', main: [1], extra: [] });
  assert.equal(Deck.fromYdk(d.toYdk()).name, 'Deck do Yugi — Caos');
});

console.log('\n=== moldura do deck (ilustração, separada da recompensa) ===');
t('cover e signature sao campos independentes', () => {
  const d = new Deck({ name: 'X', main: [1], extra: [] });
  const back = Deck.fromYdk(d.toYdk({ signature: 111, cover: 222 }));
  assert.equal(Number(back.meta.signature), 111);
  assert.equal(Number(back.meta.cover), 222);
});
t('cover sobrevive a ida e volta', () => {
  const d = new Deck({ name: 'Yugi Chaos', main: [46986414], extra: [] });
  const back = Deck.fromYdk(d.toYdk({ npc: 'yugi', signature: 46986414, cover: 30208479 }));
  assert.equal(Number(back.meta.cover), 30208479);
});
t('deck sem cover nao ganha a chave', () => {
  const back = Deck.fromYdk(new Deck({ main: [1] }).toYdk({ signature: 1 }));
  assert.equal(back.meta.cover, undefined, 'quem lê deve cair na signature');
});
t('cover nao vira carta do deck', () => {
  const d = new Deck({ name: 'X', main: [10, 20], extra: [] });
  assert.deepEqual(Deck.fromYdk(d.toYdk({ cover: 99999999 })).main, [10, 20]);
});

console.log(`\n${pass} passaram, ${fail} falharam\n`);
process.exitCode = fail ? 1 : 0;

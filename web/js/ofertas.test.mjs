/**
 * Testes das OFERTAS de ativação.
 *   node web/js/ofertas.test.mjs
 *
 * O relato que originou isto: a Forgotten Temple of the Deep tem dois efeitos
 * ("banir 1 peixe" e "Invocar Especialmente o banido"); a tela mostrava uma
 * linha só, com o mesmo nome e a mesma arte, e quem queria o segundo clicava e
 * resolvia o primeiro.
 *
 * São duas metades, e as duas erram em SILÊNCIO:
 *   • o mapeamento — perder uma oferta não dá erro nenhum, só torna um dos
 *     efeitos impossível de ativar da mão;
 *   • o rótulo — duas linhas escritas igual não separam nada.
 */
import { ofertasPorMao, linhasDeAtivacao, textoDoEfeito, LOCATION_MAO } from './ofertas.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const TEMPLO = 43889633, UMI = 22702055, CAMPO = 0x04;
/** Uma oferta do motor. `location` 2 = mão. */
const oferta = (code, index, extra = {}) =>
  ({ code, index, controller: 0, location: LOCATION_MAO, sequence: index, ...extra });

console.log('\nofertas por posição da mão');

t('uma carta, um efeito: uma oferta, como sempre foi', () => {
  const m = ofertasPorMao([UMI], [oferta(UMI, 0)]);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].map((a) => a.index), [0]);
});

t('uma carta, DOIS efeitos: as duas ofertas ficam na mesma posicao', () => {
  const m = ofertasPorMao([TEMPLO], [oferta(TEMPLO, 0), oferta(TEMPLO, 1)]);
  assert.deepEqual(m[0].map((a) => a.index), [0, 1],
    'o segundo efeito sumia: era ele que ninguem conseguia ativar');
});

t('duas copias, um efeito cada: uma oferta em cada posicao', () => {
  const m = ofertasPorMao([UMI, UMI], [oferta(UMI, 0), oferta(UMI, 1)]);
  assert.deepEqual(m[0].map((a) => a.index), [0]);
  assert.deepEqual(m[1].map((a) => a.index), [1]);
});

t('duas copias, dois efeitos cada: cada copia fica com a sua fatia', () => {
  const acts = [oferta(TEMPLO, 0), oferta(TEMPLO, 1), oferta(TEMPLO, 2), oferta(TEMPLO, 3)];
  const m = ofertasPorMao([TEMPLO, TEMPLO], acts);
  assert.deepEqual(m[0].map((a) => a.index), [0, 1]);
  assert.deepEqual(m[1].map((a) => a.index), [2, 3]);
});

t('nao divide: toda copia recebe a lista inteira (nenhum efeito escondido)', () => {
  const acts = [oferta(TEMPLO, 0), oferta(TEMPLO, 1), oferta(TEMPLO, 2)];
  const m = ofertasPorMao([TEMPLO, TEMPLO], acts);
  for (const pos of m) assert.deepEqual(pos.map((a) => a.index), [0, 1, 2]);
});

t('as outras cartas da mao nao se misturam', () => {
  const m = ofertasPorMao([UMI, TEMPLO], [oferta(UMI, 0), oferta(TEMPLO, 1), oferta(TEMPLO, 2)]);
  assert.deepEqual(m[0].map((a) => a.index), [0]);
  assert.deepEqual(m[1].map((a) => a.index), [1, 2]);
});

t('a mesma carta em CAMPO nao rouba a posicao da mao', () => {
  // O `activatable` traz campo e mao juntos. Sem o filtro, a oferta do campo
  // casava por codigo com a copia da mao e o clique na mao mandava o indice
  // errado — a carta que ativava era a outra.
  const m = ofertasPorMao([TEMPLO],
    [oferta(TEMPLO, 0, { location: CAMPO, sequence: 5 }), oferta(TEMPLO, 1)]);
  assert.deepEqual(m[0].map((a) => a.index), [1]);
});

t('carta oferecida que nao esta na mao nao inventa posicao', () => {
  const m = ofertasPorMao([UMI], [oferta(TEMPLO, 0)]);
  assert.deepEqual(m, [[]]);
});

t('sem pergunta nenhuma: uma lista vazia por posicao, nunca undefined', () => {
  assert.deepEqual(ofertasPorMao([UMI, TEMPLO], null), [[], []]);
});

console.log('\nrotulo de cada linha');

t('uma oferta so: rotulo padrao (texto null)', () => {
  const [l] = linhasDeAtivacao([oferta(UMI, 0)]);
  assert.equal(l.texto, null);
  assert.equal(l.sub, '');
});

t('duas ofertas COM texto do motor: e o texto que separa', () => {
  const ls = linhasDeAtivacao([
    oferta(TEMPLO, 0, { descText: 'Banish 1 Fish, Sea Serpent, or Aqua you control' }),
    oferta(TEMPLO, 1, { descText: 'Special Summon the monster(s) banished by this card' }),
  ]);
  assert.equal(ls[0].texto, null, 'com texto proprio o rotulo continua "Ativar"');
  assert.equal(ls[0].sub, 'Banish 1 Fish, Sea Serpent, or Aqua you control');
  assert.equal(ls[1].sub, 'Special Summon the monster(s) banished by this card');
  assert.notEqual(ls[0].sub, ls[1].sub);
});

t('duas ofertas SEM texto: numera, que e o unico honesto', () => {
  const ls = linhasDeAtivacao([oferta(TEMPLO, 0), oferta(TEMPLO, 1)]);
  assert.equal(ls[0].texto, 'Ativar (efeito 1)');
  assert.equal(ls[1].texto, 'Ativar (efeito 2)');
});

t('o indice do motor viaja intacto — e ele que responde a pergunta', () => {
  const ls = linhasDeAtivacao([oferta(TEMPLO, 7), oferta(TEMPLO, 9)]);
  assert.deepEqual(ls.map((l) => l.index), [7, 9]);
});

t('posicao sem oferta nenhuma: nenhuma linha', () => {
  assert.deepEqual(linhasDeAtivacao([]), []);
  assert.deepEqual(linhasDeAtivacao(undefined), []);
});

console.log('\ntexto do efeito');

t('vem do motor quando ele mandou', () => {
  assert.equal(textoDoEfeito({ descText: '  Banish 1 Fish  ' }), 'Banish 1 Fish');
});

t('vazio quando nao da para saber — nunca uma frase inventada', () => {
  for (const o of [null, undefined, {}, { descText: null }, { descText: '   ' }, { descText: 7 }])
    assert.equal(textoDoEfeito(o), '');
});

console.log(`\n${pass} ok, ${fail} falha(s)\n`);
process.exit(fail ? 1 : 0);

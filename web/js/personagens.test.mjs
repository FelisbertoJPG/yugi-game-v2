/**
 * Testes dos PERSONAGENS — quem é o seu corpo no Mundo.
 *
 * Tudo aqui erra CALADO. A tinta não levanta exceção: ela pinta. Um piso de
 * saturação frouxo despinta a pele e o jogador vira um boneco verde; apertado
 * demais não pinta nada e os dezoito personagens ficam idênticos; um matiz NaN
 * (pixel cinza, divisão por zero na conversão) vira preto. Em nenhum desses
 * casos aparece uma linha no console — a tela fica plausível e errada.
 *
 *   node web/js/personagens.test.mjs
 */
import assert from 'node:assert';
import {
  PERSONAGEM_PADRAO, CROMA_MINIMA, cromaDe, ehIdValido, normalizarPersonagem,
  hexParaRgb, rgbParaHsl, hslParaRgb, matizDominante, girarMatiz, giroPara,
  catalogoDe, acharPersonagem,
} from './personagens.js';

let passou = 0;
const teste = (nome, fn) => {
  try { fn(); passou++; console.log('  ok  ' + nome); }
  catch (e) { console.error('  FALHOU  ' + nome + '\n      ' + e.message); process.exitCode = 1; }
};

/** Uma "textura": lista de [r,g,b] repetidos `n` vezes. */
const textura = (...blocos) => {
  const px = [];
  for (const [cor, n] of blocos) for (let i = 0; i < n; i++) px.push(...cor, 255);
  return new Uint8ClampedArray(px);
};
const LARANJA = [214, 122, 71];    // a camisa do Kenney
const VERDE = [46, 160, 100];
const PELE = [244, 205, 165];      // pálida: saturação baixa
const CINZA = [90, 94, 104];

console.log('\nPERSONAGENS — quem é o seu corpo no Mundo\n');

// ------------------------------------------------------------------- id
teste('id válido é slug; qualquer outra coisa cai no padrão', () => {
  assert.ok(ehIdValido('kaiba'));
  assert.ok(ehIdValido('para-dox'));
  assert.equal(ehIdValido('Kaiba'), false);
  assert.equal(ehIdValido(''), false);
  assert.equal(ehIdValido(null), false);
  assert.equal(normalizarPersonagem('kaiba'), 'kaiba');
  assert.equal(normalizarPersonagem(undefined), PERSONAGEM_PADRAO);
  assert.equal(normalizarPersonagem({}), PERSONAGEM_PADRAO);
});

teste('id desconhecido NUNCA vira undefined (viraria textura ausente no boneco)', () => {
  const v = normalizarPersonagem(12345);
  assert.equal(typeof v, 'string');
  assert.ok(v.length > 0);
});

// ------------------------------------------------------------------ cor
teste('hexParaRgb aceita com e sem #, recusa o resto', () => {
  assert.deepEqual(hexParaRgb('#d67a47'), [214, 122, 71]);
  assert.deepEqual(hexParaRgb('d67a47'), [214, 122, 71]);
  assert.equal(hexParaRgb('vermelho'), null);
  assert.equal(hexParaRgb('#abc'), null);
  assert.equal(hexParaRgb(null), null);
});

teste('cinza tem matiz 0 e saturação 0 — nunca NaN (NaN vira preto na tela)', () => {
  const h = rgbParaHsl(90, 90, 90);
  assert.equal(h.s, 0);
  assert.ok(Number.isFinite(h.h), 'matiz de cinza tem de ser finito');
});

teste('rgb → hsl → rgb volta na mesma cor', () => {
  for (const c of [LARANJA, VERDE, PELE, [10, 200, 240], [255, 0, 0]]) {
    const { h, s, l } = rgbParaHsl(...c);
    const volta = hslParaRgb(h, s, l);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(volta[i] - c[i]) <= 1, `${c} -> ${volta}`);
  }
});

// -------------------------------------------------------------- matiz
teste('o matiz dominante é o da cor que ocupa mais pixels cromáticos', () => {
  const t = textura([LARANJA, 100], [VERDE, 10], [PELE, 500]);
  const h = matizDominante(t);
  const esperado = rgbParaHsl(...LARANJA).h;
  assert.ok(Math.abs(h - esperado) < 12, `veio ${h}, esperava perto de ${esperado}`);
});

teste('a PELE fica abaixo do piso de CROMA — e a saturação HSL dela não ajudaria', () => {
  // este teste É a documentação da decisão: por saturacao a pele passaria
  assert.ok(rgbParaHsl(...PELE).s > 0.5, 'a pele e "saturada" no HSL — por isso o piso nao e de saturacao');
  assert.ok(cromaDe(...PELE) < CROMA_MINIMA, `croma da pele: ${cromaDe(...PELE).toFixed(2)}`);
  assert.ok(cromaDe(...LARANJA) >= CROMA_MINIMA, 'a camisa TEM de ser repintada');
  assert.ok(cromaDe(...VERDE) >= CROMA_MINIMA, 'a calca TEM de ser repintada');
  assert.ok(cromaDe(...CINZA) < CROMA_MINIMA, 'o cabelo fica');
});

teste('textura sem cor nenhuma devolve null (não inventa ângulo)', () => {
  assert.equal(matizDominante(textura([CINZA, 50], [[20, 20, 20], 50])), null);
});

teste('pixel transparente não entra na conta', () => {
  const px = new Uint8ClampedArray([...LARANJA, 0, ...VERDE, 255]);
  const h = matizDominante(px);
  assert.ok(Math.abs(h - rgbParaHsl(...VERDE).h) < 12, 'o transparente foi contado');
});

// -------------------------------------------------------------- tinta
teste('girar leva a cor dominante para o matiz pedido', () => {
  const t = textura([LARANJA, 100], [PELE, 100]);
  const giro = giroPara(t, '#2f5f8a');                 // azul
  girarMatiz(t, giro);
  const h = matizDominante(t);
  const alvo = rgbParaHsl(...hexParaRgb('#2f5f8a')).h;
  assert.ok(Math.abs(h - alvo) < 15, `virou ${h}, queria ${alvo}`);
});

teste('a PELE sobrevive à tinta (é o defeito mais visível que existe aqui)', () => {
  const t = textura([LARANJA, 50], [PELE, 50]);
  const antes = t.slice(50 * 4, 50 * 4 + 3);
  girarMatiz(t, giroPara(t, '#2f5f8a'));
  const depois = t.slice(50 * 4, 50 * 4 + 3);
  assert.deepEqual([...depois], [...antes], 'a pele foi repintada');
});

teste('par CONTROLE: com o piso em zero, a pele MUDA (o piso é usado de verdade)', () => {
  const t = textura([LARANJA, 50], [PELE, 50]);
  const antes = [...t.slice(50 * 4, 50 * 4 + 3)];
  girarMatiz(t, 120, { cromaMin: 0 });
  const depois = [...t.slice(50 * 4, 50 * 4 + 3)];
  assert.notDeepEqual(depois, antes, 'com o piso em zero a pele TEM de mudar');
});

teste('giro 0 não toca em byte nenhum', () => {
  const t = textura([LARANJA, 20]);
  const copia = t.slice();
  girarMatiz(t, 0);
  assert.deepEqual([...t], [...copia]);
});

teste('alvo cinza não gira (girar não pintaria nada, e o resultado enganaria)', () => {
  const t = textura([LARANJA, 50]);
  assert.equal(giroPara(t, '#8a8a8a'), 0);
});

teste('alvo torto não gira', () => {
  const t = textura([LARANJA, 50]);
  assert.equal(giroPara(t, 'azul'), 0);
  assert.equal(giroPara(t, null), 0);
});

teste('textura acinzentada não gira (não há de onde partir)', () => {
  assert.equal(giroPara(textura([CINZA, 50]), '#2f5f8a'), 0);
});

teste('a tinta não estoura a faixa de 0..255', () => {
  const t = textura([[255, 0, 0], 10], [[0, 255, 0], 10], [[12, 12, 250], 10]);
  girarMatiz(t, 200);
  for (const v of t) assert.ok(v >= 0 && v <= 255, 'byte fora da faixa: ' + v);
});

// ----------------------------------------------------------- catálogo
const ELENCO = [{ id: 'kaiba', name: 'Kaiba' }, { id: 'joey', name: 'Joey' }];
const CORES = (id) => ({ c: id === 'kaiba' ? '#2f5f8a' : '#c94f4f' });

teste('o catálogo começa pelo padrão e traz o elenco', () => {
  const c = catalogoDe(ELENCO, CORES);
  assert.equal(c[0].id, PERSONAGEM_PADRAO);
  assert.equal(c.length, 3);
  assert.equal(c[1].nome, 'Kaiba');
});

teste('elenco vazio ou ausente ainda dá um catálogo usável', () => {
  assert.equal(catalogoDe([], CORES).length, 1);
  assert.equal(catalogoDe(null, CORES).length, 1);
  assert.equal(catalogoDe(ELENCO, null).length, 1);   // sem cor não há o que pintar
});

teste('id repetido entra uma vez só (senão o mesmo personagem aparece duas)', () => {
  const c = catalogoDe([...ELENCO, { id: 'kaiba', name: 'Kaiba (2)' }], CORES);
  assert.equal(c.filter((p) => p.id === 'kaiba').length, 1);
});

teste('acharPersonagem cai no padrão em vez de devolver undefined', () => {
  const c = catalogoDe(ELENCO, CORES);
  assert.equal(acharPersonagem(c, 'kaiba').nome, 'Kaiba');
  assert.equal(acharPersonagem(c, 'ninguem').id, PERSONAGEM_PADRAO);
  assert.equal(acharPersonagem([], 'x').id, PERSONAGEM_PADRAO);
  assert.equal(acharPersonagem(null, null).id, PERSONAGEM_PADRAO);
});

console.log('\n' + passou + ' testes passaram\n');

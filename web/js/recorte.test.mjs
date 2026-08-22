/**
 * Testes do ENQUADRAMENTO do recorte circular — `node web/js/recorte.test.mjs`.
 *
 * A conta inteira erra CALADA. Um limite frouxo deixa a imagem descolar e o
 * icone sai com uma faixa vazia na borda; uma escala minima errada deixa a foto
 * menor que o quadro e o fundo aparece; a area de origem calculada sem desfazer
 * a escala parece certa em zoom 1 e escorrega em qualquer outro. Nenhum dos
 * tres da erro: o admin recorta, salva, publica, e o icone so' fica estranho.
 */
import {
  escalaMinima, limitarOffset, areaDeOrigem, prenderEscala, zoomNoCentro,
  enquadrarInicial, TETO_DE_ZOOM,
} from './recorte.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

const LADO = 300;

// --------------------------------------------------------- escala minima

// A MAIOR das duas razoes, e nao a menor: a menor caberia dentro do quadro
// deixando sobra — a faixa vazia que nao se quer.
t('foto horizontal: quem manda e a ALTURA', () => {
  // 600x300 no quadro de 300: a altura ja' bate (1.0), a largura sobra
  perto(escalaMinima(600, 300, LADO), 1, 'escala');
});

t('foto vertical: quem manda e a LARGURA', () => {
  perto(escalaMinima(300, 900, LADO), 1, 'escala');
});

t('foto menor que o quadro e AMPLIADA ate cobrir', () => {
  perto(escalaMinima(150, 100, LADO), 3, 'escala');   // 300/100 = 3, nao 300/150 = 2
});

t('foto quadrada do tamanho exato fica em 1', () => {
  perto(escalaMinima(300, 300, LADO), 1, 'escala');
});

t('dimensao invalida nao vira NaN nem zero', () => {
  for (const [w, h] of [[0, 100], [100, 0], [-1, 100], [NaN, 100], ['x', 'y']]) {
    assert.equal(escalaMinima(w, h, LADO), 1, `${w}x${h}`);
  }
});

// ------------------------------------------------------------- o limite

t('a imagem nunca descola da borda esquerda/superior', () => {
  const o = limitarOffset({ x: 50, y: 80 }, 600, 600, 1, LADO);
  perto(o.x, 0, 'x'); perto(o.y, 0, 'y');
});

t('nem da direita/inferior', () => {
  // 600x600 em escala 1, quadro 300: o minimo e' 300-600 = -300
  const o = limitarOffset({ x: -900, y: -900 }, 600, 600, 1, LADO);
  perto(o.x, -300, 'x'); perto(o.y, -300, 'y');
});

t('dentro dos limites, o arrasto passa intacto', () => {
  const o = limitarOffset({ x: -120, y: -37.5 }, 600, 600, 1, LADO);
  perto(o.x, -120, 'x'); perto(o.y, -37.5, 'y');
});

t('do tamanho exato do quadro, so resta o zero', () => {
  const o = limitarOffset({ x: -50, y: 50 }, 300, 300, 1, LADO);
  perto(o.x, 0, 'x'); perto(o.y, 0, 'y');
});

// Nao deveria acontecer (a escala minima impede), mas uma escala forcada de
// fora nao pode deixar a sobra num canto so'.
t('menor que o quadro, centraliza em vez de encostar num canto', () => {
  const o = limitarOffset({ x: -999, y: 999 }, 300, 300, 0.5, LADO);
  perto(o.x, 75, 'x'); perto(o.y, 75, 'y');   // (300 - 150) / 2
});

t('offset ausente ou lixo vira um numero valido', () => {
  for (const bruto of [null, undefined, {}, { x: NaN, y: 'x' }]) {
    const o = limitarOffset(bruto, 600, 600, 1, LADO);
    assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y), JSON.stringify(bruto));
  }
});

// -------------------------------------------------------- area de origem

t('em escala 1 e sem deslocamento, o recorte e o canto da imagem', () => {
  const a = areaDeOrigem({ x: 0, y: 0 }, 1, LADO);
  assert.deepEqual(a, { sx: 0, sy: 0, sw: 300, sh: 300 });
});

t('deslocado, o recorte anda o mesmo tanto na imagem', () => {
  const a = areaDeOrigem({ x: -150, y: -60 }, 1, LADO);
  perto(a.sx, 150, 'sx'); perto(a.sy, 60, 'sy');
});

// Este e' o erro que passa no olho de quem testou uma vez: em zoom 1 o
// deslocamento e o recorte coincidem, e em qualquer outro zoom escorregam.
t('com zoom, a area de origem DIVIDE pela escala', () => {
  const a = areaDeOrigem({ x: -200, y: -100 }, 2, LADO);
  perto(a.sx, 100, 'sx');    // 200 / 2, e nao 200
  perto(a.sy, 50, 'sy');
  perto(a.sw, 150, 'sw');    // 300 / 2: em 2x, metade da imagem enche o quadro
  perto(a.sh, 150, 'sh');
});

t('quanto maior o zoom, menor o pedaco da imagem que aparece', () => {
  const um = areaDeOrigem({ x: 0, y: 0 }, 1, LADO).sw;
  const quatro = areaDeOrigem({ x: 0, y: 0 }, 4, LADO).sw;
  assert.ok(quatro < um, `${quatro} deveria ser menor que ${um}`);
});

// ---------------------------------------------------------------- zoom

t('o zoom nao desce abaixo do que cobre o quadro', () => {
  const min = escalaMinima(600, 300, LADO);
  perto(prenderEscala(0.01, min), min, 'escala');
  perto(prenderEscala(-5, min), min, 'escala');
});

t('o zoom tem teto, para nao publicar um borrao', () => {
  const min = 1;
  perto(prenderEscala(999, min), TETO_DE_ZOOM, 'escala');
});

t('escala invalida cai no minimo, e nao em NaN', () => {
  for (const lixo of [NaN, undefined, null, 'x']) {
    perto(prenderEscala(lixo, 2), 2, String(lixo));
  }
});

// Sem isto o zoom "puxa" a imagem para o canto: a escala cresce a partir da
// origem e o que estava no meio escapa. Quem tenta centralizar um rosto ve' a
// foto fugir a cada rolada da roda.
t('o zoom mantem fixo o ponto do CENTRO do quadro', () => {
  const lado = 300, meio = 150;
  const offset = { x: -100, y: -100 };
  const escalaA = 1, escalaB = 2;
  const novo = zoomNoCentro(offset, escalaA, escalaB, lado);

  // o ponto da imagem que estava no centro antes...
  const antes = { x: (meio - offset.x) / escalaA, y: (meio - offset.y) / escalaA };
  // ...continua no centro depois
  const depois = { x: (meio - novo.x) / escalaB, y: (meio - novo.y) / escalaB };
  perto(depois.x, antes.x, 'x');
  perto(depois.y, antes.y, 'y');
});

t('zoom sem mudanca de escala nao mexe no offset', () => {
  const o = { x: -80, y: -40 };
  const novo = zoomNoCentro(o, 2, 2, LADO);
  perto(novo.x, o.x, 'x'); perto(novo.y, o.y, 'y');
});

// ------------------------------------------------------- enquadramento

t('a foto abre centralizada e cobrindo', () => {
  const e = enquadrarInicial(600, 300, LADO);
  perto(e.escala, 1, 'escala');
  perto(e.x, -150, 'x');   // (300 - 600) / 2
  perto(e.y, 0, 'y');
});

t('a vertical tambem abre com o meio a mostra', () => {
  const e = enquadrarInicial(300, 900, LADO);
  perto(e.escala, 1, 'escala');
  perto(e.x, 0, 'x');
  perto(e.y, -300, 'y');   // (300 - 900) / 2
});

// A propriedade que resume tudo: qualquer que seja a foto, o enquadramento
// inicial cobre o quadro inteiro — nenhum pixel de fundo aparece.
t('nenhuma proporcao de foto abre com faixa vazia', () => {
  for (const [w, h] of [[1, 1], [16, 9], [9, 16], [1000, 3], [3, 1000], [128, 128], [64, 300]]) {
    const e = enquadrarInicial(w, h, LADO);
    const a = areaDeOrigem(e, e.escala, LADO);
    assert.ok(a.sx >= -1e-9, `${w}x${h}: recorte comeca fora (sx ${a.sx})`);
    assert.ok(a.sy >= -1e-9, `${w}x${h}: recorte comeca fora (sy ${a.sy})`);
    assert.ok(a.sx + a.sw <= w + 1e-9, `${w}x${h}: recorte passa da largura`);
    assert.ok(a.sy + a.sh <= h + 1e-9, `${w}x${h}: recorte passa da altura`);
  }
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

/**
 * Testes da SETA de ataque.
 *   node web/js/setaataque.test.mjs
 *
 * A seta erra do jeito mais caro: calada. Um `NaN` no atributo `d` faz o
 * navegador não desenhar nada — sem erro no console, sem sintoma além de "às
 * vezes não aparece". Por isso o que se testa aqui é sobretudo o que NÃO pode
 * sair da conta.
 */
import { geometriaDaSeta, centroDe, haloDoAlvo, mostrarCamada, esconderCamada } from './setaataque.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

/** Todo número que saiu na string é finito? */
const numeros = (str) => String(str).match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
const todosFinitos = (str) => numeros(str).every(Number.isFinite) && !/NaN|Infinity/.test(String(str));

const zona = (left, top) => ({ left, top, width: 58, height: 84 });

console.log('\ncentro de uma zona');

t('o centro de um retangulo de tela', () => {
  assert.deepEqual(centroDe(zona(100, 200)), { x: 129, y: 242 });
});

t('sem retangulo nao inventa ponto', () => {
  for (const r of [null, undefined, {}, { left: NaN, top: 0 }]) assert.equal(centroDe(r), null);
});

console.log('\na geometria');

t('ataque de cima para baixo: a seta sai do atacante', () => {
  const g = geometriaDaSeta({ x: 300, y: 100 }, { x: 300, y: 400 }, 30);
  assert.ok(g, 'devia desenhar');
  assert.ok(g.d.startsWith('M 300 100 '), g.d);
  assert.ok(todosFinitos(g.d), g.d);
  assert.ok(todosFinitos(g.abas), g.abas);
});

t('a ponta para ANTES do alvo — nao no centro dele', () => {
  const alvo = { x: 300, y: 400 };
  const g = geometriaDaSeta({ x: 300, y: 100 }, alvo, 30);
  const [, , , , fimX, fimY] = numeros(g.d);   // M x y Q cx cy fimX fimY
  const sobra = Math.hypot(alvo.x - fimX, alvo.y - fimY);
  assert.ok(sobra >= 30, `a seta invadiu a carta (sobrou ${sobra}px, o raio e' 30)`);
});

t('a seta cobre a maior parte do caminho (nao e um traco perdido no meio)', () => {
  const g = geometriaDaSeta({ x: 100, y: 100 }, { x: 500, y: 100 }, 30);
  const [iniX, , , , fimX] = numeros(g.d);
  assert.ok(fimX - iniX > 400 * 0.6, `corpo curto demais: ${fimX - iniX}px de 400`);
});

t('zonas VIZINHAS ainda rendem seta — o recuo nunca come o caminho todo', () => {
  const g = geometriaDaSeta({ x: 300, y: 300 }, { x: 340, y: 300 }, 36);
  assert.ok(g, 'com 40px de distancia e raio 36 ainda tem de sair seta');
  assert.ok(todosFinitos(g.d), g.d);
  const [iniX, iniY, , , fimX, fimY] = numeros(g.d);
  assert.ok(Math.hypot(fimX - iniX, fimY - iniY) > 0, 'o corpo ficou com comprimento zero');
});

t('ataque DIRETO (sem alvo com tamanho): seta normal, so mais curta', () => {
  const g = geometriaDaSeta({ x: 300, y: 400 }, { x: 300, y: 60 }, 0);
  assert.ok(todosFinitos(g.d), g.d);
});

console.log('\na mancha do alvo');

t('e um RETANGULO em volta da carta, com folga para fora', () => {
  const h = haloDoAlvo({ left: 100, top: 200, width: 62, height: 90 }, 8);
  assert.deepEqual(h, { x: 92, y: 192, width: 78, height: 106, rx: 4 });
});

t('a folga sobra dos QUATRO lados — nunca por cima da arte', () => {
  const r = { left: 300, top: 120, width: 62, height: 90 };
  const h = haloDoAlvo(r, 8);
  assert.ok(h.x < r.left && h.y < r.top, 'nasceu dentro da carta');
  assert.ok(h.x + h.width > r.left + r.width, 'nao cobriu a direita');
  assert.ok(h.y + h.height > r.top + r.height, 'nao cobriu embaixo');
});

t('sem retangulo (ataque direto) nao ha mancha', () => {
  for (const r of [null, undefined, {}, { left: 1, top: 1, width: 0, height: 90 },
                   { left: NaN, top: 0, width: 10, height: 10 }])
    assert.equal(haloDoAlvo(r), null, JSON.stringify(r));
});

console.log('\no que NAO pode sair da conta');

t('mesma posicao: devolve null em vez de dividir por zero', () => {
  assert.equal(geometriaDaSeta({ x: 200, y: 200 }, { x: 200, y: 200 }, 30), null);
  assert.equal(geometriaDaSeta({ x: 200, y: 200 }, { x: 200.4, y: 200 }, 30), null);
});

t('ponto faltando ou nao-finito: null, nunca um caminho com NaN', () => {
  const bons = { x: 10, y: 10 };
  for (const ruim of [null, undefined, {}, { x: 1 }, { x: NaN, y: 2 }, { x: 1, y: Infinity }]) {
    assert.equal(geometriaDaSeta(ruim, bons, 20), null, JSON.stringify(ruim));
    assert.equal(geometriaDaSeta(bons, ruim, 20), null, JSON.stringify(ruim));
  }
});

t('as oito direcoes saem finitas — nenhum quadrante quebra a normal', () => {
  const c = { x: 400, y: 300 };
  for (const [dx, dy] of [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]) {
    const g = geometriaDaSeta(c, { x: c.x + dx * 200, y: c.y + dy * 200 }, 30);
    assert.ok(g, `direcao ${dx},${dy}`);
    assert.ok(todosFinitos(g.d) && todosFinitos(g.abas), `direcao ${dx},${dy}: ${g.d} / ${g.abas}`);
  }
});

t('a cabeca tem tres pontos, sempre', () => {
  const g = geometriaDaSeta({ x: 0, y: 0 }, { x: 300, y: 300 }, 30);
  assert.equal(g.abas.trim().split(/\s+/).length, 6, 'tres pares x/y');
});

t('a curva desvia da reta (senao a seta some entre duas artes)', () => {
  const g = geometriaDaSeta({ x: 100, y: 300 }, { x: 500, y: 300 }, 30);
  const [, , ctrlX, ctrlY] = numeros(g.d);
  assert.ok(Math.abs(ctrlY - 300) > 20, `o controle da curva ficou na reta (${ctrlX},${ctrlY})`);
});


console.log('\nmostrar e esconder a camada');

/**
 * Um `<svg>` de mentira que se comporta como o de verdade no que importa:
 * `SVGElement` NAO tem a propriedade `hidden` (ela e' do `HTMLElement`), entao
 * atribuir `.hidden` nele e' um campo solto que nao mexe em atributo nenhum.
 */
const svgFalso = () => {
  const attrs = new Map([['hidden', '']]);
  return {
    hidden: undefined,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
  };
};

t('mostrar TIRA o atributo hidden — nao mexe na propriedade', () => {
  const el = svgFalso();
  mostrarCamada(el);
  assert.equal(el.hasAttribute('hidden'), false,
    'era `svg.hidden = false`, que num SVG nao faz nada: a seta nunca aparecia');
});

t('esconder devolve o atributo', () => {
  const el = svgFalso();
  mostrarCamada(el);
  esconderCamada(el);
  assert.equal(el.hasAttribute('hidden'), true);
});

t('sem elemento nenhum: nao estoura', () => {
  mostrarCamada(null); esconderCamada(undefined);
});

console.log(`\n${pass} ok, ${fail} falha(s)\n`);
process.exit(fail ? 1 : 0);

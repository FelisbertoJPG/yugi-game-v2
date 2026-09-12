/**
 * Testes de `malha.js` — subdividir e deformar uma peça importada.
 *
 * O bug que originou o arquivo: as peças de CHÃO do Tag Force têm 3 a 8
 * triângulos, e marcá-las como terreno não produzia fenda nenhuma. Com quatro
 * cantos, a superfície entre eles é um plano — o buraco cavado no meio dela não
 * tem onde existir. Nada avisa: a estrada some do relevo em silêncio.
 *
 *   node web/js/malha.test.mjs
 */
import assert from 'node:assert';
import * as THREE from '../vendor/three/three.module.min.js';
import { subdividir, deformarPeloRelevo, triangulosDe, TETO_TRIANGULOS } from './malha.js';

let passou = 0;
const teste = (nome, fn) => {
  try { fn(); passou++; console.log('  ok  ' + nome); }
  catch (e) { console.error('  FALHOU  ' + nome + '\n      ' + e.message); process.exitCode = 1; }
};

console.log('\nmalha: subdividir e deformar\n');

/** Uma estrada como as do Tag Force: um retângulo de dois triângulos. */
function estrada(lx = 4, lz = 12) {
  const g = new THREE.PlaneGeometry(lx, lz, 1, 1);
  g.rotateX(-Math.PI / 2);
  return g.toNonIndexed();
}

const maiorAresta = (geo) => {
  const p = geo.attributes.position;
  let max = 0;
  for (let i = 0; i < p.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = k, b = (k + 1) % 3;
      const d = Math.hypot(
        p.getX(i + a) - p.getX(i + b),
        p.getY(i + a) - p.getY(i + b),
        p.getZ(i + a) - p.getZ(i + b),
      );
      if (d > max) max = d;
    }
  }
  return max;
};

const alturasDe = (geo) => {
  const a = geo.attributes.position.array;
  let min = Infinity, max = -Infinity;
  for (let i = 1; i < a.length; i += 3) { if (a[i] < min) min = a[i]; if (a[i] > max) max = a[i]; }
  return { min, max };
};

// ------------------------------------------------------------ subdividir
teste('subdividir corta ate nenhuma aresta passar do alvo', () => {
  const g = subdividir(estrada(), 1);
  assert.ok(maiorAresta(g) <= 1.001, 'sobrou aresta de ' + maiorAresta(g).toFixed(3) + ' m');
});

teste('a peca de 2 triangulos vira muitos — e ISSO e o que permite a fenda', () => {
  const antes = triangulosDe(estrada());
  const depois = triangulosDe(subdividir(estrada(), 1));
  assert.equal(antes, 2);
  assert.ok(depois > 40, 'so ' + depois + ' triangulos: nao ha onde a fenda existir');
});

teste('a geometria ORIGINAL nao e tocada (ela e compartilhada)', () => {
  // deformar a da biblioteca deformaria todas as copias da peca de uma vez
  const orig = estrada();
  const antes = triangulosDe(orig);
  subdividir(orig, 0.5);
  assert.equal(triangulosDe(orig), antes);
});

teste('o UV vem junto — sem ele a estrada perde a textura', () => {
  // e o sintoma pareceria erro do extrator, nao daqui
  const g = subdividir(estrada(), 1);
  assert.ok(g.attributes.uv, 'sumiu o uv');
  assert.equal(g.attributes.uv.count, g.attributes.position.count);
  const uv = g.attributes.uv.array;
  for (let i = 0; i < uv.length; i++) {
    assert.ok(uv[i] >= -0.001 && uv[i] <= 1.001, 'uv fora de 0..1: ' + uv[i]);
  }
});

teste('geometria INDEXADA da o mesmo resultado que a solta', () => {
  const idx = new THREE.PlaneGeometry(4, 12, 1, 1);
  idx.rotateX(-Math.PI / 2);
  assert.ok(idx.index, 'o teste precisa de uma geometria indexada');
  assert.ok(maiorAresta(subdividir(idx, 1)) <= 1.001);
});

teste('o TETO segura a explosao — subdividir dobra a cada passe', () => {
  // uma peca de 3 mil triangulos marcada como terreno viraria centenas de
  // milhares sem nada avisar, e a culpa cairia no relevo
  const g = subdividir(estrada(200, 200), 0.05);
  assert.ok(triangulosDe(g) <= TETO_TRIANGULOS, 'estourou: ' + triangulosDe(g));
});

teste('alvo torto nao mexe em nada (nem levanta)', () => {
  const g = estrada();
  assert.equal(subdividir(g, 0), g);
  assert.equal(subdividir(g, -1), g);
  assert.equal(subdividir(null, 1), null);
});

// -------------------------------------------------------------- deformar
teste('deformar poe a estrada NO relevo', () => {
  const g = deformarPeloRelevo(subdividir(estrada(), 1), (x, z) => (Math.abs(x) < 1 && Math.abs(z) < 1 ? -3 : 0));
  const { min } = alturasDe(g);
  assert.ok(min < -2.9, 'a fenda nao apareceu: fundo em ' + min.toFixed(2));
});

teste('a altura e SOMADA, nao substituida — o meio-fio sobrevive ao morro', () => {
  // substituir achataria a peca contra o terreno, e o relato seria
  // "a estrada perdeu o relevo dela"
  const g = estrada();
  g.translate(0, 0.08, 0);                       // um meio-fio de 8 cm
  const d = deformarPeloRelevo(subdividir(g, 1), () => 5);
  const { min, max } = alturasDe(d);
  assert.ok(Math.abs(min - 5.08) < 1e-4, 'perdeu o meio-fio: ' + min);
  assert.ok(Math.abs(max - 5.08) < 1e-4);
});

teste('as NORMAIS sao refeitas — senao o morro some na luz', () => {
  const g = deformarPeloRelevo(subdividir(estrada(), 1), (x) => x * 0.8);
  const n = g.attributes.normal.array;
  let inclinada = 0;
  for (let i = 1; i < n.length; i += 3) if (n[i] < 0.98) inclinada++;
  assert.ok(inclinada > 0, 'toda normal aponta para cima: a rampa seria plana na luz');
});

teste('altura que devolve NaN nao contamina a malha', () => {
  // vertice NaN faz o objeto INTEIRO sumir da tela, sem erro nenhum
  const g = deformarPeloRelevo(subdividir(estrada(), 2), () => NaN);
  for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v), 'NaN na malha');
});

console.log('\n' + passou + ' testes passaram\n');

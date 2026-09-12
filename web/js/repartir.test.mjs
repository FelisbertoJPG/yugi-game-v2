/**
 * Testes de `repartir.js` — repartir um corpo SEM nomes de junta.
 *
 * O caso real: um modelo baixado do Sketchfab traz 140 nós chamados `Object_17`
 * e o **corpo inteiro numa malha só**. Sem repartir, ele entra pendurado no
 * tronco e desliza pelo chão inteiriço — carregou, apareceu, e o defeito parece
 * do modelo.
 *
 * Todo número aqui foi conferido contra um corpo de verdade (o
 * `long_hair_high_school_girl`, 5.902 vértices, pose de T): altura 1,612,
 * envergadura 1,388, ombro em 81% da altura, quadril em 47%.
 *
 *   node web/js/repartir.test.mjs
 */
import assert from 'node:assert/strict';
import {
  perfilDoCorpo, ehPoseT, juntaDoPonto, repartirTriangulos, baixarBracos,
} from './repartir.js';

let pass = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); process.exitCode = 1; }
};

console.log('\n  ---- repartir um corpo pela POSICAO ----\n');

/**
 * Um corpo sintético com as proporções do modelo real.
 * `braco`: 'T' (horizontal) ou 'baixo'.
 */
function corpo({ braco = 'T', alt = 1.6, cabelo = 0 } = {}) {
  const p = [];
  /**
   * Uma CAIXA de pontos, e nao uma linha.
   *
   * A primeira versao deste ajudante andava com x e y JUNTOS, produzindo uma
   * diagonal: em cada faixa de altura havia dois pontos coladinhos, e a
   * largura medida dava metade da real. O teste acusou (`meia-largura 0.089`
   * onde o tronco tem 0,16) — e o defeito era do corpo de mentira, nao do
   * codigo. Fixture que nao parece com o caso real testa outra coisa.
   */
  const nuvem = (x0, x1, y0, y1, n = 12) => {
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < n; k++) {
        p.push([x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * k) / (n - 1), 0]);
      }
    }
  };
  const ombro = alt * 0.81;
  nuvem(-0.15, 0.15, 0, alt * 0.47);            // pernas
  nuvem(-0.16, 0.16, alt * 0.47, ombro);        // tronco
  nuvem(-0.09, 0.09, alt * 0.86, alt);          // cabeca
  if (braco === 'T') {
    nuvem(-0.70, -0.16, ombro - 0.05, ombro + 0.05);
    nuvem(0.16, 0.70, ombro - 0.05, ombro + 0.05);
  } else {
    nuvem(-0.22, -0.16, alt * 0.5, ombro);
    nuvem(0.16, 0.22, alt * 0.5, ombro);
  }
  // cabelo longo: estica a caixa PARA CIMA sem mexer no corpo
  if (cabelo) nuvem(-0.12, 0.12, alt, alt + cabelo);
  return p;
}

// ------------------------------------------------------------- o perfil
t('o perfil acha o ombro, o quadril e a largura do tronco', () => {
  const p = perfilDoCorpo(corpo());
  assert.ok(Math.abs(p.alt - 1.6) < 0.01, 'altura ' + p.alt);
  assert.ok(p.ombro > 1.2 && p.ombro < 1.4, 'ombro em ' + p.ombro.toFixed(3));
  assert.ok(p.quadril > 0.6 && p.quadril < 0.9, 'quadril em ' + p.quadril.toFixed(3));
  assert.ok(p.meiaLarguraDoTronco > 0.1 && p.meiaLarguraDoTronco < 0.3,
    'meia-largura ' + p.meiaLarguraDoTronco.toFixed(3));
});

t('corpo vazio ou torto devolve null em vez de derrubar', () => {
  assert.equal(perfilDoCorpo([]), null);
  assert.equal(perfilDoCorpo(null), null);
  assert.equal(perfilDoCorpo([[0, 5, 0], [0, 5, 0]]), null, 'altura zero');
});

// -------------------------------------------------------------- a pose
t('a POSE DE T e reconhecida, e a pose de repouso NAO', () => {
  // e' a diferenca entre corrigir e estragar: baixar bracos que ja estao
  // baixos os enfia dentro do corpo
  assert.equal(ehPoseT(perfilDoCorpo(corpo({ braco: 'T' }))), true);
  assert.equal(ehPoseT(perfilDoCorpo(corpo({ braco: 'baixo' }))), false);
});

t('CABELO LONGO nao desloca o ombro — ele estica a caixa, nao o corpo', () => {
  // um limiar em fracao fixa da altura cortaria o pescoco no meio do peito
  const sem = perfilDoCorpo(corpo({ cabelo: 0 }));
  const com = perfilDoCorpo(corpo({ cabelo: 0.5 }));
  assert.ok(Math.abs(sem.ombro - com.ombro) < 0.12,
    `o ombro andou ${(com.ombro - sem.ombro).toFixed(3)} m por causa do cabelo`);
});

// ------------------------------------------------------------ as juntas
t('cada regiao do corpo cai na sua junta', () => {
  const p = perfilDoCorpo(corpo());
  assert.equal(juntaDoPonto([0, 1.5], p), 'cabeca');
  assert.equal(juntaDoPonto([0, 1.0], p), 'tronco');
  assert.equal(juntaDoPonto([-0.05, 0.3], p), 'pernaE');
  assert.equal(juntaDoPonto([0.05, 0.3], p), 'pernaD');
  assert.equal(juntaDoPonto([-0.5, 1.29], p), 'bracoE');
  assert.equal(juntaDoPonto([0.5, 1.29], p), 'bracoD');
});

t('em pose de T a MAO nao vira cabeca', () => {
  // ela fica na altura do ombro, e uma regra que perguntasse "esta acima do
  // pescoco?" primeiro mandaria as maos para a cabeca — so' se descobre isso
  // vendo o personagem andar de maos na testa
  const p = perfilDoCorpo(corpo());
  const naAlturaDoOmbro = p.ombro + 0.02;
  assert.equal(juntaDoPonto([0.68, naAlturaDoOmbro], p), 'bracoD');
  assert.equal(juntaDoPonto([-0.68, naAlturaDoOmbro], p), 'bracoE');
});

t('o corte e por TRIANGULO — cortar por vertice rasgaria a malha', () => {
  const p = perfilDoCorpo(corpo());
  // um triangulo com um vertice no tronco e dois no braco vai INTEIRO para
  // onde esta o centro dele
  const pos = new Float32Array([
    0.10, 1.29, 0, 0.60, 1.29, 0, 0.60, 1.31, 0,
  ]);
  const g = repartirTriangulos(pos, p);
  const juntas = Object.keys(g);
  assert.equal(juntas.length, 1, 'o triangulo foi para ' + juntas.length + ' juntas');
  assert.equal(g[juntas[0]].length, 1);
});

t('nenhum triangulo se perde na reparticao', () => {
  const p = perfilDoCorpo(corpo());
  const pontos = corpo();
  const pos = new Float32Array(Math.floor(pontos.length / 3) * 9);
  for (let i = 0; i < pos.length / 3; i++) {
    const q = pontos[i % pontos.length];
    pos[i * 3] = q[0]; pos[i * 3 + 1] = q[1]; pos[i * 3 + 2] = q[2];
  }
  const g = repartirTriangulos(pos, p);
  const soma = Object.values(g).reduce((a, l) => a + l.length, 0);
  assert.equal(soma, pos.length / 9);
});

// ------------------------------------------------------- baixar os bracos
t('baixar os bracos ESTREITA o corpo em vez de alarga-lo', () => {
  const p = perfilDoCorpo(corpo());
  // um braco horizontal, do ombro para fora
  const pos = new Float32Array([
    0.20, p.ombro, 0, 0.70, p.ombro, 0, 0.70, p.ombro + 0.05, 0,
  ]);
  const antes = Math.max(pos[0], pos[3], pos[6]);
  baixarBracos(pos, p);
  const depois = Math.max(pos[0], pos[3], pos[6]);
  assert.ok(depois < antes * 0.6, `de ${antes.toFixed(3)} para ${depois.toFixed(3)}`);
});

t('os bracos vao para BAIXO, e nao para cima', () => {
  // O bug que a medicao pegou: `+angulo * lado` sobe os DOIS. O resultado foi
  // um personagem de 1,95 m (o alvo era 1,72) com as maos acima da cabeca —
  // nada acusou, ele so' ficou de bracos erguidos.
  const p = perfilDoCorpo(corpo());
  for (const lado of [-1, 1]) {
    const x = lado * 0.65;
    const pos = new Float32Array([
      lado * 0.20, p.ombro, 0, x, p.ombro, 0, x, p.ombro + 0.04, 0,
    ]);
    baixarBracos(pos, p);
    const ymax = Math.max(pos[1], pos[4], pos[7]);
    assert.ok(ymax <= p.ombro + 0.05,
      `o braco ${lado < 0 ? 'esquerdo' : 'direito'} subiu para y=${ymax.toFixed(3)}`
      + ` (o ombro esta em ${p.ombro.toFixed(3)})`);
  }
});

t('so os BRACOS sao girados — perna e cabeca ficam onde estao', () => {
  const p = perfilDoCorpo(corpo());
  const pos = new Float32Array([
    0, 0.30, 0, 0.05, 0.30, 0, 0.05, 0.35, 0,        // perna
    0, 1.50, 0, 0.05, 1.50, 0, 0.05, 1.55, 0,        // cabeca
  ]);
  const copia = Float32Array.from(pos);
  baixarBracos(pos, p);
  assert.deepEqual(Array.from(pos), Array.from(copia));
});

console.log(`\n  ${pass} passaram\n`);

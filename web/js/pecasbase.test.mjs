/**
 * Testes das PEÇAS BASE — a árvore, a pedra e o chão do Editor de Cena.
 *
 * Elas são geometria, e geometria erra CALADA: nada levanta, a peça só não
 * aparece, ou aparece branca, ou aparece do tamanho errado. Cada asserção aqui
 * guarda uma dessas.
 *
 *   node web/js/pecasbase.test.mjs
 */
import assert from 'node:assert';
import { PECAS_BASE, ehPecaBase, PREFIXO_BASE, geometriaBase, catalogoBase } from './pecasbase.js';
import { GRUPO_TAGFORCE, juntarCatalogos, agrupar, ORDEM } from './cenagaveta.js';
import { relevoVazio, esculpir, alturaDoRelevo } from './cena.js';

let passou = 0;
const teste = (nome, fn) => {
  try { fn(); passou++; console.log('  ok  ' + nome); }
  catch (e) { console.error('  FALHOU  ' + nome + '\n      ' + e.message); process.exitCode = 1; }
};

console.log('\nPEÇAS BASE e a gaveta agrupada\n');

// ------------------------------------------------------------- geometria
teste('toda peça base constrói uma geometria com triângulos', () => {
  for (const p of PECAS_BASE) {
    const g = p.geo();
    assert.ok(g?.attributes?.position, p.id + ': sem posicao');
    assert.ok(g.attributes.position.count >= 3, p.id + ': menos que um triangulo');
    assert.equal(g.attributes.position.count % 3, 0, p.id + ': nao fecha em triangulos');
  }
});

teste('nenhuma tem NaN — objeto com matriz/vértice NaN NÃO APARECE, sem erro', () => {
  for (const p of PECAS_BASE) {
    const a = p.geo().attributes.position.array;
    for (let i = 0; i < a.length; i++) {
      assert.ok(Number.isFinite(a[i]), `${p.id}: NaN na posicao ${i}`);
    }
  }
});

teste('toda peça tem NORMAL (sem ela, a peça fica preta sob luz direcional)', () => {
  for (const p of PECAS_BASE) {
    const g = p.geo();
    assert.ok(g.attributes.normal, p.id + ': sem normal');
    assert.equal(g.attributes.normal.count, g.attributes.position.count, p.id);
  }
});

teste('toda peça tem COR no vértice (sem ela o material sai BRANCO)', () => {
  // `fundir` grava cor por vértice, e o material do editor usa `vertexColors`.
  // Uma peça sem esse atributo aparece branca — não quebra, e é indistinguível
  // de arte ruim.
  for (const p of PECAS_BASE) {
    const g = p.geo();
    assert.ok(g.attributes.color, p.id + ': sem cor de vertice');
    assert.equal(g.attributes.color.count, g.attributes.position.count, p.id);
  }
});

teste('a cor não é preta em nenhuma peça (preto passa por "sem cor")', () => {
  for (const p of PECAS_BASE) {
    const c = p.geo().attributes.color.array;
    let soma = 0;
    for (let i = 0; i < c.length; i++) soma += c[i];
    assert.ok(soma > 0, p.id + ': todas as cores em zero');
  }
});

teste('as peças assentam no CHÃO — nada nasce enterrado nem flutuando', () => {
  // o editor põe a peça no y do chão; se a malha estiver centrada na origem,
  // metade dela nasce debaixo da terra
  for (const p of PECAS_BASE) {
    const g = p.geo();
    g.computeBoundingBox();
    const base = g.boundingBox.min.y;
    assert.ok(base > -0.35, `${p.id}: a base fica em y=${base.toFixed(2)}, enterrada`);
    assert.ok(base < 0.35, `${p.id}: a base fica em y=${base.toFixed(2)}, flutuando`);
  }
});

teste('tamanho plausível — nada microscópico nem do tamanho do mapa', () => {
  for (const p of catalogoBase()) {
    const maior = Math.max(...p.dim);
    assert.ok(maior >= 0.3, `${p.id}: ${maior} m, pequena demais para achar na cena`);
    assert.ok(maior <= 20, `${p.id}: ${maior} m, maior que a clareira`);
  }
});

// ------------------------------------------------------------- catálogo
teste('a DIMENSÃO do catálogo é MEDIDA da geometria (não escrita à mão)', () => {
  const cat = catalogoBase();
  for (const c of cat) {
    const g = PECAS_BASE.find((p) => p.id === c.id).geo();
    g.computeBoundingBox();
    const real = [
      g.boundingBox.max.x - g.boundingBox.min.x,
      g.boundingBox.max.y - g.boundingBox.min.y,
      g.boundingBox.max.z - g.boundingBox.min.z,
    ];
    for (let e = 0; e < 3; e++) {
      assert.ok(Math.abs(c.dim[e] - real[e]) < 0.11,
        `${c.id}: a gaveta diz ${c.dim[e]} e a peca tem ${real[e].toFixed(2)}`);
    }
  }
});

teste('id único, com o prefixo que separa das peças do Tag Force', () => {
  const ids = PECAS_BASE.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'id repetido');
  for (const id of ids) {
    assert.ok(ehPecaBase(id), id + ': sem o prefixo');
    assert.ok(id.startsWith(PREFIXO_BASE));
    // o id vira caminho e chave de cena: slug ou nada
    assert.match(id, /^[a-z0-9][a-z0-9-]{0,63}$/);
  }
});

teste('ehPecaBase separa as duas fontes — é o que decide código × arquivo', () => {
  assert.ok(ehPecaBase('base-pedra'));
  assert.equal(ehPecaBase('bg-01-01-02'), false);
  assert.equal(ehPecaBase(null), false);
  assert.equal(ehPecaBase(42), false);
});

teste('geometriaBase devolve null para id desconhecido (nunca undefined)', () => {
  assert.ok(geometriaBase('base-pedra'));
  assert.equal(geometriaBase('base-nao-existe'), null);
  assert.equal(geometriaBase('bg-01-01-02'), null);
});

// ----------------------------------------------------------------- relevo
// A placa é onde o relevo VIRA imagem. Estes testes existem porque a primeira
// versão passava as quatro alturas dos CANTOS e interpolava por dentro: com a
// grade de 4 m e placas de 4 m grudadas em múltiplos de 4, os cantos caem
// sempre no meio de dois nós, e o cume — o único lugar onde se olha — saía
// PLANO. O editor parecia não ter relevo nenhum.
const alturaDaCena = (relevo, cx, cz) => (lx, lz) => alturaDoRelevo(relevo, cx + lx, cz + lz);

const alturasDe = (g) => {
  const a = g.attributes.position.array;
  let min = Infinity, max = -Infinity;
  for (let i = 1; i < a.length; i += 3) { if (a[i] < min) min = a[i]; if (a[i] > max) max = a[i]; }
  return { min, max };
};

teste('a placa CHEGA na altura esculpida — o cume nao pode achatar', () => {
  const r = esculpir(relevoVazio(), 0, 0, 6, { raio: 6 });
  const g = geometriaBase('base-chao-grama', alturaDaCena(r, 0, 0));
  const { max } = alturasDe(g);
  assert.ok(max > 5.9, 'a placa sobre o cume ficou em ' + max.toFixed(2) + ' m, devia ser ~6');
});

teste('a placa sobre o morro NAO e plana (era esse o bug)', () => {
  const r = esculpir(relevoVazio(), 0, 0, 6, { raio: 6 });
  const { min, max } = alturasDe(geometriaBase('base-chao-grama', alturaDaCena(r, 0, 0)));
  assert.ok(max - min > 1, `desnivel de apenas ${(max - min).toFixed(3)} m dentro da placa`);
});

teste('sem relevo a placa continua plana (a geometria da biblioteca serve)', () => {
  // a tolerância é o resto do `rotateX` (1e-16 m): a placa É plana
  const { min, max } = alturasDe(geometriaBase('base-chao-grama'));
  assert.ok(Math.abs(min) < 1e-9 && Math.abs(max) < 1e-9, `${min} .. ${max}`);
});

teste('a placa GRANDE nao perde o relevo do meio dela', () => {
  // 12 m com a grade de 4 m: os cantos sozinhos jogariam fora os nós internos,
  // e um morro inteiro sumiria dentro de uma placa só
  const r = esculpir(relevoVazio(), 0, 0, 8, { raio: 5 });
  const { max } = alturasDe(geometriaBase('base-chao-grande', alturaDaCena(r, 0, 0)));
  assert.ok(max > 7.9, 'a placa de 12 m parou em ' + max.toFixed(2) + ' m');
});

teste('placas VIZINHAS fecham na borda (sem fresta vertical)', () => {
  const r = esculpir(relevoVazio(), 0, 0, 5, { raio: 10 });
  const esq = geometriaBase('base-chao-grama', alturaDaCena(r, -2, 0));
  const dir = geometriaBase('base-chao-grama', alturaDaCena(r, 2, 0));
  // a borda direita da esquerda (lx = +2 → mundo 0) é a borda esquerda da
  // direita (lx = -2 → mundo 0): os mesmos pontos do mundo, a mesma altura
  const naBorda = (g, lx) => {
    const a = g.attributes.position.array, h = new Map();
    for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - lx) < 1e-6) h.set(a[i + 2].toFixed(4), a[i + 1]);
    return h;
  };
  const a = naBorda(esq, 2), b = naBorda(dir, -2);
  assert.ok(a.size >= 5, 'nao achei a borda: ' + a.size);
  for (const [z, y] of a) assert.ok(Math.abs(y - b.get(z)) < 1e-6, `fresta em z=${z}: ${y} vs ${b.get(z)}`);
});

teste('a placa com relevo tem NORMAL de face — senao o morro some na luz', () => {
  const r = esculpir(relevoVazio(), 0, 0, 6, { raio: 6 });
  const n = geometriaBase('base-chao-grama', alturaDaCena(r, 4, 0)).attributes.normal.array;
  let inclinada = 0;
  for (let i = 1; i < n.length; i += 3) if (n[i] < 0.98) inclinada++;
  assert.ok(inclinada > 0, 'toda normal aponta para cima: a rampa seria iluminada como plano');
  for (let i = 0; i < n.length; i += 3) {
    const c = Math.hypot(n[i], n[i + 1], n[i + 2]);
    assert.ok(Math.abs(c - 1) < 1e-3, 'normal nao normalizada: ' + c);
  }
});

teste('toda peça declara um grupo, e todo grupo está na ORDEM da gaveta', () => {
  for (const p of PECAS_BASE) {
    assert.ok(p.grupo, p.id + ': sem grupo');
    assert.ok(ORDEM.includes(p.grupo), `${p.id}: grupo "${p.grupo}" fora da ORDEM — cairia no fim`);
  }
});

// --------------------------------------------------------------- gaveta
const TAG = [
  { id: 'bg-01-01-02', dim: [4, 1, 1], tri: 46 },
  { id: 'bg-10-01-05', dim: [9, 4, 7], tri: 445 },
];

teste('juntar põe as base ANTES das do Tag Force (a gaveta é lida de cima)', () => {
  const j = juntarCatalogos(catalogoBase(), TAG);
  assert.ok(ehPecaBase(j[0].id), 'a primeira tem de ser base');
  assert.equal(j.length, PECAS_BASE.length + TAG.length);
});

teste('peça do Tag Force sem grupo cai no grupo do Tag Force', () => {
  const j = juntarCatalogos([], TAG);
  assert.ok(j.every((p) => p.grupo === GRUPO_TAGFORCE));
});

teste('o grupo do Tag Force nasce FECHADO, e os base ABERTOS', () => {
  const secoes = agrupar(juntarCatalogos(catalogoBase(), TAG));
  const tag = secoes.find((s) => s.grupo === GRUPO_TAGFORCE);
  assert.ok(tag, 'o grupo do Tag Force tem de existir');
  assert.equal(tag.aberto, false, 'ele nasce fechado — sao 142 pecas');
  for (const s of secoes.filter((x) => x.grupo !== GRUPO_TAGFORCE)) {
    assert.equal(s.aberto, true, s.grupo + ': as pecas base ficam a mao');
  }
});

teste('BUSCANDO, tudo abre — resultado dentro de seção fechada parece bug', () => {
  const secoes = agrupar(juntarCatalogos(catalogoBase(), TAG), 'bg-10');
  assert.ok(secoes.every((s) => s.aberto), 'com busca, toda secao tem de abrir');
  assert.equal(secoes.length, 1, 'so o grupo com resultado aparece');
  assert.equal(secoes[0].pecas.length, 1);
});

teste('a busca acha pelo NOME, não só pelo id (o nome é o que está na tela)', () => {
  const s = agrupar(juntarCatalogos(catalogoBase(), TAG), 'pinheiro');
  assert.equal(s.length, 1);
  assert.equal(s[0].pecas[0].id, 'base-conifera');
});

teste('a ordem das seções é a da ORDEM, e o desconhecido vai para o FIM', () => {
  const extra = [{ id: 'x-1', dim: [1, 1, 1], tri: 2, grupo: 'Zzz' }];
  const secoes = agrupar(juntarCatalogos(catalogoBase(), [...TAG, ...extra]));
  const nomes = secoes.map((s) => s.grupo);
  assert.equal(nomes[0], ORDEM[0], 'a primeira secao e a primeira da ORDEM');
  assert.equal(nomes[nomes.length - 1], 'Zzz', 'grupo fora da ORDEM vai para o fim');
});

teste('busca que não acha nada devolve lista vazia, não uma seção vazia', () => {
  assert.deepEqual(agrupar(juntarCatalogos(catalogoBase(), TAG), 'zzzzzz'), []);
});

teste('catálogo nulo não derruba (o editor abre sem a biblioteca do Tag Force)', () => {
  assert.deepEqual(agrupar(null), []);
  assert.equal(juntarCatalogos(null, null).length, 0);
  assert.equal(juntarCatalogos(catalogoBase(), null).length, PECAS_BASE.length);
});

console.log('\n' + passou + ' testes passaram\n');

/**
 * A PONTE PARA MODELOS `.glb` — `node web/js/modelos.test.mjs`
 *
 * O boneco do Mundo é montado de cápsulas escritas em código. Este módulo é o
 * caminho para trocá-las por arte modelada **uma peça de cada vez**, e o que
 * ele guarda são as três coisas que erram caladas:
 *
 *  - **faltar arquivo é NORMAL.** Hoje não existe `.glb` nenhum e o Mundo
 *    funciona; amanhã existirá um cabelo e só ele será modelado. Se a falta
 *    virasse erro, o Mundo não abriria — e "o Mundo não abre" é o pior desfecho
 *    possível. Mas o avesso é igualmente calado: um nome errado no manifesto,
 *    um arquivo no lugar errado e um GLB recusado dão exatamente a mesma tela
 *    de "ainda não modelei essa peça". Por isso tudo o que falha é CONTADO;
 *
 *  - **a matriz de mundo.** O exportador aninha nós, e ler a geometria sem
 *    aplicar a matriz empilha todas as partes na origem. O boneco monta, não
 *    reclama, e as peças ficam dentro do peito;
 *
 *  - **a junta.** Uma jaqueta cobre tronco e braços; uma malha só, pendurada no
 *    tronco, fica rígida enquanto o braço anda por dentro dela. O `.glb` diz a
 *    junta pelo NOME do nó, e um nome que ninguém reconhece cai na junta padrão
 *    do slot sem avisar.
 *
 * O GLB de teste é MONTADO AQUI, byte a byte. Não é preciosismo: um arquivo
 * commitado seria um binário sem fonte no repositório de um projeto cuja regra
 * é arte gerada em código — e, pior, um teste que depende de um arquivo que
 * ninguém sabe regenerar.
 */
import assert from 'node:assert/strict';

/**
 * `self` é global do NAVEGADOR, e o `GLTFLoader` vendorizado toca nele para
 * montar textura (`self.URL.createObjectURL`). Em Node ele não existe, e a
 * exceção sobe de dentro do loader como uma falha do MODELO — a mensagem que
 * chega em `estadoDosModelos().falhas` é um `self is not defined` que não diz
 * nada sobre o arquivo.
 *
 * Isto é acomodação de AMBIENTE, não conserto de defeito: no navegador o objeto
 * existe e o caminho funciona. Sem o remendo, todo modelo com textura externa
 * "falha" aqui e passa no jogo — o pior tipo de teste, o que reprova o que
 * funciona.
 */
globalThis.self ??= globalThis;
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/three.module.min.js';
import {
  PASTA, MANIFESTO, JUNTAS, JUNTA_PADRAO, PARTES_DO_CORPO, CORPO_INTEIRO,
  ANCORAS, ALTURA_BONECO, prepararModelos, geometriaDe, materialDe,
  temCorpoModelado, estadoDosModelos, chavesConhecidas, repartirPorJunta,
} from './modelos.js';
import { SLOTS, PECAS } from './aparencia.js';
import { criarBoneco } from './boneco3d.js';
// O GLTFLoader toca em `self` ao resolver textura, e em Node ele não existe.
// Sem este shim, todo `.glb` COM textura falha aqui e passaria por "arquivo
// corrompido" — no navegador `self` existe e nada disso acontece.
globalThis.self ??= globalThis;


let pass = 0, fail = 0;
const t = async (nome, fn) => {
  try { await fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

// ------------------------------------------------------ um GLB de mentira
/**
 * Monta um `.glb` de verdade (container binário glTF 2.0) com um triângulo por
 * nó. `nos` é `[{ nome, deslocamento }]` — o nome vira o nome do nó, e o
 * deslocamento entra como TRANSLAÇÃO do nó, que é o que prova a leitura da
 * matriz de mundo.
 */
function glbDeTeste(nos) {
  const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bin = Buffer.from(tri.buffer);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: nos.map((_, i) => i) }],
    nodes: nos.map((n) => ({
      mesh: 0,
      name: n.nome,
      ...(n.deslocamento ? { translation: n.deslocamento } : {}),
    })),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    buffers: [{ byteLength: bin.length }],
  };

  const j = Buffer.from(JSON.stringify(json));
  const jp = (4 - j.length % 4) % 4;
  const bp = (4 - bin.length % 4) % 4;
  const total = 12 + 8 + j.length + jp + 8 + bin.length + bp;
  const glb = Buffer.alloc(total);
  let o = 0;
  glb.write('glTF', o); o += 4;
  glb.writeUInt32LE(2, o); o += 4;
  glb.writeUInt32LE(total, o); o += 4;
  glb.writeUInt32LE(j.length + jp, o); o += 4;
  glb.write('JSON', o); o += 4;
  j.copy(glb, o); o += j.length;
  glb.fill(0x20, o, o + jp); o += jp;
  glb.writeUInt32LE(bin.length + bp, o); o += 4;
  glb.write('BIN\0', o); o += 4;
  bin.copy(glb, o);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length);
}

/** Um `fetch` de mentira: `arquivos` é `{ caminho: conteudo }`. */
function buscadorDe(arquivos) {
  return async (url) => {
    const chave = String(url).replace(`${PASTA}/`, '');
    if (!(chave in arquivos)) return { ok: false, status: 404 };
    const v = arquivos[chave];
    return {
      ok: true,
      status: 200,
      json: async () => (typeof v === 'string' ? JSON.parse(v) : v),
      arrayBuffer: async () => v,
    };
  };
}

console.log('\n  ---- faltar arquivo é normal ----\n');

/**
 * O estado de HOJE: nenhuma arte no projeto. Ele tem de ser silencioso — nem
 * falha, nem barulho —, senão o console do jogador nasce vermelho e um erro de
 * verdade deixa de ser notado.
 */
await t('sem manifesto, tudo é procedural e nada é reclamado', async () => {
  const e = await prepararModelos({ buscar: buscadorDe({}) });
  assert.equal(e.manifesto, false);
  assert.equal(e.pedidos, 0);
  assert.deepEqual(e.falhas, [], '404 no manifesto virou falha — o boot nasceria gritando');
  assert.deepEqual(e.carregadas, []);
  assert.equal(geometriaDe('cabelo-moicano'), null);
});

await t('o boneco monta inteiro sem modelo nenhum (o par CONTROLE)', async () => {
  await prepararModelos({ buscar: buscadorDe({}) });
  const b = criarBoneco({ id: 'x' });
  let malhas = 0;
  b.grupo.traverse((o) => { if (o.isMesh) malhas++; });
  assert.ok(malhas >= 15, `o boneco procedural saiu com ${malhas} malhas`);
  b.descartar();
});

await t('rede caída no manifesto não derruba a tela', async () => {
  const e = await prepararModelos({ buscar: async () => { throw new Error('sem rede'); } });
  assert.equal(e.manifesto, false);
  assert.deepEqual(e.carregadas, []);
});

console.log('\n  ---- o modelo vence a cápsula ----\n');

await t('um .glb no manifesto substitui a peça, e só ela', async () => {
  const e = await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: { 'cabelo-moicano': 'pecas/moicano.glb' },
      'pecas/moicano.glb': glbDeTeste([{ nome: 'malha' }]),
    }),
  });
  assert.equal(e.ok, 1, `carregou ${e.ok} de ${e.pedidos}: ${JSON.stringify(e.falhas)}`);
  assert.deepEqual(e.falhas, []);

  // Sem nó nomeado, vai para a junta padrão do slot — cabelo é `cabeca`.
  const g = geometriaDe('cabelo-moicano');
  assert.deepEqual(Object.keys(g), JUNTA_PADRAO.cabelo);

  // E as OUTRAS peças continuam procedurais: a troca é uma de cada vez.
  assert.equal(geometriaDe('cabelo-curto'), null, 'carregar uma peça mexeu nas outras');
});

await t('a junta sai do NOME do nó, e várias juntas num arquivo só', async () => {
  await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: { 'roupa-jaqueta': 'j.glb' },
      'j.glb': glbDeTeste([
        { nome: 'tronco' }, { nome: 'bracoE' }, { nome: 'bracoD' },
      ]),
    }),
  });
  const g = geometriaDe('roupa-jaqueta');
  assert.deepEqual(Object.keys(g).sort(), ['bracoD', 'bracoE', 'tronco'],
    'a jaqueta não se repartiu — uma malha só no tronco fica rígida com o braço andando por dentro');
});

/**
 * A matriz de MUNDO. O exportador aninha nós e põe a translação neles; ler só a
 * geometria empilha todas as partes na origem. O boneco monta, não reclama, e
 * as peças ficam dentro do peito.
 */
await t('a translação do nó é aplicada na geometria', async () => {
  await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: { 'cabelo-longo': 'c.glb' },
      'c.glb': glbDeTeste([{ nome: 'malha', deslocamento: [0, 5, 0] }]),
    }),
  });
  const g = geometriaDe('cabelo-longo', 'cabeca');
  g.computeBoundingBox();
  assert.ok(g.boundingBox.min.y >= 4.9,
    `a geometria ficou em y=${g.boundingBox.min.y} — a matriz do nó foi ignorada`);
});

await t('duas juntas padrão recebem cópias, e não o mesmo buffer', async () => {
  await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: { 'sapato-bota': 'b.glb' },
      'b.glb': glbDeTeste([{ nome: 'malha' }]),
    }),
  });
  const g = geometriaDe('sapato-bota');
  assert.deepEqual(Object.keys(g).sort(), ['pernaD', 'pernaE'], 'o calçado não foi para as duas pernas');
  assert.notEqual(g.pernaE, g.pernaD,
    'as duas pernas dividem a MESMA geometria — mexer numa estraga a outra');
});

await t('o modelo chega ao boneco montado', async () => {
  await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: { 'cabelo-moicano': 'm.glb' },
      'm.glb': glbDeTeste([{ nome: 'malha', deslocamento: [0, 9, 0] }]),
    }),
  });
  const b = criarBoneco({ id: 'x', aparencia: { cabelo: { peca: 'cabelo-moicano', cor: '#aabbcc' } } });
  b.grupo.updateMatrixWorld(true);
  const caixa = new THREE.Box3().setFromObject(b.grupo);
  assert.ok(caixa.max.y > 9, `o modelo não chegou ao boneco (topo ${caixa.max.y.toFixed(2)})`);

  // CONTROLE: a mesma peça sem modelo volta a ser a cápsula, do tamanho de gente.
  await prepararModelos({ buscar: buscadorDe({}) });
  const c = criarBoneco({ id: 'x', aparencia: { cabelo: { peca: 'cabelo-moicano', cor: '#aabbcc' } } });
  c.grupo.updateMatrixWorld(true);
  assert.ok(new THREE.Box3().setFromObject(c.grupo).max.y < 2, 'apagar o modelo não devolveu a cápsula');
  b.descartar(); c.descartar();
});

console.log('\n  ---- o que falhou tem de ser CONTADO ----\n');

/**
 * Estes quatro dariam, na tela, exatamente a mesma coisa que "ainda não modelei
 * essa peça". É a única maneira de distingui-los.
 */
await t('erro de digitação no manifesto é recusado e reportado', async () => {
  const e = await prepararModelos({
    buscar: buscadorDe({ [MANIFESTO]: { 'cabelo-moicanoo': 'x.glb' } }),
  });
  assert.equal(e.ok, 0);
  assert.equal(e.falhas.length, 1, 'a chave inexistente passou batida');
  assert.equal(e.falhas[0].chave, 'cabelo-moicanoo');
});

await t('arquivo que não está lá vira falha, e não silêncio', async () => {
  const e = await prepararModelos({
    buscar: buscadorDe({ [MANIFESTO]: { 'cabelo-curto': 'nao/existe.glb' } }),
  });
  assert.equal(e.ok, 0);
  assert.equal(e.falhas.length, 1);
  assert.match(e.falhas[0].porque, /404/);
});

await t('GLB corrompido vira falha, e o resto do manifesto continua', async () => {
  const e = await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: { 'cabelo-curto': 'ruim.glb', 'cabelo-longo': 'bom.glb' },
      'ruim.glb': new Uint8Array([1, 2, 3, 4]).buffer,
      'bom.glb': glbDeTeste([{ nome: 'malha' }]),
    }),
  });
  assert.equal(e.falhas.length, 1, 'o arquivo corrompido passou');
  assert.equal(e.ok, 1, 'um arquivo ruim derrubou o bom junto');
  assert.ok(geometriaDe('cabelo-longo'), 'o modelo bom não entrou');
});

await t('manifesto que não é objeto é recusado', async () => {
  for (const torto of [[], 'texto', 42, null]) {
    const e = await prepararModelos({ buscar: buscadorDe({ [MANIFESTO]: torto }) });
    assert.equal(e.ok, 0, `passou: ${JSON.stringify(torto)}`);
  }
});

console.log('\n  ---- o contrato com quem modela ----\n');

/**
 * As juntas deste módulo têm de ser as MESMAS que o `boneco3d` cria. Um nome a
 * mais aqui é uma parte que some (a junta não existe do outro lado); um a menos
 * é uma parte que cai na junta padrão sem ninguém entender por quê.
 */
await t('as juntas daqui existem no boneco', async () => {
  const src = readFileSync(new URL('boneco3d.js', import.meta.url), 'utf8');
  // As juntas nascem de três jeitos no `boneco3d`, e varrer só dois faz esta
  // asserção acusar à toa — que é como uma varredura deixa de ser lida.
  const noBoneco = new Set([
    ...[...src.matchAll(/membro\('(\w+)'/g)].map((m) => m[1]),          // membro('bracoE', …)
    ...[...src.matchAll(/juntas\.(\w+) =/g)].map((m) => m[1]),          // juntas.tronco = …
    ...[...src.matchAll(/juntas = \{\s*(\w+):/g)].map((m) => m[1]),     // const juntas = { raiz: … }
  ]);
  for (const j of JUNTAS) {
    assert.ok(noBoneco.has(j), `a junta "${j}" não existe em boneco3d.js — a peça sumiria`);
  }
});

await t('toda chave conhecida é uma peça do catálogo ou uma parte do corpo', () => {
  const chaves = chavesConhecidas();
  const doCatalogo = SLOTS.flatMap((s) => PECAS[s].map((p) => p.id));
  for (const c of doCatalogo) assert.ok(chaves.includes(c), `a peça "${c}" não pode ser modelada`);
  for (const c of Object.keys(PARTES_DO_CORPO)) assert.ok(chaves.includes(c));
  // E todo slot tem junta padrão: sem ela, um `.glb` sem nó nomeado não teria
  // para onde ir e a peça sumiria.
  for (const s of SLOTS) assert.ok(JUNTA_PADRAO[s]?.length, `o slot "${s}" não tem junta padrão`);
});

await t('o README do contrato existe e é linkado pelo módulo', () => {
  const readme = readFileSync(new URL('../modelos/README.md', import.meta.url), 'utf8');
  // Quem larga arquivos na pasta precisa achar a escala e a origem ali: um
  // `.glb` na escala errada aparece gigante ou enterrado, e nada acusa.
  for (const precisa of ['modelos.json', '1,72', 'y = 0', '+Z', 'CC0']) {
    assert.ok(readme.includes(precisa), `o README não fala de "${precisa}"`);
  }
  const js = readFileSync(new URL('mundo3d.js', import.meta.url), 'utf8');
  assert.ok(/prepararModelos\(/.test(js), 'o Mundo não carrega os modelos no boot');
});

console.log('\n  ---- o loader vendorizado ----\n');

await t('o GLTFLoader carrega contra o three vendorizado, sem bare specifier', () => {
  const base = new URL('../vendor/three/addons/', import.meta.url);
  for (const f of ['GLTFLoader.js', 'BufferGeometryUtils.js', 'SkeletonUtils.js']) {
    const src = readFileSync(new URL(f, base), 'utf8');
    // `from 'three'` é um bare specifier: o navegador não o resolve sem import
    // map, e um `import` que falha mata o `<script type="module">` INTEIRO, em
    // silêncio. É o mesmo estrago dos dez órfãos de 24/08/2026.
    const bare = [...src.matchAll(/^\s*(?:\}|import[^;]*) from '(three[^']*)'/gm)];
    assert.deepEqual(bare.map((m) => m[1]), [], `${f} ainda importa de um bare specifier`);
  }
});

console.log('\n  ---- o personagem inteiro ----\n');

/**
 * **A normalização.** Um pacote vem na unidade de quem o fez — o Kenney em
 * ~2,5 e com a origem no meio do corpo. Entrar cru dá um personagem de 4,27 m
 * com os pés a 80 cm do chão (foi o que aconteceu na primeira tentativa), e o
 * mundo inteiro passa a mentir junto: a câmera enquadra errado, a etiqueta de
 * nome flutua longe da cabeça, e a altura do chão põe os pés no lugar errado.
 */
await t('um personagem importado entra com 1,72 m e os pés no chão', async () => {
  // Um "personagem" de 10 unidades, com a origem no meio: o pior caso comum.
  const gigante = glbDeTeste([
    { nome: 'head', deslocamento: [0, 5, 0] },
    { nome: 'torso', deslocamento: [0, 0, 0] },
    { nome: 'leg-left', deslocamento: [0, -5, 0] },
  ]);
  await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: {
        [CORPO_INTEIRO]: { arquivo: 'p.glb', juntas: {
          head: 'cabeca', torso: 'tronco', 'leg-left': 'pernaE',
        } },
      },
      'p.glb': gigante,
    }),
  });

  assert.ok(temCorpoModelado(), `o personagem nao carregou: ${JSON.stringify(estadoDosModelos().falhas)}`);

  const b = criarBoneco({ id: 'x' });
  b.grupo.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(b.grupo);
  assert.ok(Math.abs(c.max.y - ALTURA_BONECO) < 0.02,
    `entrou com ${c.max.y.toFixed(2)} m em vez de ${ALTURA_BONECO}`);
  assert.ok(Math.abs(c.min.y) < 0.02, `os pés ficaram em y=${c.min.y.toFixed(3)}`);
  b.descartar();
});

/**
 * **A âncora descontada.** A parte já vem no lugar certo dentro do arquivo;
 * pendurá-la na junta somaria a posição duas vezes. Sem o desconto, a cabeça
 * sobe 1,565 m acima de onde deveria — e o boneco monta, sem reclamar.
 */
await t('a âncora da junta é descontada, e o passo continua movendo o membro', async () => {
  await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: { [CORPO_INTEIRO]: { arquivo: 'p.glb', juntas: { head: 'cabeca' } } },
      'p.glb': glbDeTeste([{ nome: 'head' }]),
    }),
  });
  const g = geometriaDe(CORPO_INTEIRO, 'cabeca');
  g.computeBoundingBox();
  // Depois de normalizar, a peça ocupa o boneco todo; a âncora da cabeça
  // (1,565) sai, então a caixa fica em torno de zero e não lá em cima.
  assert.ok(g.boundingBox.min.y < 0,
    `a âncora nao foi descontada (min.y=${g.boundingBox.min.y.toFixed(2)}) — a posicao entra duas vezes`);

  const b = criarBoneco({ id: 'x' });
  b.andar(0.5, true);
  const girou = [];
  b.grupo.traverse((o) => { if (o.isGroup && o !== b.grupo) girou.push(o.rotation.x); });
  assert.ok(girou.some((r) => Math.abs(r) > 0.05),
    'o passo parou de mover as juntas com um modelo importado');
  b.descartar();
});

/**
 * As âncoras têm de ser AS MESMAS dos dois lados: `modelos.js` desconta
 * exatamente o que `boneco3d.js` soma. Duas listas dariam um boneco remendado
 * — cada parte deslocada pela diferença —, e nada acusaria.
 */
await t('boneco3d usa as âncoras deste módulo, e não cópias', () => {
  const src = readFileSync(new URL('boneco3d.js', import.meta.url), 'utf8');
  assert.ok(/ANCORAS/.test(src), 'boneco3d voltou a ter as posicoes escritas a mao');
  for (const j of Object.keys(ANCORAS)) {
    assert.equal(ANCORAS[j].length, 3, `a ancora "${j}" nao e um ponto`);
  }
  assert.ok(/ALTURA = ALTURA_BONECO/.test(src),
    'a altura do boneco voltou a ser um numero proprio — o modelo seria normalizado para outra');
});

/**
 * **O material do arquivo sobrevive no personagem, e morre na peça.** São as
 * duas leis do cabeçalho: um cabelo serve para doze cores (tinge-se), mas um
 * personagem pronto tem o visual NA TEXTURA — descartá-la deixa um vulto
 * branco, que é exatamente como o Kenney chegaria aqui.
 */
await t('o personagem guarda o material do arquivo; a peça, não', async () => {
  await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: {
        [CORPO_INTEIRO]: { arquivo: 'p.glb', juntas: { torso: 'tronco' } },
        'cabelo-moicano': 'c.glb',
      },
      'p.glb': glbDeTeste([{ nome: 'torso' }]),
      'c.glb': glbDeTeste([{ nome: 'malha' }]),
    }),
  });
  assert.ok(materialDe(CORPO_INTEIRO, 'tronco'), 'o material do personagem foi jogado fora');
});

/**
 * O material do arquivo é COMPARTILHADO entre todos os bonecos (vem do cache).
 * Descartá-lo com o corpo de quem sai apagaria a textura do PRÓXIMO, muito
 * depois — é o mesmo defeito que o cache de geometria já evita.
 */
await t('descartar um boneco não come o material do arquivo', async () => {
  await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: { [CORPO_INTEIRO]: { arquivo: 'p.glb', juntas: { torso: 'tronco' } } },
      'p.glb': glbDeTeste([{ nome: 'torso' }]),
    }),
  });
  const m = materialDe(CORPO_INTEIRO, 'tronco');
  let descartado = false;
  m.addEventListener?.('dispose', () => { descartado = true; });

  const a = criarBoneco({ id: 'a' });
  a.descartar();
  assert.equal(descartado, false, 'o material compartilhado foi descartado com um boneco');

  // CONTROLE: o boneco seguinte ainda monta com ele.
  const b = criarBoneco({ id: 'b' });
  let comMaterial = 0;
  b.grupo.traverse((o) => { if (o.isMesh && o.material === m) comMaterial++; });
  assert.ok(comMaterial > 0, 'o proximo boneco perdeu o material do arquivo');
  b.descartar();
});

/**
 * **A roupa cede ao personagem pronto.** As peças são cápsulas pensadas para o
 * corpo de cápsulas; empilhá-las sobre um modelo texturizado seria uma segunda
 * roupa por cima da primeira, com a proporção errada.
 *
 * É um ESTADO conhecido: o pacote de hoje traz um corpo e dezoito pinturas, não
 * peças. Quando houver `.glb` por peça, a condição sai.
 */
await t('com personagem pronto, a peça procedural não é empilhada por cima', async () => {
  await prepararModelos({
    buscar: buscadorDe({
      [MANIFESTO]: { [CORPO_INTEIRO]: { arquivo: 'p.glb', juntas: { torso: 'tronco' } } },
      'p.glb': glbDeTeste([{ nome: 'torso' }]),
    }),
  });
  const comModelo = criarBoneco({ id: 'x', aparencia: { cabelo: { peca: 'cabelo-moicano', cor: '#f00' } } });
  let n = 0; comModelo.grupo.traverse((o) => { if (o.isMesh) n++; });

  // CONTROLE: sem personagem pronto, a MESMA aparência põe as peças de volta.
  await prepararModelos({ buscar: buscadorDe({}) });
  const semModelo = criarBoneco({ id: 'x', aparencia: { cabelo: { peca: 'cabelo-moicano', cor: '#f00' } } });
  let m = 0; semModelo.grupo.traverse((o) => { if (o.isMesh) m++; });

  assert.ok(n < m, `o personagem pronto ficou com ${n} malhas e o procedural com ${m} — a roupa foi empilhada`);
  comModelo.descartar(); semModelo.descartar();
});

console.log('\n  ---- o que está no repositório ----\n');

/**
 * O teste que prova que **o arquivo no disco funciona** — o manifesto de
 * verdade, o `.glb` de verdade, pelo mesmo caminho que o navegador fará.
 *
 * Sem ele, tudo acima prova só que a máquina funciona com arquivos de mentira,
 * e um erro de caminho no manifesto real passaria como "ainda não modelei".
 */
await t('o manifesto do repositório carrega, na escala e com material', async () => {
  const daPasta = async (url) => {
    const p = 'web' + String(url).replace(/^\/web/, '');
    try {
      const b = readFileSync(new URL(`../../${p}`, import.meta.url));
      return {
        ok: true, status: 200,
        json: async () => JSON.parse(b.toString('utf8')),
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length),
      };
    } catch { return { ok: false, status: 404 }; }
  };

  const e = await prepararModelos({ buscar: daPasta });
  assert.deepEqual(e.falhas, [], 'o manifesto do repositorio tem entrada quebrada');
  assert.ok(e.ok > 0, 'o manifesto do repositorio nao carregou nada');

  const b = criarBoneco({ id: 'x' });
  b.grupo.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(b.grupo);
  assert.ok(Math.abs(c.max.y - ALTURA_BONECO) < 0.03, `altura ${c.max.y.toFixed(2)} m`);
  assert.ok(Math.abs(c.min.y) < 0.02, `pes em y=${c.min.y.toFixed(3)}`);
  b.descartar();
});

/**
 * **A textura mora ao lado do `.glb`, e o caminho tem de sair da PASTA dele.**
 * Com a raiz de `web/modelos`, a textura dá 404, o modelo carrega assim mesmo e
 * o personagem aparece BRANCO — sem erro que aponte para o caminho. É o defeito
 * mais provável desta feature, e o menos denunciado.
 */
await t('a textura referenciada pelo .glb existe no lugar em que ele a procura', () => {
  const manifesto = JSON.parse(readFileSync(new URL('../modelos/modelos.json', import.meta.url), 'utf8'));
  const entrada = manifesto[CORPO_INTEIRO];
  const caminho = typeof entrada === 'string' ? entrada : entrada?.arquivo;
  assert.ok(caminho, 'o manifesto do repositorio nao traz o personagem');

  const glb = readFileSync(new URL(`../modelos/${caminho}`, import.meta.url));
  // O nome do arquivo de textura está no JSON do GLB, em texto claro.
  const refs = [...glb.toString('latin1').matchAll(/"uri":"([^"]+\.(?:png|jpg|jpeg))"/g)].map((m) => m[1]);
  const pasta = caminho.replace(/[^/]+$/, '');
  for (const ref of refs) {
    const onde = new URL(`../modelos/${pasta}${decodeURIComponent(ref)}`, import.meta.url);
    let existe = true;
    try { readFileSync(onde); } catch { existe = false; }
    assert.ok(existe, `o .glb procura "${ref}" ao lado dele e o arquivo nao esta la — o personagem sairia BRANCO`);
  }
});

await t('a licenca do pacote viaja junto com a arte', () => {
  const lic = readFileSync(new URL('../modelos/kenney/LICENSE.txt', import.meta.url), 'utf8');
  assert.match(lic, /CC0|Creative Commons Zero/i,
    'a arte no repositorio precisa da licenca ao lado: ela viaja dentro do game.zip');
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

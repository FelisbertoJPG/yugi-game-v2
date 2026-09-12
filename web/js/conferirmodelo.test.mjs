/**
 * Testes de `conferirmodelo.js` — "este `.glb` serve para o nosso boneco?".
 *
 * A regra tem DOIS leitores (o CLI `tools/conferir-modelos.mjs` e a Bancada de
 * Modelos, `web/modelos.html`), e é por isso que ela mora num módulo puro com
 * teste: duas cópias divergiriam caladas, e o CLI aprovaria o que a bancada
 * recusa sem ninguém saber qual está certo.
 *
 * O caso que originou tudo: **quase todo pacote de personagem grátis é rigado**.
 * Um `.glb` com esqueleto carrega, aparece e fica parado numa pose de T
 * enquanto o boneco anda — sem um erro sequer no console.
 *
 *   node web/js/conferirmodelo.test.mjs
 */
import assert from 'node:assert';
import {
  lerCabecalhoGlb, resumoDoGltf, conferir, juntasReconhecidas,
  trechoDoManifesto, JUNTAS, APELIDOS, ALTURA_BONECO,
} from './conferirmodelo.js';

let passou = 0;
const teste = (nome, fn) => {
  try { fn(); passou++; console.log('  ok  ' + nome); }
  catch (e) { console.error('  FALHOU  ' + nome + '\n      ' + e.message); process.exitCode = 1; }
};

console.log('\nconferir um modelo de personagem\n');

// ------------------------------------------------------------ o binário
/** Monta um `.glb` de mentira, com o JSON que se quiser. */
function glb(objeto) {
  const json = Buffer.from(JSON.stringify(objeto), 'utf8');
  const pad = (4 - (json.length % 4)) % 4;
  const corpo = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
  const b = Buffer.alloc(12 + 8 + corpo.length);
  b.writeUInt32LE(0x46546c67, 0);        // "glTF"
  b.writeUInt32LE(2, 4);
  b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(corpo.length, 12);
  b.writeUInt32LE(0x4e4f534a, 16);       // "JSON"
  corpo.copy(b, 20);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/** Um personagem plausível: nós nomeados como o Kenney, uma malha, uma textura. */
const kenney = (extra = {}) => ({
  nodes: [{ name: 'root' }, { name: 'torso' }, { name: 'head' },
          { name: 'arm-left' }, { name: 'arm-right' },
          { name: 'leg-left' }, { name: 'leg-right' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  accessors: [{ count: 24, min: [-0.5, 0, -0.5], max: [0.5, 9, 0.5] }, { count: 216 }],
  materials: [{}],
  images: [{ uri: 'Textures/texture-a.png' }],
  ...extra,
});

teste('le o cabecalho de um .glb de verdade', () => {
  const g = lerCabecalhoGlb(glb({ asset: { version: '2.0' }, nodes: [{ name: 'x' }] }));
  assert.equal(g.nodes[0].name, 'x');
});

teste('arquivo que NAO e .glb da uma frase legivel, nao um RangeError', () => {
  // quem arrastou um .fbx para a bancada precisa ler o que houve
  const fbx = Buffer.from('Kaydara FBX Binary\0');
  assert.throws(
    () => lerCabecalhoGlb(fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength)),
    /nao e um \.glb/,
  );
  assert.throws(() => lerCabecalhoGlb(new ArrayBuffer(4)), /nao e um \.glb/);
});

teste('.gltf SOLTO tambem e lido — e como o Sketchfab entrega por padrao', () => {
  // recusa-lo pela assinatura mandaria converter o arquivo so' para descobrir o
  // que ele e', quando o JSON ja' esta ali, legivel e com tudo o que se pergunta
  const texto = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, nodes: [{ name: 'root' }] }), 'utf8');
  const g = lerCabecalhoGlb(texto.buffer.slice(texto.byteOffset, texto.byteOffset + texto.byteLength));
  assert.equal(g.nodes[0].name, 'root');
});

teste('JSON quebrado da a frase certa, e nao "nao e um glb"', () => {
  const ruim = Buffer.from('{ "nodes": [', 'utf8');
  assert.throws(
    () => lerCabecalhoGlb(ruim.buffer.slice(ruim.byteOffset, ruim.byteOffset + ruim.byteLength)),
    /JSON esta quebrado/,
  );
});

teste('o .vroid e reconhecido como PROJETO, e a frase diz o passo que falta', () => {
  // e' a confusao mais provavel de quem acabou de criar um personagem: o
  // arquivo que o VRoid salva sozinho NAO e' o que se exporta. "nao e um .glb"
  // mandaria procurar o defeito no lugar errado
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.throws(
    () => lerCabecalhoGlb(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)),
    /PROJETO.*Exportar -> VRM/s,
  );
});

// ------------------------------------------------------------ o veredito
teste('ESQUELETO nao reprova mais — o corpo e repartido pela POSICAO', () => {
  // Ate 07/09/2026 isto era 'nao': boneco3d.js pendura malha RIGIDA nas juntas,
  // e um modelo rigado entrava parado numa pose de T. Como quase todo
  // personagem gratis vem rigado, a regra reprovava o mundo inteiro.
  //
  // `repartir.js` mudou o caso, e este teste mudou JUNTO: regra que contradiz o
  // codigo e' pior que regra nenhuma — ela reprova o que funciona, e quem a le
  // vai procurar outro pacote. Medido num VRM do VRoid: 1,720 m, pes em y=0,
  // e anda.
  const r = conferir('x.glb', kenney({ skins: [{}, {}] }));
  assert.equal(r.veredito, 'serve');
  assert.ok(r.notas.some(([n, t]) => n === 'ok' && /NAO reprova mais/.test(t)));
});

teste('malha rigida com nos de junta SERVE (e o pacote que ja esta no projeto)', () => {
  const r = conferir('character-a.glb', kenney());
  assert.equal(r.veredito, 'serve');
  assert.equal(r.resumo.skins, 0);
  assert.equal(r.resumo.tri, 72, '216 indices sao 72 triangulos');
});

teste('CORPO sem no de junta SERVE — ele e repartido por posicao', () => {
  // e' o caminho NORMAL de um modelo baixado: o Sketchfab renomeia tudo para
  // `Object_17` na conversao, e o VRoid nao usa os nossos nomes
  const r = conferir('x.glb', kenney({ nodes: [{ name: 'Cube.001' }] }));
  assert.equal(r.veredito, 'serve');
  assert.ok(r.notas.some(([, t]) => /repartido pela POSICAO/.test(t)));
});

teste('PECA sem no de junta esta CERTA (cabelo e sapato sao assim)', () => {
  const cru = { ...kenney(), nodes: [{ name: 'Hair' }] };
  cru.accessors = [{ count: 24, min: [-0.1, 1.4, -0.1], max: [0.1, 1.62, 0.1] }, { count: 216 }];
  assert.equal(conferir('cabelo.glb', cru, { comoPeca: true }).veredito, 'serve');
});

teste('PECA fora de escala pede ajuste — ela NAO e reescalada pelo jogo', () => {
  // 9 unidades de altura numa peca a poe gigante na tela; so' o CORPO e' medido
  // e normalizado, e confundir as duas leis e' o §5 do README inteiro
  assert.equal(conferir('cabelo.glb', kenney(), { comoPeca: true }).veredito, 'ajusta');
  assert.equal(conferir('corpo.glb', kenney()).veredito, 'serve', 'o corpo aceita qualquer unidade');
});

teste('o CORPO em qualquer unidade passa — ele e medido e normalizado', () => {
  for (const alto of [0.67, 2.5, 9, 172]) {
    const cru = kenney();
    cru.accessors = [{ count: 24, min: [0, 0, 0], max: [1, alto, 1] }, { count: 216 }];
    assert.equal(conferir('c.glb', cru).veredito, 'serve', 'reprovou com altura ' + alto);
  }
});

teste('a textura EXTERNA e reportada — faltando, o personagem entra BRANCO', () => {
  const r = conferir('x.glb', kenney());
  assert.ok(r.notas.some(([, t]) => /Textures\/texture-a\.png/.test(t)));
});

teste('textura EMBUTIDA (data:) nao e cobrada como arquivo a parte', () => {
  // ela viaja dentro do .glb; cobrar um arquivo que nao existe mandaria a
  // pessoa procurar um png que ninguem precisa
  const r = conferir('x.glb', kenney({ images: [{ uri: 'data:image/png;base64,AAAA' }] }));
  assert.equal(r.resumo.externas.length, 0);
  assert.equal(r.resumo.embutidas, 1);
});

teste('sem min/max nos acessores, AVISA em vez de dizer 0 m', () => {
  // dizer "0 metros" seria INVENTAR um numero, e a pessoa reexportaria a toa
  const cru = kenney();
  cru.accessors = [{ count: 24 }, { count: 216 }];
  const r = conferir('x.glb', cru);
  assert.equal(r.resumo.caixa, null);
  assert.ok(r.notas.some(([n, t]) => n === '!' && /nao da para medir/.test(t)));
});

teste('glTF vazio nao derruba a conferencia', () => {
  for (const cru of [{}, { meshes: [] }, { nodes: [] }, { meshes: [{}] }]) {
    const r = conferir('x.glb', cru);
    assert.ok(['serve', 'ajusta', 'nao'].includes(r.veredito), 'quebrou em ' + JSON.stringify(cru));
  }
});

teste('VRM e reconhecido COMO VRM, e serve', () => {
  const r = conferir('goth.vrm', kenney({ skins: [{}], extensions: { VRM: { exporterVersion: 'x' } } }));
  assert.equal(r.resumo.vrm, true);
  assert.equal(r.veredito, 'serve');
});

teste('a PECA continua exigindo escala — so o CORPO e normalizado', () => {
  // par CONTROLE do afrouxamento acima: se `conferir` passasse a devolver
  // 'serve' para tudo, os testes do esqueleto e do no ficariam verdes sem
  // provar nada. Este e' o caso que TEM de continuar reprovando.
  assert.equal(conferir('cabelo.glb', kenney(), { comoPeca: true }).veredito, 'ajusta');
});

teste('glb comum NAO e marcado como VRM', () => {
  assert.equal(conferir('x.glb', kenney()).resumo.vrm, false);
});

// ------------------------------------------------------------- as juntas
teste('os apelidos do Kenney viram as juntas do projeto', () => {
  const pares = juntasReconhecidas(['root', 'head', 'arm-left', 'Cube', 'leg-right']);
  assert.deepEqual(pares.map((p) => p.junta), ['raiz', 'cabeca', 'bracoE', 'pernaD']);
});

teste('o nome que JA e uma junta nossa passa direto', () => {
  assert.deepEqual(juntasReconhecidas(JUNTAS).map((p) => p.junta), JUNTAS);
});

teste('todo apelido aponta para uma junta que EXISTE', () => {
  // um apelido para uma junta inventada nao daria erro: a peca simplesmente
  // nao apareceria, e pareceria arquivo ruim
  for (const [no, junta] of Object.entries(APELIDOS)) {
    assert.ok(JUNTAS.includes(junta), `${no} -> "${junta}" nao e uma junta`);
  }
});

teste('o trecho de manifesto sai PRONTO para copiar', () => {
  // digitar seis pares `no: junta` a mao erra calado: um erro de digitacao nao
  // da erro nenhum, o braco so' nao mexe
  const t = trechoDoManifesto('pacote/heroi.glb', ['root', 'head', 'torso', 'arm-left']);
  assert.equal(t.corpo.arquivo, 'pacote/heroi.glb');
  assert.deepEqual(t.corpo.juntas, { head: 'cabeca', torso: 'tronco', 'arm-left': 'bracoE' });
  assert.ok(!('root' in t.corpo.juntas), 'root ja E raiz: apelido redundante so polui o manifesto');
});

teste('sem junta nenhuma, o manifesto e so o caminho', () => {
  assert.deepEqual(trechoDoManifesto('p/x.glb', ['Cube']), { corpo: 'p/x.glb' });
});

teste('a altura de referencia e a MESMA de modelos.js', async () => {
  // duas alturas fariam a bancada aprovar um tamanho que o jogo nao usa
  const m = await import('./modelos.js').catch(() => null);
  if (m) assert.equal(ALTURA_BONECO, m.ALTURA_BONECO);
});

console.log('\n' + passou + ' testes passaram\n');

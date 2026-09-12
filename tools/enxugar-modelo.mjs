/**
 * **Tira de um `.glb`/`.vrm` o que o jogo joga fora ao carregar.**
 *
 *     node tools/enxugar-modelo.mjs <modelo.vrm> [saida.glb]
 *
 * Um VRM do VRoid carrega dezenas de **expressões faciais** (piscar, sorrir, as
 * vogais da boca) como *morph targets*: uma cópia das posições da malha por
 * expressão. Num personagem medido aqui elas eram **5,4 MB de 16,6** — um terço
 * do arquivo.
 *
 * E `modelos.js` **já as descarta** ao montar o boneco: nosso rosto não anima.
 * Ou seja, esses megabytes viajam no `game.zip`, são baixados por todo mundo
 * que instala o jogo, ocupam memória enquanto o `.glb` está sendo lido, e nunca
 * chegam à tela. É desperdício sem contrapartida nenhuma.
 *
 * Isto aqui tira as expressões e faz a **coleta de lixo** do que ficou órfão —
 * `accessor` e `bufferView` que ninguém mais aponta. Sem a coleta, o JSON
 * encolhe e o binário continua do mesmo tamanho: o efeito seria zero e pareceria
 * que a ferramenta não fez nada.
 *
 * ## O que ele NÃO faz
 *
 * Não mexe em textura. Redimensionar imagem exige um decodificador (PNG, JPEG),
 * e este projeto tem **zero dependências** — a conta não fecha por um ganho que
 * o exportador do VRoid já oferece na hora de exportar. Quando o peso vier da
 * textura, o lugar de resolver é lá.
 */
import fs from 'node:fs';
import path from 'node:path';

const alinhar = (n) => (n + 3) & ~3;
const MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;

/** Abre um `.glb`: `{ json, bin }`. */
export function abrirGlb(buf) {
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error('nao e um .glb/.vrm');
  const total = buf.readUInt32LE(8);
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off + 8 <= Math.min(total, buf.length)) {
    const tam = buf.readUInt32LE(off);
    const tipo = buf.readUInt32LE(off + 4);
    const dados = buf.subarray(off + 8, off + 8 + tam);
    if (tipo === JSON_CHUNK) json = JSON.parse(dados.toString('utf8'));
    else if (tipo === BIN_CHUNK) bin = dados;
    off += 8 + tam;
  }
  if (!json) throw new Error('glb sem bloco JSON');
  return { json, bin };
}

/** Monta um `.glb` a partir do JSON e do binário. */
export function fecharGlb(json, bin) {
  const j = Buffer.from(JSON.stringify(json), 'utf8');
  // ESPAÇO no JSON e ZERO no BIN — a especificação pede cada um com o seu, e
  // um parser estrito recusa o arquivo preenchido com o outro
  const jp = Buffer.concat([j, Buffer.alloc(alinhar(j.length) - j.length, 0x20)]);
  const bp = Buffer.concat([bin, Buffer.alloc(alinhar(bin.length) - bin.length, 0)]);
  const total = 12 + 8 + jp.length + (bp.length ? 8 + bp.length : 0);
  const fora = Buffer.alloc(total);
  fora.writeUInt32LE(MAGIC, 0);
  fora.writeUInt32LE(2, 4);
  fora.writeUInt32LE(total, 8);
  fora.writeUInt32LE(jp.length, 12);
  fora.writeUInt32LE(JSON_CHUNK, 16);
  jp.copy(fora, 20);
  if (bp.length) {
    const o = 20 + jp.length;
    fora.writeUInt32LE(bp.length, o);
    fora.writeUInt32LE(BIN_CHUNK, o + 4);
    bp.copy(fora, o + 8);
  }
  return fora;
}

/**
 * Tira as expressões faciais e recolhe o lixo. Devolve `{ json, bin, tirados }`.
 *
 * A renumeração é a parte que erra calada: apagar um `bufferView` do meio da
 * lista desloca todos os seguintes, e **todo índice que apontava para eles passa
 * a apontar para outra coisa**. O modelo carrega, a geometria sai embaralhada, e
 * não há erro nenhum. Por isso o mapa `velho -> novo` é aplicado em TODOS os
 * lugares que guardam índice: accessors, imagens e o `bufferView` esparso.
 */
export function enxugar(json, bin) {
  const g = JSON.parse(JSON.stringify(json));
  let expressoes = 0;

  for (const m of g.meshes ?? []) {
    for (const p of m.primitives ?? []) {
      if (p.targets) { expressoes += p.targets.length; delete p.targets; }
      if (p.extras?.targetNames) delete p.extras.targetNames;
    }
    delete m.weights;
    if (m.extras?.targetNames) delete m.extras.targetNames;
  }

  // ------------------------------------------------- quem ainda é apontado
  const acessoresVivos = new Set();
  const marcar = (i) => { if (typeof i === 'number') acessoresVivos.add(i); };
  for (const m of g.meshes ?? []) {
    for (const p of m.primitives ?? []) {
      for (const a of Object.values(p.attributes ?? {})) marcar(a);
      marcar(p.indices);
    }
  }
  for (const s of g.skins ?? []) marcar(s.inverseBindMatrices);
  for (const a of g.animations ?? []) {
    for (const s of a.samplers ?? []) { marcar(s.input); marcar(s.output); }
  }

  const viewsVivas = new Set();
  for (const i of acessoresVivos) {
    const a = g.accessors[i];
    if (a?.bufferView !== undefined) viewsVivas.add(a.bufferView);
    if (a?.sparse) {
      viewsVivas.add(a.sparse.indices.bufferView);
      viewsVivas.add(a.sparse.values.bufferView);
    }
  }
  for (const im of g.images ?? []) if (im.bufferView !== undefined) viewsVivas.add(im.bufferView);

  // ------------------------------------------------- reescreve o binário
  const antes = bin.length;
  const pedacos = [];
  const mapaView = new Map();
  let tam = 0;
  for (let i = 0; i < (g.bufferViews ?? []).length; i++) {
    if (!viewsVivas.has(i)) continue;
    const bv = g.bufferViews[i];
    const off = bv.byteOffset ?? 0;
    const bytes = bin.subarray(off, off + bv.byteLength);
    // o `byteStride` exige que o começo continue alinhado ao passo, e o resto
    // pede múltiplo de 4: um Float32Array sobre offset ímpar levanta
    const inicio = alinhar(tam);
    if (inicio > tam) { pedacos.push(Buffer.alloc(inicio - tam, 0)); tam = inicio; }
    mapaView.set(i, { indice: mapaView.size, byteOffset: tam });
    pedacos.push(bytes);
    tam += bytes.length;
  }
  const novoBin = Buffer.concat(pedacos, tam);

  const novasViews = [];
  for (const [velho, { byteOffset }] of mapaView) {
    novasViews.push({ ...g.bufferViews[velho], byteOffset, buffer: 0 });
  }

  // ------------------------------------------------- renumera tudo
  const novo = (i) => mapaView.get(i)?.indice;
  const mapaAcessor = new Map();
  const novosAcessores = [];
  for (let i = 0; i < (g.accessors ?? []).length; i++) {
    if (!acessoresVivos.has(i)) continue;
    const a = { ...g.accessors[i] };
    if (a.bufferView !== undefined) a.bufferView = novo(a.bufferView);
    if (a.sparse) {
      a.sparse = {
        ...a.sparse,
        indices: { ...a.sparse.indices, bufferView: novo(a.sparse.indices.bufferView) },
        values: { ...a.sparse.values, bufferView: novo(a.sparse.values.bufferView) },
      };
    }
    mapaAcessor.set(i, novosAcessores.length);
    novosAcessores.push(a);
  }
  const na = (i) => (typeof i === 'number' ? mapaAcessor.get(i) : i);

  for (const m of g.meshes ?? []) {
    for (const p of m.primitives ?? []) {
      for (const k of Object.keys(p.attributes ?? {})) p.attributes[k] = na(p.attributes[k]);
      if (p.indices !== undefined) p.indices = na(p.indices);
    }
  }
  for (const s of g.skins ?? []) {
    if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = na(s.inverseBindMatrices);
  }
  for (const a of g.animations ?? []) {
    for (const s of a.samplers ?? []) { s.input = na(s.input); s.output = na(s.output); }
  }
  for (const im of g.images ?? []) {
    if (im.bufferView !== undefined) im.bufferView = novo(im.bufferView);
  }

  g.bufferViews = novasViews;
  g.accessors = novosAcessores;
  g.buffers = [{ byteLength: novoBin.length }];

  return { json: g, bin: novoBin, expressoes, antes, depois: novoBin.length };
}

// ------------------------------------------------------------------- CLI
const alvo = process.argv[2];
if (!alvo) {
  console.log(`
  Uso:  node tools/enxugar-modelo.mjs <modelo.vrm|.glb> [saida.glb]

  Tira as EXPRESSOES FACIAIS (morph targets) — que modelos.js ja' descarta ao
  carregar — e recolhe o lixo do binario. Num VRM do VRoid isso foi um terco do
  arquivo.
`);
  process.exit(0);
}

const buf = fs.readFileSync(alvo);
const { json, bin } = abrirGlb(buf);
const r = enxugar(json, bin);
const saida = process.argv[3] ?? alvo.replace(/\.(vrm|glb)$/i, '.enxuto.glb');
fs.writeFileSync(saida, fecharGlb(r.json, r.bin));

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const fim = fs.statSync(saida).size;
console.log(`
  ${path.basename(alvo)} -> ${path.basename(saida)}
  ${r.expressoes} expressao(oes) facial(is) removida(s)
  binario  ${mb(r.antes)} -> ${mb(r.depois)}
  arquivo  ${mb(buf.length)} -> ${mb(fim)}   (${Math.round((1 - fim / buf.length) * 100)}% menor)
`);

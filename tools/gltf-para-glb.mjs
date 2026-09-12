/**
 * **Empacota um `.gltf` solto (mais o `.bin` e as texturas) num `.glb` único.**
 *
 *     node tools/gltf-para-glb.mjs <pasta ou scene.gltf> [saida.glb]
 *
 * O Sketchfab e a maioria dos repositórios entregam o glTF **desmontado**: um
 * JSON, um `.bin` ao lado e uma pasta `textures/`. Um personagem vira treze
 * arquivos. Isso custa três coisas, e a terceira é a que decide:
 *
 * 1. **treze requisições** em vez de uma, cada uma com a sua chance de 404;
 * 2. **a textura some sem erro** se a pasta não viajar junto — o personagem
 *    entra branco, e isso é indistinguível de uma escolha de arte;
 * 3. **o `.bin` é buscado pelo `GLTFLoader`, e não pelo nosso `buscar`.**
 *    Nossos testes injetam a leitura para rodar sem servidor (`prepararModelos`
 *    recebe `buscar`), mas a segunda requisição escapa dali — então um modelo
 *    `.gltf` **não pode ser testado em Node**. Ele funciona no navegador e
 *    ninguém consegue provar que continua funcionando.
 *
 * Com `.glb` tudo entra num arquivo e a injeção volta a cobrir o caminho
 * inteiro. Por isso este conversor existe, e por isso o que entra em
 * `web/modelos/` é `.glb`.
 *
 * ## O formato, que é simples de propósito
 *
 * `glTF` binário é: um cabeçalho de 12 bytes (`magic`, versão, tamanho), o
 * chunk **JSON** e o chunk **BIN**. As imagens deixam de ser `uri` e passam a
 * ser `bufferView` apontando para dentro do BIN.
 *
 * **O alinhamento de 4 bytes não é decoração.** Cada chunk e cada `bufferView`
 * têm de começar em múltiplo de 4: um `Float32Array` sobre um deslocamento
 * ímpar levanta no navegador, e um `bufferView` desalinhado faz o loader ler
 * lixo — geometria embaralhada, sem erro nenhum. O JSON é preenchido com
 * ESPAÇO (0x20) e o BIN com ZERO, como manda a especificação.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

/** Sobe até o próximo múltiplo de 4. */
const alinhar = (n) => (n + 3) & ~3;

/**
 * Devolve o Buffer do `.glb`.
 *
 * `lerArquivo(caminhoRelativo)` é injetável para o teste — mesmo padrão de
 * `prepararModelos(…, buscar)`.
 */
export function empacotar(gltf, base, lerArquivo = (p) => fs.readFileSync(path.join(base, p))) {
  const g = JSON.parse(JSON.stringify(gltf));
  const pedacos = [];
  let tamanho = 0;

  /** Põe bytes no BIN e devolve o índice do `bufferView` criado. */
  const acrescentar = (bytes) => {
    const offset = tamanho;
    pedacos.push(bytes);
    tamanho += bytes.length;
    const sobra = alinhar(tamanho) - tamanho;
    if (sobra) { pedacos.push(Buffer.alloc(sobra, 0)); tamanho += sobra; }
    g.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    return g.bufferViews.length - 1;
  };

  // 1. o buffer que já existe (`scene.bin`) entra primeiro e INTEIRO, para os
  //    `bufferView` que já apontam para ele continuarem com os deslocamentos
  //    que têm. Reescrevê-los seria refazer a geometria à toa.
  const buffers = g.buffers ?? [];
  if (buffers.length > 1) throw new Error('mais de um buffer: nao previsto');
  if (buffers.length === 1) {
    const uri = buffers[0].uri;
    const bytes = uri?.startsWith('data:')
      ? Buffer.from(uri.split(',', 2)[1], 'base64')
      : lerArquivo(decodeURIComponent(uri));
    pedacos.push(bytes);
    tamanho = bytes.length;
    const sobra = alinhar(tamanho) - tamanho;
    if (sobra) { pedacos.push(Buffer.alloc(sobra, 0)); tamanho += sobra; }
  }
  g.bufferViews ??= [];

  // 2. as imagens externas viram bufferView
  let embutidas = 0;
  for (const img of g.images ?? []) {
    if (!img.uri || img.uri.startsWith('data:')) continue;
    const rel = decodeURIComponent(img.uri);
    const bytes = lerArquivo(rel);
    const mime = MIME[path.extname(rel).toLowerCase()];
    if (!mime) throw new Error(`imagem de tipo desconhecido: ${rel}`);
    img.bufferView = acrescentar(bytes);
    img.mimeType = mime;
    delete img.uri;
    embutidas++;
  }

  // 3. o buffer único, sem `uri` — é isso que diz "os bytes estão no chunk BIN"
  g.buffers = [{ byteLength: tamanho }];

  const bin = Buffer.concat(pedacos, tamanho);
  const json = Buffer.from(JSON.stringify(g), 'utf8');
  // ESPAÇO no JSON e ZERO no BIN: é o que a especificação manda, e um parser
  // estrito recusa o arquivo preenchido com o outro
  const jsonPad = Buffer.concat([json, Buffer.alloc(alinhar(json.length) - json.length, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc(alinhar(bin.length) - bin.length, 0)]);

  const total = 12 + 8 + jsonPad.length + 8 + binPad.length;
  const fora = Buffer.alloc(total);
  fora.writeUInt32LE(0x46546c67, 0);          // "glTF"
  fora.writeUInt32LE(2, 4);
  fora.writeUInt32LE(total, 8);
  fora.writeUInt32LE(jsonPad.length, 12);
  fora.writeUInt32LE(0x4e4f534a, 16);         // "JSON"
  jsonPad.copy(fora, 20);
  const off = 20 + jsonPad.length;
  fora.writeUInt32LE(binPad.length, off);
  fora.writeUInt32LE(0x004e4942, off + 4);    // "BIN\0"
  binPad.copy(fora, off + 8);

  return { glb: fora, embutidas, bytesBin: bin.length };
}

// ------------------------------------------------------------------- CLI
const alvo = process.argv[2];
if (!alvo) {
  console.log(`
  Uso:  node tools/gltf-para-glb.mjs <pasta ou scene.gltf> [saida.glb]

  Junta o .gltf, o .bin e as texturas num .glb so'. E' o formato que entra em
  web/modelos/, porque um .gltf solto busca o .bin por FORA do nosso 'buscar' e
  por isso nao pode ser testado em Node.
`);
  process.exit(0);
}

const st = fs.statSync(alvo);
const arquivo = st.isDirectory()
  ? path.join(alvo, fs.readdirSync(alvo).find((f) => f.toLowerCase().endsWith('.gltf')))
  : alvo;
const base = path.dirname(arquivo);
const saida = process.argv[3] ?? arquivo.replace(/\.gltf$/i, '.glb');

const { glb, embutidas, bytesBin } = empacotar(
  JSON.parse(fs.readFileSync(arquivo, 'utf8')), base,
);
fs.writeFileSync(saida, glb);

const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`
  ${path.basename(arquivo)} -> ${path.basename(saida)}
  ${embutidas} textura(s) embutida(s) | BIN ${kb(bytesBin)} | total ${kb(glb.length)}
`);

/**
 * **Este pacote de personagem SERVE para o nosso boneco?**
 *
 *     node tools/conferir-modelos.mjs <pasta|arquivo.glb|pacote.zip> [...]
 *
 * A pergunta parece de gosto e não é: `web/js/boneco3d.js` pendura malhas
 * RÍGIDAS nas juntas e anima girando as juntas. Um `.glb` com **esqueleto**
 * (`skins`) carrega, aparece, e fica **parado numa pose de T** enquanto o
 * boneco anda — sem erro nenhum no console. É o pior resultado possível: o
 * arquivo "funcionou", e a conclusão vira "o modelo é feio" em vez de "o
 * formato não é o nosso".
 *
 * E isso não é raro: **quase todo pacote de personagem grátis é rigado**,
 * porque é o que um personagem precisa para animar. O pacote que já está aqui
 * (Kenney Blocky) é a exceção — 0 skins, partes rígidas com nós nomeados.
 *
 * Este conferidor lê o `.glb` byte a byte (o cabeçalho JSON do binary glTF) e
 * responde antes de o arquivo entrar no repositório. Sem dependência: o formato
 * é `magic | versão | tamanho` e chunks, e ler isso é mais barato que instalar
 * um parser.
 *
 * ## O que ele cobra, e por quê
 *
 * | conferência | por que erra CALADO sem ela |
 * |---|---|
 * | `skins: 0` | com esqueleto o modelo entra e não anima — ver acima |
 * | nós nomeados | sem eles a peça vai inteira para a junta padrão do slot, e uma jaqueta fica rígida enquanto o braço anda por dentro |
 * | textura externa | é procurada na pasta do `.glb`; faltando, o personagem entra **branco** e parece escolha de arte |
 * | triângulos | uma cidade com vinte pessoas paga isto vinte vezes |
 * | escala | o `corpo` é normalizado para 1,72 m, mas uma PEÇA não é: fora de escala ela aparece no chão ou gigante |
 *
 * Ele NÃO substitui a bancada visual (`web/bancada-modelos.html`): aqui se
 * decide se o arquivo é do tipo certo, lá se vê se ele está no lugar certo.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// A REGRA mora em `web/js/conferirmodelo.js`, e nao aqui: a **Bancada de
// Modelos** (`web/modelos.html`) faz a mesma pergunta na tela, e duas copias
// dela divergiriam caladas — o CLI aprovaria o que a bancada recusa, e ninguem
// saberia qual esta certo. Deste lado fica so' o que e' de Node: descer pasta,
// abrir `.zip` e imprimir com cor.
import { lerCabecalhoGlb, conferir } from '../web/js/conferirmodelo.js';

// ------------------------------------------------------------------- entrada
/**
 * `Buffer` -> `ArrayBuffer`, sem copiar o pool inteiro.
 *
 * Um `Buffer` do Node e' uma VISTA sobre um pool compartilhado: passar o
 * `.buffer` dele direto entrega megabytes de outros arquivos junto, e o
 * cabecalho lido sai de um deslocamento errado. O `slice` recorta a vista.
 */
const paraArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

/** Todos os `.glb` de uma pasta, arquivo ou `.zip`. `[{ nome, buf }]`. */
function coletar(alvo) {
  const st = fs.existsSync(alvo) ? fs.statSync(alvo) : null;
  if (!st) return [];
  if (st.isDirectory()) return varrer(alvo, alvo);
  if (alvo.toLowerCase().endsWith('.zip')) return doZip(alvo);
  return [{ nome: path.basename(alvo), buf: fs.readFileSync(alvo) }];
}

/**
 * `.glb`, `.vrm` e `.gltf` — sao o mesmo formato em duas embalagens.
 *
 * Ele comeca com a mesma assinatura `glTF` e so' acrescenta extensoes (o rig
 * humanoide, os blendshapes de expressao, a licenca). Recusa-lo pela extensao
 * mandaria a pessoa renomear o arquivo para descobrir o que ele e' — quando o
 * conferidor ja' tem tudo o que precisa para responder.
 */
const ehModelo = (n) => /\.(glb|vrm|gltf|vroid)$/i.test(n);

/**
 * Desce a pasta atras dos modelos.
 *
 * Escrita a mao de proposito: `readdirSync(dir, { recursive: true })` so existe
 * a partir do Node 18.17, e nas versoes anteriores a opcao e' **ignorada em
 * silencio** — a varredura devolve so' o primeiro nivel e o conferidor diria
 * "nenhum .glb aqui" para um pacote cheio deles, que e' a pior resposta
 * possivel: parece que o pacote nao serve. Este projeto pede Node >= 18.
 */
function varrer(dir, raiz) {
  const fora = [];
  for (const nome of fs.readdirSync(dir)) {
    const cheio = path.join(dir, nome);
    const st = fs.statSync(cheio);
    if (st.isDirectory()) fora.push(...varrer(cheio, raiz));
    else if (ehModelo(nome)) {
      fora.push({ nome: path.relative(raiz, cheio), buf: fs.readFileSync(cheio) });
    }
  }
  return fora;
}

/**
 * Os `.glb` de dentro de um `.zip`, sem dependência nenhuma.
 *
 * Lê o DIRETÓRIO CENTRAL, no fim do arquivo, e não os cabeçalhos locais: o
 * cabeçalho local pode trazer tamanho zero e mandar procurar um descritor
 * depois dos dados (é o que faz quem escreve o zip em streaming), e um leitor
 * que confia nele para um arquivo desses lê comprimento errado — em silêncio.
 */
function doZip(caminho) {
  const b = fs.readFileSync(caminho);
  let fim = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('zip sem diretorio central');

  const total = b.readUInt16LE(fim + 10);
  let off = b.readUInt32LE(fim + 16);
  const fora = [];
  for (let i = 0; i < total; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) break;
    const metodo = b.readUInt16LE(off + 10);
    const comp = b.readUInt32LE(off + 20);
    const nTam = b.readUInt16LE(off + 28);
    const eTam = b.readUInt16LE(off + 30);
    const cTam = b.readUInt16LE(off + 32);
    const local = b.readUInt32LE(off + 42);
    const nome = b.subarray(off + 46, off + 46 + nTam).toString('utf8');
    off += 46 + nTam + eTam + cTam;
    if (!ehModelo(nome)) continue;

    const lnTam = b.readUInt16LE(local + 26);
    const leTam = b.readUInt16LE(local + 28);
    const dados = b.subarray(local + 30 + lnTam + leTam, local + 30 + lnTam + leTam + comp);
    fora.push({ nome, buf: metodo === 8 ? zlib.inflateRawSync(dados) : Buffer.from(dados) });
  }
  return fora;
}

// ------------------------------------------------------------------- relatório
const COR = { ok: '\x1b[32mOK  \x1b[0m', '!': '\x1b[33m!!  \x1b[0m', nao: '\x1b[31mNAO \x1b[0m', '..': '..  ' };
const SELO = {
  serve: '\x1b[32mSERVE\x1b[0m',
  ajusta: '\x1b[33mPRECISA DE AJUSTE\x1b[0m',
  nao: '\x1b[31mNAO SERVE (hoje)\x1b[0m',
};

const alvos = process.argv.slice(2);
if (!alvos.length) {
  console.log(`
  Uso:  node tools/conferir-modelos.mjs <pasta|arquivo.glb|pacote.zip> [...]

  Responde se um pacote de personagem serve para o boneco deste projeto.
  A trava que reprova quase todo pacote gratis e' o ESQUELETO: boneco3d.js
  pendura malhas rigidas nas juntas, e um .glb com skin entra, aparece e fica
  parado — sem erro nenhum. Ver web/modelos/README.md, §8.
`);
  process.exit(0);
}

let servem = 0, ajustam = 0, nao = 0;
for (const alvo of alvos) {
  const arquivos = coletar(alvo);
  console.log(`\n  ####  ${alvo}  ####`);
  if (!arquivos.length) { console.log('  (nenhum .glb aqui)'); continue; }

  for (const { nome, buf } of arquivos) {
    let r;
    try {
      r = conferir(nome, lerCabecalhoGlb(paraArrayBuffer(buf)), { comoPeca: /peca|cabelo|roupa|calca|sapato/i.test(nome) });
    } catch (e) {
      console.log(`\n  ${nome}\n      ${COR.nao} ${e.message}`);
      nao++;
      continue;
    }
    if (r.veredito === 'serve') servem++; else if (r.veredito === 'ajusta') ajustam++; else nao++;
    console.log(`\n  ${nome}  ${SELO[r.veredito]}`);
    for (const [nivel, texto] of r.notas) console.log(`      ${COR[nivel] ?? '    '} ${texto}`);
  }
}

console.log(`\n  ----\n  ${servem} servem · ${ajustam} precisam de ajuste · ${nao} nao servem hoje\n`);

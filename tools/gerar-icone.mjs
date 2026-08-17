/**
 * **O ícone do jogo.**
 *
 *     node tools/gerar-icone.mjs
 *
 * Entra `assets/icone-fonte.png` (a arte, 1254x1254) e saem:
 *
 *   • `assets/icone.ico`     — o executável (launcher, stop e duel-server, pelo
 *                              `ApplicationIcon` de cada .csproj);
 *   • `web/img/icone.png`    — a aba do navegador, em todas as páginas;
 *   • `web/img/icone-256.png`— a versão grande.
 *
 * Sem dependência nenhuma: o PNG é lido e escrito à mão, com o `zlib` que vem
 * no Node. É a mesma regra do resto do projeto — o front tem zero dependências,
 * e uma ferramenta que exige `npm install` para regerar o ícone seria a única
 * peça do repositório que não roda numa máquina limpa.
 *
 * A ARTE É A FONTE e mora no git (`assets/icone-fonte.png`). Sem ela, o `.ico`
 * seria um binário que ninguém consegue refazer: mudar um pixel exigiria ter
 * guardado o arquivo original em algum lugar fora do projeto.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const FONTE = 'assets/icone-fonte.png';

// ----------------------------------------------------------- ler o PNG
/**
 * Decodifica um PNG de 8 bits, sem entrelaçamento, em RGBA.
 *
 * Cobre os quatro tipos de cor que importam aqui (cinza, RGB, cinza+alfa,
 * RGBA). Paleta (tipo 3) e entrelaçado (Adam7) ficam de fora de propósito: o
 * arquivo diz o que é no IHDR, e recusar alto é melhor que decodificar errado
 * em silêncio — o sintoma seria um ícone embaralhado, não um erro.
 */
function lerPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('não é um PNG');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const profundidade = buf[24], tipo = buf[25], entrelacado = buf[28];
  if (profundidade !== 8) throw new Error(`profundidade ${profundidade} não suportada (só 8)`);
  if (entrelacado !== 0) throw new Error('PNG entrelaçado (Adam7) não suportado');
  const canais = { 0: 1, 2: 3, 4: 2, 6: 4 }[tipo];
  if (!canais) throw new Error(`tipo de cor ${tipo} não suportado`);

  // Os dados podem vir partidos em vários IDAT — o zlib é UM fluxo só, então
  // eles têm de ser concatenados ANTES de descomprimir.
  const pedacos = [];
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off);
    const t = buf.toString('ascii', off + 4, off + 8);
    if (t === 'IDAT') pedacos.push(buf.subarray(off + 8, off + 8 + len));
    if (t === 'IEND') break;
    off += 12 + len;
  }
  const bruto = inflateSync(Buffer.concat(pedacos));

  // Desfaz os filtros por linha (a parte que o formato exige e ninguém lembra).
  const bpp = canais, passo = w * bpp;
  const linhas = Buffer.alloc(h * passo);
  for (let y = 0; y < h; y++) {
    const filtro = bruto[y * (passo + 1)];
    const ent = bruto.subarray(y * (passo + 1) + 1, y * (passo + 1) + 1 + passo);
    const cur = linhas.subarray(y * passo, (y + 1) * passo);
    const ant = y > 0 ? linhas.subarray((y - 1) * passo, y * passo) : null;
    for (let i = 0; i < passo; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = ant ? ant[i] : 0;
      const c = ant && i >= bpp ? ant[i - bpp] : 0;
      let v = ent[i];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }

  const px = new Uint8Array(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * canais, d = i * 4;
    if (canais === 1) { px[d] = px[d + 1] = px[d + 2] = linhas[s]; px[d + 3] = 255; }
    else if (canais === 2) { px[d] = px[d + 1] = px[d + 2] = linhas[s]; px[d + 3] = linhas[s + 1]; }
    else if (canais === 3) { px[d] = linhas[s]; px[d + 1] = linhas[s + 1]; px[d + 2] = linhas[s + 2]; px[d + 3] = 255; }
    else { px[d] = linhas[s]; px[d + 1] = linhas[s + 1]; px[d + 2] = linhas[s + 2]; px[d + 3] = linhas[s + 3]; }
  }
  return { w, h, px };
}

// ----------------------------------------------------------- cantos
/**
 * **Os cantos do quadro viram transparentes.**
 *
 * A arte é um quadrado com a moldura de cantos arredondados e preto por fora
 * dela. Deixado assim, o ícone aparece como um bloco preto com o desenho
 * dentro — na barra de tarefas e no menu Iniciar isso é exatamente o que
 * distingue um ícone caprichado de um print colado.
 *
 * O corte é por INUNDAÇÃO a partir dos quatro cantos, e não por "todo pixel
 * escuro": o fundo da arena também é quase preto, e um limiar solto abriria
 * buracos no meio do desenho. Só o que é escuro E alcançável pela borda sai.
 */
function recortarCantos(img, limiar = 42) {
  const { w, h, px } = img;
  const escuro = (i) => px[i * 4] <= limiar && px[i * 4 + 1] <= limiar && px[i * 4 + 2] <= limiar;
  const fila = [];
  const visto = new Uint8Array(w * h);
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    const i = y * w + x;
    if (escuro(i)) { fila.push(i); visto[i] = 1; }
  }
  while (fila.length) {
    const i = fila.pop();
    px[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!visto[j] && escuro(j)) { visto[j] = 1; fila.push(j); }
    }
  }
  return img;
}

// ----------------------------------------------------------- redimensionar
/**
 * Reduz por MÉDIA DE ÁREA: cada pixel de saída é a média do bloco que ele cobre
 * na origem.
 *
 * Vizinho-mais-próximo seria o certo para ampliar pixel art, mas aqui a origem
 * é a arte já rasterizada em 1254 px — pegar 1 pixel a cada 19 escolheria por
 * sorteio qual detalhe sobrevive, e o resultado treme (o famoso serrilhado que
 * dança entre um tamanho e outro). A média preserva a massa e o contraste.
 *
 * O alfa entra na conta com peso: sem isso, a borda do recorte puxaria a cor do
 * preto transparente para dentro do desenho e a moldura sairia suja.
 */
function reduzir(img, n) {
  const { w, h, px } = img;
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const y0 = Math.floor((y * h) / n), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / n));
    for (let x = 0; x < n; x++) {
      const x0 = Math.floor((x * w) / n), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / n));
      let r = 0, g = 0, b = 0, a = 0, peso = 0, cont = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * w + sx) * 4, al = px[i + 3];
          r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al;
          a += al; peso += al; cont++;
        }
      }
      const d = (y * n + x) * 4;
      if (peso === 0) { out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0; continue; }
      out[d] = Math.round(r / peso); out[d + 1] = Math.round(g / peso);
      out[d + 2] = Math.round(b / peso); out[d + 3] = Math.round(a / cont);
    }
  }
  return { w: n, h: n, px: out };
}

// ----------------------------------------------------------- escrever o PNG
const CRC = (() => {
  const tab = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tab[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = tab[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(corpo));
  return Buffer.concat([len, corpo, crc]);
}

function png(img) {
  const { w, px } = img, n = w;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = 6;              // 8 bits, RGBA
  // Cada linha do PNG começa com o byte de filtro (0 = nenhum).
  const bruto = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) {
    bruto[y * (n * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * n * 4, n * 4).copy(bruto, y * (n * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(bruto, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----------------------------------------------------------- escrever o ICO
/**
 * Uma entrada do .ico como DIB de 32 bits (BGRA), que é o formato que TODA
 * versão do Windows lê. É o que os tamanhos pequenos usam.
 *
 * Duas pegadinhas do formato: a altura no cabeçalho é o DOBRO (imagem + máscara
 * AND, que existe mesmo com canal alfa) e as linhas vão de BAIXO para cima.
 */
function dib(img) {
  const { w: n, px } = img;
  const cab = Buffer.alloc(40);
  cab.writeUInt32LE(40, 0);
  cab.writeInt32LE(n, 4);
  cab.writeInt32LE(n * 2, 8);
  cab.writeUInt16LE(1, 12);
  cab.writeUInt16LE(32, 14);
  const cor = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = ((n - 1 - y) * n + x) * 4, d = (y * n + x) * 4;
      cor[d] = px[s + 2]; cor[d + 1] = px[s + 1]; cor[d + 2] = px[s]; cor[d + 3] = px[s + 3];
    }
  }
  // Máscara AND: 1 bit por pixel, linhas alinhadas em 4 bytes. Tudo 0 = "usa o
  // alfa"; deixá-la fora faz alguns contextos desenharem lixo em volta.
  const passo = Math.ceil(n / 32) * 4;
  const mascara = Buffer.alloc(passo * n, 0);
  return Buffer.concat([cab, cor, mascara]);
}

/**
 * O 256x256 vai como PNG, os outros como DIB.
 *
 * Não é economia à toa: cru, só o 256 pesa 256×256×4 = 262 KB, e o ícone
 * inteiro passaria de 370 KB — mais que o launcher, que tem 150 KB de código.
 * Comprimido ele cai para poucos KB. O PNG dentro de .ico é justamente o que a
 * Microsoft recomenda para 256 (e só ele): os tamanhos pequenos, que aparecem
 * em toda parte da shell, continuam no formato que qualquer contexto lê.
 */
function ico(imgs) {
  const cab = Buffer.alloc(6);
  cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(imgs.length, 4);
  const dados = imgs.map((t) => (t.w >= 256 ? png(t) : dib(t)));
  const dir = Buffer.alloc(16 * imgs.length);
  let off = 6 + 16 * imgs.length;
  imgs.forEach((t, i) => {
    const b = i * 16;
    dir[b] = t.w >= 256 ? 0 : t.w;       // 0 significa 256 no formato
    dir[b + 1] = t.w >= 256 ? 0 : t.w;
    dir[b + 2] = 0; dir[b + 3] = 0;
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(dados[i].length, b + 8);
    dir.writeUInt32LE(off, b + 12);
    off += dados[i].length;
  });
  return Buffer.concat([cab, dir, ...dados]);
}

// ----------------------------------------------------------- saída
function gravar(caminho, buf) {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, buf);
  console.log(`  OK   ${caminho} (${buf.length.toLocaleString('pt-BR')} bytes)`);
}

// Sem o 128: ele custa 64 KB crus no .ico e o Windows reduz o 256 sem
// diferenca visivel. Os que a shell realmente pede sao estes.
const TAMANHOS = [16, 24, 32, 48, 64, 256];
console.log('\n  ####  ICONE DO CLASSIC DUELS  ####\n');
const arte = recortarCantos(lerPng(readFileSync(FONTE)));
console.log(`  ..   fonte: ${FONTE} (${arte.w}x${arte.h})`);
const versoes = TAMANHOS.map((n) => reduzir(arte, n));
gravar('assets/icone.ico', ico(versoes));
gravar('web/img/icone.png', png(reduzir(arte, 64)));
gravar('web/img/icone-256.png', png(reduzir(arte, 256)));
console.log(`\n  a arte e' ${FONTE} — troque o arquivo e rode de novo.\n`);

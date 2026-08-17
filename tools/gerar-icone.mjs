/**
 * **O ícone do jogo, desenhado em código.**
 *
 * O front tem zero dependências e a arte do mundo andável já é pixel art gerada
 * em código (`web/js/tileset.js`) — um `.ico` binário commitado sem fonte seria
 * a única imagem do projeto que ninguém consegue editar. Aqui o desenho é o
 * código: mudar a cor da moldura é mudar uma constante e rodar de novo.
 *
 *     node tools/gerar-icone.mjs
 *
 * Gera `assets/icone.ico` (o executável) e `web/img/icone.png` (a aba do
 * navegador). Só usa `zlib`, que vem no Node — o PNG é escrito à mão.
 *
 * O desenho é o VERSO DE CARTA do próprio tabuleiro: moldura dourada, campo
 * azul-escuro, molduras internas e o monograma CD no centro. Em 16x16 o
 * monograma vira um losango — duas letras em 6 pixels de altura viram borrão, e
 * um ícone que não se lê na barra de tarefas não é um ícone.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// A paleta é a do jogo (web/css/ui.css): --gold sobre o azul da mesa.
const OURO = [0xe8, 0xc4, 0x6a];
const OURO_ESCURO = [0x8a, 0x6d, 0x24];
const FUNDO = [0x0a, 0x0f, 0x16];
const CAMPO = [0x16, 0x22, 0x38];
const CAMPO_CLARO = [0x1e, 0x2e, 0x4a];

/** Tela de pixels RGBA, com origem no canto superior esquerdo. */
function tela(n) {
  const px = new Uint8Array(n * n * 4);
  const por = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const i = (y * n + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const ret = (x0, y0, x1, y1, cor) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) por(x, y, cor);
  };
  const moldura = (x0, y0, x1, y1, cor, esp = 1) => {
    for (let k = 0; k < esp; k++) {
      for (let x = x0 + k; x <= x1 - k; x++) { por(x, y0 + k, cor); por(x, y1 - k, cor); }
      for (let y = y0 + k; y <= y1 - k; y++) { por(x0 + k, y, cor); por(x1 - k, y, cor); }
    }
  };
  return { n, px, por, ret, moldura };
}

// Monograma 5x7 por linha de texto — o mesmo truque dos bonecos do mundo
// andável: 1 caractere = 1 pixel, para o desenho caber no diff.
const LETRAS = {
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
};

function letra(t, glifo, x0, y0, escala, cor) {
  const linhas = LETRAS[glifo];
  for (let y = 0; y < linhas.length; y++)
    for (let x = 0; x < linhas[y].length; x++) {
      if (linhas[y][x] !== '#') continue;
      for (let sy = 0; sy < escala; sy++)
        for (let sx = 0; sx < escala; sx++)
          t.por(x0 + x * escala + sx, y0 + y * escala + sy, cor);
    }
}

/**
 * O ícone num tamanho. Tudo em proporção de `n` para o desenho ser o MESMO em
 * 16 e em 256 — o que muda é só quanto detalhe cabe.
 */
function desenhar(n) {
  const t = tela(n);
  const u = n / 16;                      // a unidade: 1 pixel no menor tamanho
  const p = (v) => Math.round(v * u);

  // A carta precisa ser mais ALTA que larga — quadrada ela vira "moldura", não
  // "carta". Não chega aos 59/86 do baralho (magra demais num ícone quadrado),
  // mas fica perto o suficiente para o olho reconhecer.
  const mx = Math.round(n * 0.14), my = Math.round(n * 0.03);
  const x0 = mx, y0 = my, x1 = n - 1 - mx, y1 = n - 1 - my;

  t.ret(0, 0, n - 1, n - 1, FUNDO, 0);                       // fundo transparente
  t.ret(x0, y0, x1, y1, CAMPO);                               // corpo da carta
  const esp = Math.max(1, Math.round(n / 32));
  t.moldura(x0, y0, x1, y1, OURO, esp);                       // moldura dourada
  // Bisel: uma linha escura por dentro do ouro dá volume sem sombra nenhuma.
  t.moldura(x0 + esp, y0 + esp, x1 - esp, y1 - esp, OURO_ESCURO, Math.max(1, Math.floor(esp / 2)));

  // Moldura interna (a "janela" do verso da carta).
  const dentro = Math.max(2, Math.round(n * 0.08));
  const ix0 = x0 + dentro, iy0 = y0 + dentro, ix1 = x1 - dentro, iy1 = y1 - dentro;
  if (ix1 - ix0 > 2 && iy1 - iy0 > 2) {
    t.ret(ix0, iy0, ix1, iy1, CAMPO_CLARO);
    t.moldura(ix0, iy0, ix1, iy1, OURO_ESCURO, Math.max(1, Math.floor(esp / 2)));
  }

  const larguraInterna = ix1 - ix0;
  if (n >= 32 && larguraInterna >= 13) {
    // CD, centralizado. A escala sai da largura disponível: as duas letras
    // ocupam 5+1+5 = 11 colunas do glifo.
    const escala = Math.max(1, Math.floor((larguraInterna - 2) / 11));
    const larg = 11 * escala, alt = 7 * escala;
    const lx = ix0 + Math.floor((larguraInterna - larg) / 2) + 1;
    const ly = iy0 + Math.floor((iy1 - iy0 - alt) / 2) + 1;
    letra(t, 'C', lx, ly, escala, OURO);
    letra(t, 'D', lx + 6 * escala, ly, escala, OURO);
  } else {
    // 16x16: um losango dourado. Duas letras em 6 pixels de altura viram
    // borrão, e a barra de tarefas é justamente onde o ícone precisa funcionar.
    const cx = Math.round((ix0 + ix1) / 2), cy = Math.round((iy0 + iy1) / 2);
    const r = Math.max(1, Math.floor(Math.min(ix1 - ix0, iy1 - iy0) / 2) - 1);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (Math.abs(dx) + Math.abs(dy) <= r) t.por(cx + dx, cy + dy, OURO);
  }
  return t;
}

// ----------------------------------------------------------------- PNG
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

function png(t) {
  const { n, px } = t;
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

// ----------------------------------------------------------------- ICO
/**
 * Uma entrada do .ico como DIB de 32 bits (BGRA), que é o formato que TODA
 * versão do Windows lê. É o que os tamanhos pequenos usam.
 *
 * Duas pegadinhas do formato: a altura no cabeçalho é o DOBRO (imagem + máscara
 * AND, que existe mesmo com canal alfa) e as linhas vão de BAIXO para cima.
 */
function dib(t) {
  const { n, px } = t;
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
 * inteiro passava de 370 KB — mais que o dobro do launcher, que tem 150 KB de
 * código. Comprimido ele cai para ~1,4 KB. O PNG dentro de .ico é justamente o
 * que a Microsoft recomenda para 256 (e só ele): os tamanhos pequenos, que
 * aparecem em toda parte da shell, continuam no formato que qualquer contexto
 * lê.
 */
function ico(telas) {
  const cab = Buffer.alloc(6);
  cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(telas.length, 4);
  const dados = telas.map((t) => (t.n >= 256 ? png(t) : dib(t)));
  const dir = Buffer.alloc(16 * telas.length);
  let off = 6 + 16 * telas.length;
  telas.forEach((t, i) => {
    const b = i * 16;
    dir[b] = t.n >= 256 ? 0 : t.n;       // 0 significa 256 no formato
    dir[b + 1] = t.n >= 256 ? 0 : t.n;
    dir[b + 2] = 0; dir[b + 3] = 0;
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(dados[i].length, b + 8);
    dir.writeUInt32LE(off, b + 12);
    off += dados[i].length;
  });
  return Buffer.concat([cab, dir, ...dados]);
}

// ----------------------------------------------------------------- saída
function gravar(caminho, buf) {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, buf);
  console.log(`  OK   ${caminho} (${buf.length.toLocaleString('pt-BR')} bytes)`);
}

const TAMANHOS = [16, 24, 32, 48, 64, 256];
console.log('\n  ####  ICONE DO CLASSIC DUELS  ####\n');
gravar('assets/icone.ico', ico(TAMANHOS.map(desenhar)));
gravar('web/img/icone.png', png(desenhar(64)));
gravar('web/img/icone-256.png', png(desenhar(256)));
console.log('\n  o desenho mora em tools/gerar-icone.mjs — rode de novo para mudar.\n');

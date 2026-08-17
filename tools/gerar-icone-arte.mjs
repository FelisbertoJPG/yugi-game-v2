/**
 * **Candidato a ícone: a versão ILUSTRADA.**
 *
 *     node tools/gerar-icone-arte.mjs
 *
 * O ícone em uso (`tools/gerar-icone.mjs`) é geométrico: moldura e monograma,
 * desenhados por fórmula. Este é o outro caminho — arte 16-bit de verdade,
 * autorada pixel a pixel: moldura dourada com bisel, arena escura ao fundo,
 * conjurador de um lado, dragão do outro, cartas em leque e o emblema de duelo
 * no centro.
 *
 * O desenho continua sendo CÓDIGO. Cada peça é uma grade de TEXTO — 1 caractere
 * = 1 pixel, o mesmo truque dos bonecos do mundo andável (`web/js/actors.js`) —
 * e a paleta é uma tabela de letra → cor. Editar o dragão é editar as linhas do
 * dragão, e o diff mostra o desenho.
 *
 * Sai em `assets/candidato-arte.png` (64x64, o tamanho em que foi desenhado) e
 * `assets/candidato-arte-256.png` (o mesmo, ampliado 4x sem suavizar). Não toca
 * no ícone em uso: trocar é copiar as peças daqui para o gerador oficial.
 *
 * Por que 64 e não 256: pixel art se desenha no tamanho em que vai ser vista.
 * Ampliar 4x com vizinho-mais-próximo mantém o pixel duro; desenhar em 256 e
 * reduzir vira borrão — e o ícone precisa sobreviver a 64x64.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

// ------------------------------------------------------------------ paleta
// Letra → cor. Ponto e espaço são "não pinta nada" (deixa o que já estava).
const CORES = {
  // ouro da moldura, do brilho para a sombra
  W: '#fff3c4', G: '#f2d17a', g: '#d4a63c', h: '#a97c22', H: '#6b4a12',
  // fundo da arena
  z: '#0a0a12', Z: '#141428', y: '#1d2044', Y: '#262a55', L: '#343a72',
  // conjurador (roxo/magenta)
  p: '#f0a8ff', P: '#b45cd6', q: '#7a2f9e', Q: '#4a1a66',
  // dragão (azul/ciano)
  c: '#dff2ff', C: '#8fd0f5', b: '#4a90c8', B: '#2b5b8f', N: '#1a3a63',
  // cartas (marrom)
  n: '#a4622c', m: '#7a4520', M: '#522d15', o: '#e0a45a',
  // acentos
  r: '#e8455e', R: '#94203a', e: '#3fd68a',
  k: '#000000', w: '#ffffff',
};

const N = 64;
const px = new Uint8Array(N * N * 4);

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
function por(x, y, letra) {
  if (letra === '.' || letra === ' ' || x < 0 || y < 0 || x >= N || y >= N) return;
  const hex = CORES[letra];
  if (!hex) return;
  const [r, g, b] = rgb(hex);
  const i = (y * N + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
}
/** Carimba uma grade de texto com o canto superior esquerdo em (x0,y0). */
function grade(x0, y0, linhas) {
  linhas.forEach((linha, y) => [...linha].forEach((ch, x) => por(x0 + x, y0 + y, ch)));
}
const ret = (x0, y0, x1, y1, l) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) por(x, y, l);
};

// ------------------------------------------------------------------ fundo
// Arena: gradiente em degraus (dithering), grade de tabuleiro e vinheta. Em
// degraus de propósito — gradiente liso não é 16-bit.
ret(0, 0, 63, 63, 'z');
for (let y = 5; y <= 58; y++) {
  for (let x = 5; x <= 58; x++) {
    const d = Math.max(Math.abs(x - 31.5), Math.abs(y - 31.5));
    let l = d > 24 ? 'Z' : d > 18 ? 'y' : d > 11 ? 'Y' : 'L';
    // dithering em xadrez na fronteira entre dois tons
    if ((x + y) % 2 === 0 && d > 11 && d < 25) l = l === 'Z' ? 'z' : l === 'y' ? 'Z' : 'y';
    por(x, y, l);
  }
}
// Linhas da grade do tabuleiro, bem discretas.
for (let x = 5; x <= 58; x++) for (const y of [13, 22, 31, 40, 49]) if (x % 2) por(x, y, 'Y');
for (let y = 5; y <= 58; y++) for (const x of [13, 22, 31, 40, 49]) if (y % 2) por(x, y, 'Y');

// ------------------------------------------------------------------ figuras
// CONJURADOR — silhueta ESCURA com luz de contorno magenta, chapéu pontudo,
// olhos acesos e cajado. Silhueta em vez de anatomia: em 64px é o contorno que
// carrega a leitura, e é o que a referência faz com todas as figuras.
const CONJURADOR = [
  '.........qQ..........',
  '........qPQq.........',
  '........qPQq.........',
  '.......qPQQQq........',
  '.......qPQQQq........',
  '......qPQQQQQq.......',
  '......qPQQQQQq.......',
  '.....qPQQQQQQQq......',
  '.....qPQQQQQQQq......',
  '....qPQQQQQQQQQq.....',
  '....qPQQQQQQQQQq.....',
  '...qPQQQQQQQQQQQq....',
  '...qPQQQQQQQQQQQq....',
  '..qPQQQQQQQQQQQQQq...',
  '..qPQQQQQQQQQQQQQq...',
  '.qPQQQQQQQQQQQQQQQq..',
  '.qPPPPPPPPPPPPPPPPPq.',
  '.qkkkkkkkkkkkkkkkkkq.',
  'qPkkwwkkkkkkkkwwkkkPq',
  'qPkkwpkkkkkkkkpwkkkPq',
  'qPkkkkkkkkkkkkkkkkkPq',
  '.qkkkkkkkkkkkkkkkkkq.',
  '.qPQQQQQQQQQQQQQQQPq.',
  'qPQQQQQQQQQQQQQQQQQPq',
  'qPQQQQQQQQQQQQQQQQQPq',
  'qPQQQQQQpppQQQQQQQQPq',
  'qPQQQQQpwwwpQQQQQQQPq',
  'qPQQQQQpwwwpQQQQQQQPq',
  'qPQQQQQQpppQQQQQQQQPq',
  'qPQQQQQQQQQQQQQQQQQPq',
  'qPQQQQQQQQQQQQQQQQQPq',
  '.qPQQQQQQQQQQQQQQQPq.',
  '.qPQQQQQQQQQQQQQQQPq.',
  '..qPQQQQQQQQQQQQQPq..',
  '..qPQQQQQQQQQQQQQPq..',
  '...qqqqqqqqqqqqqqq...',
];
grade(4, 13, CONJURADOR);
// Cajado com a gema — o único ponto verde do ícone, então ele puxa o olho.
grade(1, 30, [
  '.gGg.',
  'GeeeG',
  'GewéG',
  'GeeeG',
  '.gGg.',
  '..h..',
  '..g..',
  '..h..',
  '..g..',
  '..h..',
  '..g..',
  '..h..',
]);

// DRAGÃO — cabeça de perfil virada para o centro, boca aberta, pescoço descendo
// e a asa atrás. Mesmo tratamento: massa escura, contorno aceso.
const DRAGAO = [
  '..............bbb.....',
  '............bbCCCbb...',
  '.........bbbCCCCCCCb..',
  '.......bbCCCCCCCCCCb..',
  '.....bbCCCCCCkkCCCCb..',
  '...bbCCCCCCCkwwkCCCb..',
  '..bCCCCCCCCCkwwkCCCb..',
  '.bCCCCCCCCCCCkkCCCCb..',
  'bCCCCCCCCCCCCCCCCCCb..',
  'bCCCCCCCCCCCCCCCCCCb..',
  'bwwwCCCCCCCCCCCCCCb...',
  'bkwkwCCCCCCCCCCCCb....',
  '.bkwkwCCCCCCCCCCb.....',
  '..bkwkwCCCCCCCCb......',
  '...bkkkkCCCCCCb.......',
  '.....bbbbCCCCb........',
  '.........bCCCb........',
  '.........bCCCb........',
  '........bCCCCb........',
  '........bCCCb.........',
  '.......bCCCb..........',
  '.......bCCb...........',
];
grade(38, 14, DRAGAO);
// Asa, atrás da cabeça: dá massa ao lado direito sem competir com o rosto.
grade(50, 8, [
  '...bbB',
  '..bCCB',
  '.bCCbB',
  'bCCbBN',
  'bCbBN.',
  'bCbBN.',
  'bbBN..',
]);

// ------------------------------------------------------------------ cartas
// Leque de cartas: três versos, o do meio atrás do emblema. O verso é o mesmo
// desenho concêntrico do baralho clássico — em 14px de largura só cabem os anéis.
const VERSO = [
  'GGGGGGGGGGGG',
  'GmmmmmmmmmmG',
  'GmMMMMMMMMmG',
  'GmMnnnnnnMmG',
  'GmMnMMMMnMmG',
  'GmMnMooooMnG',
  'GmMnMoMMoMnG',
  'GmMnMoMMoMnG',
  'GmMnMooooMnG',
  'GmMnMMMMnMmG',
  'GmMnnnnnnMmG',
  'GmMMMMMMMMmG',
  'GmmmmmmmmmmG',
  'GmMMMMMMMMmG',
  'GmmmmmmmmmmG',
  'GGGGGGGGGGGG',
];
grade(26, 7, VERSO);          // a do meio, ao fundo
grade(7, 43, VERSO);          // esquerda
grade(45, 43, VERSO);         // direita

// ------------------------------------------------------------------ emblema
// EMBLEMA DE DUELO: losango dourado com um olho geométrico. É o símbolo do
// jogo — tem de ser a primeira coisa que se lê, então fica no centro, com o
// contorno preto separando-o de tudo que passa atrás.
const EMBLEMA = [
  '..........kk..........',
  '.........kGGk.........',
  '........kGWWGk........',
  '.......kGWggWGk.......',
  '......kGWggggWGk......',
  '.....kGWggHHggWGk.....',
  '....kGWggHkkHggWGk....',
  '...kGWggHkwwkHggWGk...',
  '..kGWggHkwrrwkHggWGk..',
  '.kGWggHkwrRRrwkHggWGk.',
  'kGWggHkwrRwwRrwkHggWGk',
  'kGWggHkwrRwwRrwkHggWGk',
  '.kGWggHkwrRRrwkHggWGk.',
  '..kGWggHkwrrwkHggWGk..',
  '...kGWggHkwwkHggWGk...',
  '....kGWggHkkHggWGk....',
  '.....kGWggHHggWGk.....',
  '......kGWggggWGk......',
  '.......kGWggWGk.......',
  '........kGWWGk........',
  '.........kGGk.........',
  '..........kk..........',
];
grade(21, 22, EMBLEMA);
// asas de luz saindo do emblema (o "brilho mágico" sem gradiente liso)
for (const [x, y, l] of [[20, 32, 'G'], [18, 32, 'g'], [16, 32, 'h'],
                          [43, 32, 'G'], [45, 32, 'g'], [47, 32, 'h'],
                          [31, 21, 'G'], [31, 19, 'g'], [32, 21, 'G'], [32, 19, 'g']]) por(x, y, l);

// faíscas
for (const [x, y] of [[14, 18], [50, 20], [12, 40], [52, 38], [22, 14], [41, 16]]) {
  por(x, y, 'W'); por(x - 1, y, 'g'); por(x + 1, y, 'g'); por(x, y - 1, 'g'); por(x, y + 1, 'g');
}

// ------------------------------------------------------------------ moldura
// Por último, para nada passar por cima dela. Bisel de 5px: claro em cima e à
// esquerda, escuro embaixo e à direita — é o que dá relevo sem sombra nenhuma.
for (let k = 0; k < 5; k++) {
  const claro = k === 0 ? 'h' : k === 1 ? 'G' : k === 2 ? 'W' : k === 3 ? 'G' : 'h';
  const escuro = k === 0 ? 'H' : k === 1 ? 'h' : k === 2 ? 'g' : k === 3 ? 'h' : 'H';
  for (let x = k; x < N - k; x++) { por(x, k, claro); por(x, N - 1 - k, escuro); }
  for (let y = k; y < N - k; y++) { por(k, y, claro); por(N - 1 - k, y, escuro); }
}
// Cantos chanfrados: sem isso o quadrado fica duro e o ícone parece um bloco.
for (let i = 0; i < 6; i++)
  for (let j = 0; j < 6 - i; j++) {
    por(i, j, 'z'); por(N - 1 - i, j, 'z');
    por(i, N - 1 - j, 'z'); por(N - 1 - i, N - 1 - j, 'z');
  }
// e o ouro acompanhando o chanfro
for (let i = 0; i < 6; i++) {
  const j = 5 - i;
  for (let e = 0; e < 3; e++) {
    const l = e === 1 ? 'W' : 'G';
    por(i + e, j, l); por(N - 1 - i - e, j, l);
    por(i + e, N - 1 - j, l); por(N - 1 - i - e, N - 1 - j, l);
  }
}

// ------------------------------------------------------------------ saída
const CRC = (() => {
  const tab = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tab[n] = c; }
  return (buf) => { let c = -1; for (const b of buf) c = tab[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function chunk(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(corpo));
  return Buffer.concat([len, corpo, crc]);
}
function png(n, dados) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  const bruto = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) {
    bruto[y * (n * 4 + 1)] = 0;
    Buffer.from(dados.buffer, y * n * 4, n * 4).copy(bruto, y * (n * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(bruto, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** Amplia por vizinho-mais-próximo: pixel art não se interpola. */
function ampliar(dados, n, z) {
  const out = new Uint8Array(n * z * n * z * 4);
  for (let y = 0; y < n * z; y++)
    for (let x = 0; x < n * z; x++) {
      const s = ((y / z | 0) * n + (x / z | 0)) * 4, d = (y * n * z + x) * 4;
      out[d] = dados[s]; out[d + 1] = dados[s + 1]; out[d + 2] = dados[s + 2]; out[d + 3] = dados[s + 3];
    }
  return out;
}

mkdirSync('assets', { recursive: true });
writeFileSync('assets/candidato-arte.png', png(64, px));
writeFileSync('assets/candidato-arte-256.png', png(256, ampliar(px, 64, 4)));
console.log('\n  assets/candidato-arte.png (64x64) e -256.png (ampliado 4x)\n');

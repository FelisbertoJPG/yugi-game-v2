/**
 * **Escrever PNG à mão**, com o `zlib` que vem no Node e mais nada.
 *
 * Existe porque este projeto não tem dependências — nem nas ferramentas. O
 * `gerar-icone.mjs` já escrevia PNG assim para o ícone do jogo; quando os
 * ícones de PERFIL precisaram do mesmo, a escolha foi entre uma segunda cópia
 * do formato e um módulo só. Duas cópias de um formato binário divergem
 * caladas: a que ninguém está olhando continua gerando arquivos que abrem em
 * quase todo visualizador, até o dia em que um deles recusa.
 *
 * Escreve o caso simples e suficiente: 8 bits por canal, RGBA, sem
 * entrelaçamento, sem paleta. Ler PNG (que é bem mais trabalhoso, com os
 * filtros por linha) continua só no `gerar-icone.mjs`, que é quem precisa.
 */
import { deflateSync } from 'node:zlib';

/** Tabela de CRC-32 do PNG, calculada uma vez. */
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

/** Um pedaço do arquivo: tamanho, tipo+dados, e o CRC dos dois últimos. */
export function chunk(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(corpo));
  return Buffer.concat([len, corpo, crc]);
}

/**
 * Uma imagem quadrada em branco: `{w, px}`, com `px` em RGBA (4 bytes por
 * pixel, tudo zero = transparente).
 */
export const novaImagem = (w) => ({ w, px: new Uint8Array(w * w * 4) });

/** Pinta um pixel. Fora da imagem é ignorado, para o desenho não ter de checar. */
export function ponto(img, x, y, [r, g, b, a = 255]) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= img.w || y >= img.w) return;
  const i = (y * img.w + x) * 4;
  img.px[i] = r; img.px[i + 1] = g; img.px[i + 2] = b; img.px[i + 3] = a;
}

/**
 * Serializa a imagem quadrada `{w, px}` em PNG.
 *
 * Cada linha começa com o byte de filtro (0 = nenhum) — esquecê-lo produz um
 * arquivo que o zlib descomprime sem reclamar e que sai com as cores
 * embaralhadas, sem erro nenhum.
 */
export function png(img) {
  const { w, px } = img, n = w;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = 6;              // 8 bits, RGBA
  const bruto = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) {
    bruto[y * (n * 4 + 1)] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * n * 4, n * 4).copy(bruto, y * (n * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(bruto, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

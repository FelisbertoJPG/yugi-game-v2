// Decodificador de GIM (textura do PSP) -> PNG. Sem dependencia: zlib do Node.
//
// Arvore de blocos (LE):
//   00 uint16 tipo   02 uint16 -   04 uint32 tamanho
//   08 uint32 offset do proximo irmao   0C uint32 offset do dado
// tipos: 2=PICTURE 3=IMAGE 4=DADO DA IMAGEM 5=PALETA
//
// Cabecalho de 48 bytes do bloco 4/5 (confirmado em card_side/arrow_head, onde
// largura*altura*bpp/8 bate exatamente com o tamanho do bloco):
//   00 uint16 tamanho do cabecalho (0x30)   02 uint16 -
//   04 uint16 formato   06 uint16 swizzle   08 uint16 largura   0A uint16 altura
//   0C uint16 bits por pixel
// o dado comeca em (cabecalho + tamanho do cabecalho + 16): ha um bloco de 16
// bytes entre o cabecalho e os pixels, so' visivel conferindo tamanho x area.
import fs from 'node:fs';
import zlib from 'node:zlib';

// 0..3 sao formatos diretos; 4/5 sao indexados (a cor vem da paleta)
const BPP = { 0: 16, 1: 16, 2: 16, 3: 32, 4: 4, 5: 8, 6: 16, 7: 32 };

/** Desembaralha a textura: o PSP guarda em blocos de 16 bytes x 8 linhas. */
function unswizzle(src, larguraBytes, altura) {
  const dst = Buffer.alloc(larguraBytes * altura);
  const blocosPorLinha = larguraBytes >> 4;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < larguraBytes; x++) {
      const bloco = (y >> 3) * blocosPorLinha + (x >> 4);
      const origem = (bloco * 8 + (y & 7)) * 16 + (x & 15);
      dst[y * larguraBytes + x] = src[origem] ?? 0;
    }
  }
  return dst;
}

/** Converte um pixel do formato do PSP para RGBA de 8 bits. */
function pixel(fmt, v) {
  switch (fmt) {
    case 0: return [((v & 31) * 255 / 31) | 0, (((v >> 5) & 63) * 255 / 63) | 0, (((v >> 11) & 31) * 255 / 31) | 0, 255];           // RGB565
    case 1: return [((v & 31) * 255 / 31) | 0, (((v >> 5) & 31) * 255 / 31) | 0, (((v >> 10) & 31) * 255 / 31) | 0, (v >> 15) ? 255 : 0]; // RGBA5551
    case 2: return [((v & 15) * 17), (((v >> 4) & 15) * 17), (((v >> 8) & 15) * 17), (((v >> 12) & 15) * 17)];                       // RGBA4444
    case 3: return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];                                                     // RGBA8888
    default: return [0, 0, 0, 0];
  }
}

function blocos(b) {
  const achados = [];
  let off = 16;
  while (off + 16 <= b.length) {
    const tipo = b.readUInt16LE(off);
    const tam = b.readUInt32LE(off + 4);
    const prox = b.readUInt32LE(off + 8);
    const dado = b.readUInt32LE(off + 12);
    if (!tam || tam > b.length) break;
    if (tipo === 4 || tipo === 5) {
      const h = off + dado;
      achados.push({
        tipo,
        fmt: b.readUInt16LE(h + 4),
        swizzle: b.readUInt16LE(h + 6),
        w: b.readUInt16LE(h + 8),
        h: b.readUInt16LE(h + 10),
        dados: b.subarray(h + b.readUInt16LE(h) + 16, off + tam),
      });
    }
    // PICTURE/IMAGE so embrulham: desce pro filho
    off += (tipo === 2 || tipo === 3) ? 16 : (prox > 0 ? prox : tam);
  }
  return achados;
}

/** Decodifica o GIM e devolve {w, h, rgba}. */
export function decodeGim(b) {
  if (b.toString('latin1', 0, 8) !== 'MIG.00.1') throw new Error('nao e GIM');
  const bs = blocos(b);
  const img = bs.find((x) => x.tipo === 4);
  const pal = bs.find((x) => x.tipo === 5);
  if (!img) throw new Error('sem bloco de imagem');
  const { w, h, fmt } = img;
  const bpp = BPP[fmt] ?? 8;
  const larguraBytes = Math.max(16, (w * bpp) >> 3);
  let dados = img.dados;
  if (img.swizzle) dados = unswizzle(dados, larguraBytes, h);

  // paleta -> vetor de cores RGBA
  let cores = null;
  if (pal) {
    const pbpp = BPP[pal.fmt] ?? 32;
    const n = pal.w * Math.max(1, pal.h);
    cores = [];
    for (let i = 0; i < n; i++) {
      const v = pbpp === 32 ? pal.dados.readUInt32LE(i * 4) : pal.dados.readUInt16LE(i * 2);
      cores.push(pixel(pal.fmt, v));
    }
  }

  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c;
      if (fmt === 4) {          // indice de 4 bits (dois por byte, low nibble primeiro)
        const byte = dados[y * larguraBytes + (x >> 1)] ?? 0;
        c = cores?.[(x & 1) ? byte >> 4 : byte & 15] ?? [0, 0, 0, 0];
      } else if (fmt === 5) {   // indice de 8 bits
        c = cores?.[dados[y * larguraBytes + x] ?? 0] ?? [0, 0, 0, 0];
      } else {
        const off = y * larguraBytes + x * (bpp >> 3);
        const v = bpp === 32 ? (dados.readUInt32LE(off) >>> 0) : dados.readUInt16LE(off);
        c = pixel(fmt, v);
      }
      const o = (y * w + x) * 4;
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = c[3];
    }
  }
  return { w, h, rgba, fmt, swizzle: img.swizzle, cores: cores?.length ?? 0 };
}

// ---------- escrita de PNG (zlib do Node + CRC32 na mao) ----------
const TCRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let c = -1;
  for (const x of b) c = TCRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, crc]);
}
export function png(w, h, rgba) {
  const bruto = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    bruto[y * (w * 4 + 1)] = 0;                                    // filtro "none"
    rgba.copy(bruto, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(bruto)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function gimParaPng(entrada, saida) {
  const r = decodeGim(fs.readFileSync(entrada));
  fs.writeFileSync(saida, png(r.w, r.h, r.rgba));
  return r;
}

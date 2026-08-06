// Folha de contato: junta varios .gim num PNG so, em grade, sobre xadrez
// (pra transparencia aparecer). `node folha.mjs <saida.png> <celula> <gim>...`
import fs from 'node:fs';
import { decodeGim, png } from './gim.mjs';

const [saida, celStr, ...arqs] = process.argv.slice(2);
const CEL = Number(celStr) || 140;
const COLS = Math.min(6, arqs.length);
const LINHAS = Math.ceil(arqs.length / COLS);
const W = COLS * CEL, H = LINHAS * CEL;
const out = Buffer.alloc(W * H * 4);

// fundo xadrez
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const c = ((x >> 3) + (y >> 3)) & 1 ? 90 : 60;
    const o = (y * W + x) * 4;
    out[o] = out[o + 1] = out[o + 2] = c; out[o + 3] = 255;
  }
}

arqs.forEach((arq, i) => {
  let r;
  try { r = decodeGim(fs.readFileSync(arq)); } catch { return; }
  const cx = (i % COLS) * CEL, cy = Math.floor(i / COLS) * CEL;
  // encaixa mantendo proporcao, sem ampliar alem de 1x
  const esc = Math.min(1, (CEL - 8) / r.w, (CEL - 8) / r.h);
  const dw = Math.max(1, Math.round(r.w * esc)), dh = Math.max(1, Math.round(r.h * esc));
  const ox = cx + ((CEL - dw) >> 1), oy = cy + ((CEL - dh) >> 1);
  // Textura de efeito com alfa zerado em TODO pixel e RGB presente e' aditiva:
  // o jogo soma a cor no framebuffer. Compondo por alfa ela sumiria inteira.
  let temAlfa = false;
  for (let i = 3; i < r.rgba.length; i += 4) if (r.rgba[i]) { temAlfa = true; break; }
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const s = ((Math.floor(y / esc) * r.w) + Math.floor(x / esc)) * 4;
      const o = ((oy + y) * W + ox + x) * 4;
      if (temAlfa) {
        const a = r.rgba[s + 3] / 255;
        if (!a) continue;
        for (let k = 0; k < 3; k++) out[o + k] = Math.round(r.rgba[s + k] * a + out[o + k] * (1 - a));
      } else {
        for (let k = 0; k < 3; k++) out[o + k] = Math.min(255, out[o + k] + r.rgba[s + k]);
      }
    }
  }
});

fs.writeFileSync(saida, png(W, H, out));
console.log(`${saida}  ${W}x${H}  ${arqs.length} texturas, ${COLS} por linha:`);
arqs.forEach((a, i) => console.log(`  ${i % COLS === 0 ? '\n  ' : ''}${a.split(/[\\/]/).pop()}`.replace('\n  ', '\n   linha: ')));

// Sonda do EHF — o script de animacao do Tag Force.
//
// Cabecalho (LE), confirmado em varios exemplares: apos "EHF\x1a" + 12 zeros
// vem 5 pares (offset, tamanho) que LADRILHAM o arquivo inteiro — cada
// offset+tamanho cai exatamente no offset seguinte, e o ultimo fecha no
// tamanho do arquivo. E' assim que da' pra confiar na leitura sem chute.
//
// S0 (sempre 32 B) e' o cabecalho da animacao:
//   +0  uint32  duracao em quadros
//   +4  RGBA    cor de fundo/limpeza
//   +20 uint32  largura da tela   (9600 = 480 * 20)
//   +28 uint32  altura  da tela   (5440 = 272 * 20)
// => a unidade de coordenada e' 1/20 de pixel.
import fs from 'node:fs';

export const UNIDADE = 20;   // 1 pixel = 20 unidades

export function parseEhf(b) {
  if (b.toString('latin1', 0, 3) !== 'EHF') throw new Error('nao e EHF');
  const secoes = [];
  for (let i = 0; i < 5; i++) {
    secoes.push({ off: b.readUInt32LE(16 + i * 8), tam: b.readUInt32LE(16 + i * 8 + 4) });
  }
  const s0 = secoes[0].off;
  return {
    tamanho: b.length,
    secoes,
    ladrilha: secoes.every((s, i) => (i === 4 ? s.off + s.tam === b.length : s.off + s.tam <= secoes[i + 1].off)),
    duracao: b.readUInt32LE(s0),
    cor: [...b.subarray(s0 + 4, s0 + 8)],
    largura: b.readUInt32LE(s0 + 20) / UNIDADE,
    altura: b.readUInt32LE(s0 + 28) / UNIDADE,
  };
}

/** Um float32 "plausivel" como valor de animacao (posicao, escala, alfa). */
function comoFloat(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 1e-4 || a > 1e7 || !Number.isFinite(v)) return null;
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

function despeja(b, off, tam, rotulo, porLinha = 16) {
  const linhas = [`  ${rotulo}  off=${off} tam=${tam}`];
  for (let i = 0; i < tam; i += porLinha) {
    const fatia = b.subarray(off + i, off + Math.min(i + porLinha, tam));
    const hex = [...fatia].map((x) => x.toString(16).padStart(2, '0')).join(' ');
    const cols = [];
    for (let j = 0; j + 4 <= fatia.length; j += 4) {
      const iv = fatia.readInt32LE(j);
      const fv = comoFloat(fatia.readFloatLE(j));
      // mostra o float so' quando ele e' mais plausivel que o inteiro cru
      cols.push(fv !== null && Math.abs(iv) > 1e6 ? `${fv}f` : String(iv));
    }
    linhas.push(`    ${String(off + i).padStart(6)}  ${hex.padEnd(porLinha * 3)} ${cols.join('  ')}`);
  }
  return linhas.join('\n');
}

if (process.argv[1].endsWith('ehf.mjs')) {
  for (const p of process.argv.slice(2)) {
    const b = fs.readFileSync(p);
    const e = parseEhf(b);
    console.log(`\n### ${p.split(/[\\/]/).pop()}  ${b.length} B  ladrilha=${e.ladrilha}`);
    console.log(`  duracao=${e.duracao} quadros   tela=${e.largura}x${e.altura}   cor=${e.cor}`);
    console.log(`  secoes: ${e.secoes.map((s, i) => `S${i}=${s.off},${s.tam}`).join('  ')}`);
    for (let i = 0; i < 5; i++) {
      const s = e.secoes[i];
      // S3 costuma ser o maior; mostra so' o comeco pra nao inundar
      const lim = s.tam;
      console.log(despeja(b, s.off, lim, `S${i}`));
      if (lim < s.tam) console.log(`    ... (+${s.tam - lim} B)`);
    }
  }
}

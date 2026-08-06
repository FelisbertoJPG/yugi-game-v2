// Colhe a DURACAO de toda animacao .ehf extraida e imprime em quadros e em
// milissegundos. O PSP roda a 59.94 Hz; o Tag Force anima a tela de duelo em
// 30 fps (um quadro de animacao a cada dois de video), entao a conversao
// padrao aqui e' 1 quadro = 1000/30 ms. Passe outro fps como 2o argumento.
//
// So' reporta arquivo cujo cabecalho LADRILHA o tamanho todo — se as 5 secoes
// nao fecham exatamente no fim, a leitura nao e' confiavel e o numero seria
// chute. Sem essa checagem um EHF de outro formato passaria despercebido.
import fs from 'node:fs';
import path from 'node:path';
import { parseEhf } from './ehf.mjs';

const RAIZ = process.argv[2];
const FPS = Number(process.argv[3]) || 30;
if (!RAIZ) {
  console.error('uso: node timing.mjs <pasta-extraida> [fps=30]');
  process.exit(1);
}

function varre(dir, saida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) varre(p, saida);
    else if (e.name.endsWith('.ehf')) saida.push(p);
  }
  return saida;
}

const linhas = [];
let ok = 0, ruim = 0;
for (const p of varre(RAIZ)) {
  let e;
  try { e = parseEhf(fs.readFileSync(p)); } catch { ruim++; continue; }
  if (!e.ladrilha) { ruim++; continue; }
  ok++;
  const rel = path.relative(RAIZ, p).replace(/\\/g, '/');
  linhas.push({ rel, q: e.duracao, ms: Math.round(e.duracao * 1000 / FPS), tela: `${e.largura}x${e.altura}` });
}

linhas.sort((a, b) => a.q - b.q);
console.log(`arquivo${' '.repeat(52)}quadros     ms`);
for (const l of linhas) console.log(`${l.rel.padEnd(58)}${String(l.q).padStart(5)}${String(l.ms).padStart(8)}`);
console.log(`\n${ok} animacoes lidas, ${ruim} recusadas (cabecalho nao ladrilha)`);
const telas = [...new Set(linhas.map((l) => l.tela))];
console.log(`resolucoes vistas: ${telas.join(', ')}`);

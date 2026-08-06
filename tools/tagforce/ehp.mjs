// Desempacotador de EHP — o formato de pacote da Konami no Tag Force (PSP).
//
// Layout (little-endian), deduzido comparando 4 exemplares de tamanhos bem
// diferentes; o campo de tamanho total bate exatamente com o arquivo nos 4:
//
//   00  char[4]   "EHP\x03"
//   04  uint32    tamanho total do arquivo
//   08  char[4]   tag de compressao — "NOT " = cru
//   12  uint32    quantidade de entradas
//   16  uint32[2] por entrada: (offset do nome, offset do dado)
//       ...       depois das entradas, 8 bytes zerados de terminador
//
//   no offset do nome:  "<nome>\0" seguido de uint32 com o TAMANHO do dado
//   o dado fica alinhado em 16 bytes
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function parseEhp(buf) {
  if (buf.toString('latin1', 0, 3) !== 'EHP') throw new Error('nao e EHP');
  const out = {
    versao: buf[3],
    tamanho: buf.readUInt32LE(4),
    tag: buf.toString('latin1', 8, 12),
    entradas: [],
  };
  const n = buf.readUInt32LE(12);
  for (let i = 0; i < n; i++) {
    const nomeOff = buf.readUInt32LE(16 + i * 8);
    const dadoOff = buf.readUInt32LE(16 + i * 8 + 4);
    if (!nomeOff || nomeOff >= buf.length) continue;
    let fim = nomeOff;
    while (fim < buf.length && buf[fim] !== 0) fim++;
    const nome = buf.toString('latin1', nomeOff, fim);
    // o uint32 do tamanho vem logo depois do \0 do nome
    const tam = fim + 5 <= buf.length ? buf.readUInt32LE(fim + 1) : 0;
    out.entradas.push({ nome, off: dadoOff, tam, dado: buf.subarray(dadoOff, dadoOff + tam) });
  }
  return out;
}

/** Descompacta .gz transparentemente (varios .ehp do ISO vem como .ehp.gz). */
export function lerArquivo(p) {
  const b = fs.readFileSync(p);
  return p.endsWith('.gz') ? zlib.gunzipSync(b) : b;
}

/** Assina o conteudo de uma entrada pelos magic bytes conhecidos. */
export function tipoDe(d) {
  if (d.length < 4) return 'vazio';
  const a4 = d.toString('latin1', 0, 4);
  const a8 = d.toString('latin1', 0, 8);
  if (a8 === 'MIG.00.1') return 'GIM (textura PSP)';
  if (a4 === 'EHP\x03') return 'EHP (pacote aninhado)';
  if (a4.startsWith('CPM')) return 'CIP (pacote de imagem de carta)';
  if (d[0] === 0x1f && d[1] === 0x8b) return 'gzip';
  if (a4 === 'RIFF') return 'RIFF';
  if (a4 === '\x89PNG') return 'PNG';
  if (a4 === 'OMG.') return 'OMG (audio)';
  if (a4 === 'PSMF') return 'PSMF (video)';
  if (a4 === '\x7fELF') return 'ELF/PRX';
  if (a4 === 'MPK\0') return 'MPK';
  // texto puro?
  const amostra = d.subarray(0, Math.min(256, d.length));
  let imprimivel = 0;
  for (const b of amostra) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) imprimivel++;
  if (imprimivel / amostra.length > 0.95) return 'texto';
  return `? (${[...d.subarray(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join(' ')})`;
}

if (process.argv[1].endsWith('ehp.mjs')) {
  const alvo = process.argv[2];
  const destino = process.argv[3];
  const pac = parseEhp(lerArquivo(alvo));
  console.log(`${path.basename(alvo)}  v${pac.versao}  tag="${pac.tag}"  ${pac.entradas.length} entradas  ${pac.tamanho} bytes\n`);
  const contagem = {};
  for (const e of pac.entradas) {
    const t = tipoDe(e.dado);
    contagem[t] = (contagem[t] || 0) + 1;
    if (!destino) console.log(`${String(e.tam).padStart(9)}  ${e.nome.padEnd(28)}  ${t}`);
    else {
      const d = path.join(destino, e.nome);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.writeFileSync(d, e.dado);
    }
  }
  console.log('\ntipos:', contagem);
  if (destino) console.log(`extraido em ${destino}`);
}

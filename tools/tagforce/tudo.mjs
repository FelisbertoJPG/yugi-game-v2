// Pipeline completo: ISO -> todo .ehp -> todo .gim -> .png, num destino so'.
// Deixa o resto (.tms/.tma/.tmt/.ehf/.bin) cru, pra inspecao posterior.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { openIso, pvd, walk } from './iso.mjs';
import { parseEhp } from './ehp.mjs';
import { decodeGim, png } from './gim.mjs';
import { isoPath } from './alvo.mjs';

const DESTINO = process.argv[2];
const FILTRO = process.argv[3] || '';
if (!DESTINO) {
  console.error('uso: node tudo.mjs <pasta-destino> [filtro]\n'
    + 'NAO aponte o destino para dentro do repo — sao assets da Konami e o repo e versionado.');
  process.exit(1);
}

const iso = openIso(isoPath());
const arquivos = walk(iso, pvd(iso).root).filter((e) => !e.isDir && e.path.includes(FILTRO));

const cont = { ehp: 0, gim: 0, png: 0, cru: 0, erro: 0 };
const dims = [];

for (const f of arquivos) {
  let buf = Buffer.alloc(f.size);
  fs.readSync(iso.fd, buf, 0, f.size, f.lba * 2048);
  if (f.path.endsWith('.gz')) { try { buf = zlib.gunzipSync(buf); } catch { /* nao era gzip */ } }
  const base = path.join(DESTINO, f.path.replace(/^\/PSP_GAME\/USRDIR\//, '').replace(/\.gz$/, ''));

  if (buf.toString('latin1', 0, 3) !== 'EHP') continue;   // so' os pacotes
  cont.ehp++;
  let pac;
  try { pac = parseEhp(buf); } catch { cont.erro++; continue; }

  for (const e of pac.entradas) {
    const destino = path.join(base.replace(/\.ehp$/, ''), e.nome);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    if (e.nome.endsWith('.gim')) {
      cont.gim++;
      try {
        const r = decodeGim(e.dado);
        fs.writeFileSync(destino.replace(/\.gim$/, '.png'), png(r.w, r.h, r.rgba));
        let temAlfa = false;
        for (let i = 3; i < r.rgba.length; i += 4) if (r.rgba[i]) { temAlfa = true; break; }
        dims.push(`${f.path.split('/').pop().replace(/\.ehp$/, '')}/${e.nome}\t${r.w}x${r.h}\tfmt${r.fmt}\t${temAlfa ? 'alfa' : 'ADITIVA'}`);
        cont.png++;
      } catch { fs.writeFileSync(destino, e.dado); cont.erro++; }
    } else {
      fs.writeFileSync(destino, e.dado);
      cont.cru++;
    }
  }
}

fs.writeFileSync(path.join(DESTINO, '_texturas.tsv'), dims.join('\n'));
console.log(cont);
console.log(`aditivas (blend somado): ${dims.filter((d) => d.endsWith('ADITIVA')).length} de ${dims.length}`);
console.log(`-> ${DESTINO}`);

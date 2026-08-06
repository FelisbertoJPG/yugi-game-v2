// Parser mínimo de ISO 9660 — lista a árvore de arquivos de um ISO de PSP.
// Sem dependência: só fs. Setor = 2048 bytes, PVD no setor 16 (0x8000).
import fs from 'node:fs';

const SECTOR = 2048;

export function openIso(path) {
  const fd = fs.openSync(path, 'r');
  const read = (off, len) => {
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, off);
    return b;
  };
  return { fd, read, size: fs.statSync(path).size };
}

/** Lê o Primary Volume Descriptor e devolve o registro do diretório raiz. */
export function pvd(iso) {
  const b = iso.read(16 * SECTOR, SECTOR);
  if (b.toString('latin1', 1, 6) !== 'CD001') throw new Error('não é ISO 9660 (falta CD001)');
  return {
    volumeId: b.toString('latin1', 40, 72).trim(),
    volumeSpaceSize: b.readUInt32LE(80),
    root: parseRecord(b, 156).rec,
  };
}

/** Um registro de diretório ISO 9660. Devolve {rec, len}; len=0 marca fim do setor. */
function parseRecord(b, off) {
  const len = b[off];
  if (!len) return { rec: null, len: 0 };
  const idLen = b[off + 32];
  let name = b.toString('latin1', off + 33, off + 33 + idLen);
  // 0x00 = ".", 0x01 = ".."; o resto pode vir com ";1" de versão
  if (idLen === 1 && name.charCodeAt(0) === 0) name = '.';
  else if (idLen === 1 && name.charCodeAt(0) === 1) name = '..';
  else name = name.replace(/;\d+$/, '');
  return {
    len,
    rec: {
      name,
      lba: b.readUInt32LE(off + 2),
      size: b.readUInt32LE(off + 10),
      isDir: !!(b[off + 25] & 0x02),
    },
  };
}

/** Lista o conteúdo de um diretório (pulando "." e ".."). */
export function readDir(iso, rec) {
  const out = [];
  const data = iso.read(rec.lba * SECTOR, Math.ceil(rec.size / SECTOR) * SECTOR);
  let off = 0;
  while (off < rec.size) {
    // Um registro nunca cruza a fronteira do setor: byte 0 zerado = pula pro próximo.
    const r = parseRecord(data, off);
    if (!r.len) {
      off = (Math.floor(off / SECTOR) + 1) * SECTOR;
      continue;
    }
    if (r.rec.name !== '.' && r.rec.name !== '..') out.push(r.rec);
    off += r.len;
  }
  return out;
}

/** Percorre a árvore inteira, devolvendo caminhos achatados. */
export function walk(iso, rec, prefix = '') {
  const out = [];
  for (const e of readDir(iso, rec)) {
    const path = `${prefix}/${e.name}`;
    if (e.isDir) {
      out.push({ ...e, path });
      out.push(...walk(iso, e, path));
    } else {
      out.push({ ...e, path });
    }
  }
  return out;
}

export function extract(iso, rec, dest) {
  const b = iso.read(rec.lba * SECTOR, rec.size);
  fs.writeFileSync(dest, b);
  return b;
}

if (process.argv[1].endsWith('iso.mjs')) {
  const iso = openIso(process.argv[2]);
  const v = pvd(iso);
  console.log(`volume: ${v.volumeId}  setores: ${v.volumeSpaceSize}  arquivo: ${iso.size} bytes\n`);
  const all = walk(iso, v.root);
  const dirs = all.filter((e) => e.isDir);
  const files = all.filter((e) => !e.isDir);
  console.log(`${dirs.length} diretórios, ${files.length} arquivos\n`);
  for (const e of all.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`${e.isDir ? '     <dir>' : String(e.size).padStart(10)}  ${e.path}`);
  }
}

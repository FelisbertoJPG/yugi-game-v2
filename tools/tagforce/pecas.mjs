/**
 * Extrai a **BIBLIOTECA DE PEÇAS** que o editor de cena usa.
 *
 * ```bash
 * node tools/tagforce/pecas.mjs "C:\...\PSP_GAME"          # tudo
 * node tools/tagforce/pecas.mjs "C:\...\PSP_GAME" --min 8  # só o que tem 8+ triângulos
 * ```
 *
 * ## De onde saem as peças
 *
 * **Não existe biblioteca de objetos avulsos no jogo** — medido: dos 170 TGMS,
 * 13 abrem, e 6 deles são mapas inteiros. As peças saem de FATIAR cada mapa
 * pela tabela de objetos que o próprio formato traz: `bg_01_01` vira 23 peças
 * (uma caixa, a escada, as vigas, o gramado), com mediana de 32 triângulos.
 *
 * > **O limite honesto:** os objetos do TGMS são agrupados por MATERIAL, não
 * > por objeto físico. "Todo o gramado do mapa" é uma peça só, e "todas as
 * > madeiras" é outra. Das 152 peças, ~100 têm tamanho de móvel e servem como
 * > peça; o resto são pedaços grandes de cenário. É o que dá para extrair sem
 * > modelar — não é uma biblioteca curada.
 *
 * ## O que ele grava, e por que assim
 *
 * ```
 * web/pecas/catalogo.json     metadados de TODAS as peças (alguns KB)
 * web/pecas/p/<id>.json       a malha de UMA peça, sob demanda
 * web/pecas/tex/<slug>.png    a textura, como PNG de verdade
 * ```
 *
 * Três decisões, e cada uma responde a um desperdício medido:
 *
 * - **a malha é um arquivo por peça**, e não tudo num só: o editor abre com o
 *   catálogo (leve), e o Mundo baixa só as peças que a cena usa. Um pacotão de
 *   5,5 MB faria todo jogador pagar por 152 peças para ver as oito que estão
 *   na tela.
 * - **a textura é PNG de verdade**, e não `data:` URL dentro do JSON. Ela é
 *   COMPARTILHADA entre peças (dezenas usam a mesma madeira), então embutir
 *   duplicaria a mesma arte em cada arquivo — e base64 ainda custa +33% sobre
 *   o binário. Como arquivo, o navegador também a cacheia entre cenas.
 * - **a malha é SOLDADA** (`soldar`, em `tms.mjs`): −56% de vértices e −53% de
 *   bytes, medido no dormitório, mais 602 triângulos degenerados jogados fora.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPacote, lerTgms, soldar } from './tms.mjs';
import { png } from './gim.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESTINO = path.join(RAIZ, 'web', 'pecas');

const args = process.argv.slice(2);
const origem = args.find((a) => !a.startsWith('--'));
const minTri = args.includes('--min') ? Number(args[args.indexOf('--min') + 1]) : 4;

if (!origem) {
  console.error('uso: node tools/tagforce/pecas.mjs <pasta do PSP_GAME> [--min <triangulos>]');
  process.exit(2);
}
if (!fs.existsSync(origem)) { console.error('nao achei: ' + origem); process.exit(2); }

const varrer = (d, s = []) => (fs.readdirSync(d, { withFileTypes: true })
  .forEach((e) => (e.isDirectory() ? varrer(path.join(d, e.name), s) : s.push(path.join(d, e.name)))), s);

const slug = (s) => s.toLowerCase().replace(/\.(tga|tms)$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

fs.rmSync(DESTINO, { recursive: true, force: true });
fs.mkdirSync(path.join(DESTINO, 'p'), { recursive: true });
fs.mkdirSync(path.join(DESTINO, 'tex'), { recursive: true });

const catalogo = [];
const texturasGravadas = new Map();     // nome .tga -> slug do png
let mapas = 0, puladas = 0, bytesAntes = 0, bytesDepois = 0, vertAntes = 0, vertDepois = 0, degen = 0;

for (const arq of varrer(origem).filter((f) => f.toLowerCase().endsWith('.ehp'))) {
  let pk;
  try { pk = abrirPacote(fs.readFileSync(arq)); } catch { continue; }
  for (const t of pk.tms) {
    const lido = lerTgms(t.buf, { arte: pk.arte });
    if (!lido.ok) continue;
    mapas++;
    const base = slug(t.nome);

    for (const peca of lido.pecas) {
      // Peça minúscula é lixo do formato: um quad de dois triângulos que era um
      // decalque, um marcador invisível. Ela entulharia a gaveta do editor com
      // dezenas de itens que ninguém vai colocar.
      if (peca.triangulos < minTri) { puladas++; continue; }

      const s = soldar(peca);
      vertAntes += s.antes; vertDepois += s.depois; degen += s.degenerados;
      if (!s.idx.length) { puladas++; continue; }

      // a textura, uma vez só, compartilhada entre todas as peças que a usam
      let tex = null;
      if (peca.textura && peca.imagem) {
        tex = texturasGravadas.get(peca.textura) ?? null;
        if (!tex) {
          tex = slug(peca.textura);
          fs.writeFileSync(path.join(DESTINO, 'tex', tex + '.png'),
            png(peca.imagem.w, peca.imagem.h, peca.imagem.rgba));
          texturasGravadas.set(peca.textura, tex);
        }
      }

      const id = `${base}-${String(peca.objeto).padStart(2, '0')}`;
      const corpo = JSON.stringify({ id, tex, idx: s.idx, pos: s.pos, nor: s.nor, uv: s.uv });
      fs.writeFileSync(path.join(DESTINO, 'p', id + '.json'), corpo);

      bytesAntes += JSON.stringify({ pos: peca.pos, nor: peca.nor, uv: peca.uv }).length;
      bytesDepois += corpo.length;

      catalogo.push({
        id,
        mapa: base,
        tri: s.idx.length / 3,
        dim: peca.dim.map((v) => Math.round(v * 10) / 10),
        tex,
      });
    }
  }
}

catalogo.sort((a, b) => a.tri - b.tri);
fs.writeFileSync(path.join(DESTINO, 'catalogo.json'),
  JSON.stringify({ gerado: new Date().toISOString().slice(0, 10), pecas: catalogo }));

const tamPasta = varrer(DESTINO).reduce((a, f) => a + fs.statSync(f).size, 0);
console.log('mapas lidos    :', mapas);
console.log('PECAS gravadas :', catalogo.length, '| puladas (< ' + minTri + ' triangulos):', puladas);
console.log('texturas       :', texturasGravadas.size);
console.log('triangulos     :', catalogo.reduce((a, p) => a + p.tri, 0).toLocaleString('pt-BR'));
console.log();
console.log('a SOLDA        : %d -> %d vertices (-%d%%), %d degenerados fora',
  vertAntes, vertDepois, Math.round((1 - vertDepois / vertAntes) * 100), degen);
console.log('malha em bytes : %s KB -> %s KB (-%d%%)',
  Math.round(bytesAntes / 1024), Math.round(bytesDepois / 1024),
  Math.round((1 - bytesDepois / bytesAntes) * 100));
console.log();
console.log('web/pecas/     : %s KB no total (catalogo + malhas + texturas)', Math.round(tamPasta / 1024));
console.log('o editor abre em /web/cena.html');

/**
 * Extrai um mapa do Tag Force e grava o pacote que o **Mundo** sabe carregar.
 *
 * ```bash
 * node tools/tagforce/mapa.mjs "C:\...\PSP_GAME\USRDIR\field\map\bg_01_01.ehp"
 * node tools/tagforce/mapa.mjs <arquivo.ehp> --nome dormitorio
 * ```
 *
 * O destino é **`web/cenarios/`**, e isso é uma decisão, não um detalhe: o
 * pacote `game` leva `web/` inteiro (`Copy-Item -Recurse`), então o cenário
 * viaja para quem joga. Enquanto ele era experimento o destino era `store/`,
 * que o Release NÃO leva (a allowlist de `UpdateEngine.GlobaisPermitidos` tem
 * cinco `.json` nominais) — bom para provar, inútil para publicar.
 *
 * > **Faltar continua sendo normal**: sem o arquivo, o Mundo desenha a floresta
 * > de sempre e o custo é uma requisição que dá 404. A mesma lei do
 * > `modelos.js`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPacote, lerTgms, paraOMundo } from './tms.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const ehp = args.find((a) => !a.startsWith('--'));
const nomeArg = args.includes('--nome') ? args[args.indexOf('--nome') + 1] : null;

if (!ehp) {
  console.error('uso: node tools/tagforce/mapa.mjs <arquivo.ehp> [--nome <slug>]');
  process.exit(2);
}
if (!fs.existsSync(ehp)) { console.error('nao achei: ' + ehp); process.exit(2); }

const { tms, arte } = abrirPacote(fs.readFileSync(ehp));
if (!tms.length) { console.error('este .ehp nao tem malha (.tms) dentro'); process.exit(1); }

// o mapa e' a maior malha do pacote; as outras sao portas, caixas, detalhes
const alvo = tms.sort((a, b) => b.buf.length - a.buf.length)[0];
const slug = (nomeArg || path.basename(ehp, '.ehp')).toLowerCase().replace(/[^a-z0-9-]+/g, '-');

console.log('pacote :', path.basename(ehp), '(' + tms.length + ' malhas)');
console.log('malha  :', alvo.nome, '(' + (alvo.buf.length / 1024).toFixed(0) + ' KB)');

const lido = lerTgms(alvo.buf, { arte });
if (!lido.ok) { console.error('  RECUSADO: ' + lido.motivo); process.exit(1); }

const tam = [0, 1, 2].map((e) => (lido.caixa.max[e] - lido.caixa.min[e]).toFixed(1));
console.log('caixa  :', tam.join(' x '), 'unidades | erro contra o gabarito:', lido.erro.toFixed(5));
console.log('malha  :', lido.triangulos.toLocaleString('pt-BR'), 'triangulos,',
  lido.grupos.length, 'grupos,', lido.texturas, 'texturas');
const sem = lido.grupos.filter((g) => g.textura && !g.imagem);
if (sem.length) console.log('  ! ' + sem.length + ' textura(s) sem arte no .ehp:', sem.map((g) => g.textura).join(', '));

const pacote = paraOMundo(lido, { nome: alvo.nome });
const destino = path.join(RAIZ, 'web', 'cenarios', `${slug}.json`);
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(pacote));
console.log('\ngravado:', path.relative(RAIZ, destino),
  '(' + (fs.statSync(destino).size / 1048576).toFixed(1) + ' MB)');
console.log('o Mundo carrega sozinho no proximo boot; sem o arquivo, a floresta de sempre.');

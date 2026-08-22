/**
 * Cruza o CATÁLOGO de ícones publicado com as imagens do REPOSITÓRIO.
 *
 *   node tools/conferir-icones.mjs
 *
 * Por que existe: a imagem do ícone mora em `web/img/icones/` e viaja no
 * `game.zip`; o banco guarda só o **nome do arquivo**. As duas metades não se
 * enxergam — o banco não lê o disco, e o navegador não lista pastas —, então
 * um ícone cadastrado cuja arte nunca foi publicada é um quadrado vazio na tela
 * de quem joga, sem erro em lugar nenhum.
 *
 * É a mesma família de furo do `boosters:check` (carta vendida e injogável) e
 * do `conteudo:check` (edição que ficou só em disco): duas verdades que
 * precisam concordar e nada obrigando.
 *
 * A leitura é do BANCO (a verdade viva), não de um espelho local. Só lê, não
 * escreve nada; a chave é a publishable, a mesma que vai no jogo.
 *
 * Sai com código 1 quando algo está fora do lugar, para poder entrar num
 * script de publicação quando fizer sentido.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_BASE = 'https://shclhlbfkdnnqxboiuqc.supabase.co';
const KEY = 'sb_publishable_FxGEPSbXqJEBBUqG9ugJ6w_3z5AaVzC';
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const vermelho = (t) => `\x1b[31m${t}\x1b[0m`;
const amarelo = (t) => `\x1b[33m${t}\x1b[0m`;

async function catalogo() {
  const r = await fetch(`${URL_BASE}/rest/v1/icones?select=*&order=ordem,nome`,
                        { headers: { apikey: KEY } });
  if (!r.ok) throw new Error(`icones: HTTP ${r.status}`);
  return r.json();
}

/**
 * O manifesto é a lista que o jogo enxerga — e não o `readdir` da pasta.
 *
 * A diferença importa: quem viaja no `game.zip` é o que o `release:build`
 * empacota, e o painel do admin oferece o que está no manifesto. Um PNG solto
 * na pasta e ausente do `index.json` está no disco de quem desenvolve e em
 * lugar nenhum além disso — conferir contra o `readdir` diria que está tudo
 * bem justamente no caso que quebra.
 */
async function manifesto() {
  const caminho = join(ROOT, 'web', 'img', 'icones', 'index.json');
  try {
    const m = JSON.parse(await readFile(caminho, 'utf8'));
    return Array.isArray(m?.arquivos) ? m.arquivos : [];
  } catch {
    return null;
  }
}

const icones = await catalogo();
const arquivos = await manifesto();

console.log(`\n  catalogo: ${icones.length} icone(s) publicado(s)`);

if (arquivos === null) {
  console.log(vermelho('  nao achei web/img/icones/index.json'));
  console.log('  rode `node tools/icones.mjs` para gerar o manifesto.\n');
  process.exit(1);
}
console.log(`  repositorio: ${arquivos.length} arquivo(s) no manifesto\n`);

const tem = new Set(arquivos.map(String));
const usados = new Set();
let problemas = 0;

for (const i of icones) {
  const ok = tem.has(String(i.arquivo));
  if (ok) usados.add(String(i.arquivo));
  else problemas++;
  const etiquetas = [
    i.gratuito ? 'gratuito' : null,
    i.na_loja ? `loja ${i.preco} DP` : null,
    i.raridade,
  ].filter(Boolean).join(' · ');
  console.log(`  ${ok ? verde('OK   ') : vermelho('FALTA')} ${i.id} — ${i.arquivo}  (${etiquetas})`);
  if (!ok) console.log(`         a imagem nao esta em web/img/icones/`);
}

// Arte no repositório que ninguém cadastrou não é erro — é arte esperando virar
// ícone. Vale dizer, mas não muda o código de saída.
const sobrando = arquivos.filter((f) => !usados.has(String(f)));
if (sobrando.length) {
  console.log(`\n  ${amarelo('sem cadastro')}: ${sobrando.join(', ')}`);
  console.log('  sao arquivos no repositorio que nenhum icone usa (nao e erro).');
}

if (problemas) {
  console.log(vermelho(`\n  ${problemas} icone(s) com a imagem faltando.`));
  console.log('  Quem joga ve um quadrado vazio no lugar do icone, sem erro nenhum.');
  console.log('  Ponha o PNG em web/img/icones/, rode `node tools/icones.mjs`');
  console.log('  e publique (`npm run release:build` + publicar) — a imagem viaja no game.zip.\n');
  process.exit(1);
}

if (!icones.length) {
  console.log(amarelo('  nenhum icone cadastrado ainda.'));
  console.log('  Cadastre em web/icones.html (Area de Teste), logado como admin.\n');
} else {
  console.log(verde('\n  OK: todo icone do catalogo tem imagem no repositorio.\n'));
}

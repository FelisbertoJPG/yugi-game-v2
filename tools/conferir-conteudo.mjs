/**
 * **O que o admin editou chegou mesmo ao banco?**
 *
 *     npm run conteudo:check
 *
 * Conteúdo do jogo (banlist, boosters, adversários, pool de drop, listas de
 * cartas, decks de NPC, tabuleiros) é editado na Área de Teste e publicado no
 * Supabase — é de lá que TODO cliente lê, e é o único caminho pelo qual uma
 * alteração alcança o `.exe` de outra pessoa sem publicar Release nenhum.
 *
 * A gravação é `fire-and-forget` de propósito (as telas gravam a cada tecla e
 * não podem esperar a rede), e por isso uma recusa do banco — 403 de quem não é
 * admin, sessão vencida, rede caída — deixava a edição valendo SÓ na máquina de
 * quem editou, com a tela dizendo "salvo". O aviso na tela agora existe
 * (`projectstore.js`), mas ele só aparece na hora; este comando responde a outra
 * pergunta, a que se faz depois: **está tudo publicado agora?**
 *
 * Compara o espelho em disco com o que está no banco e lista o que diverge.
 * Leitura pública (a policy de `conteudo`/`decks_npc`/`tabuleiros` é aberta),
 * então roda sem login e sem segredo nenhum.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const URL_BASE = 'https://shclhlbfkdnnqxboiuqc.supabase.co';
const CHAVE = lerChavePublica();

/** A chave pública (anon) mora no `web/js/supabase.js` — uma cópia só. */
function lerChavePublica() {
  const src = readFileSync('web/js/supabase.js', 'utf8');
  const m = src.match(/SUPABASE_KEY\s*=\s*'([^']+)'/) || src.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('não achei SUPABASE_KEY em web/js/supabase.js');
  return m[1];
}

async function banco(caminho) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    headers: { apikey: CHAVE, authorization: `Bearer ${CHAVE}` },
  });
  if (!r.ok) throw new Error(`${caminho} -> HTTP ${r.status}`);
  return r.json();
}

/** Compara ignorando ordem de chave e espaço — é JSON, não texto. */
const igual = (a, b) => estavel(a) === estavel(b);
function estavel(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
}

// As raízes possíveis do espelho em disco: o repositório e o jogo instalado.
// Quem edita jogando mexe no INSTALADO, e é lá que a divergência aparece.
const RAIZES = [
  { nome: 'repo', dir: '.' },
  { nome: 'instalado', dir: join(process.env.LOCALAPPDATA ?? '', 'ClassicDuels', 'game') },
].filter((r) => r.dir && existsSync(r.dir));

let problemas = 0;
const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m   ${m}`);
const falha = (m) => { problemas++; console.log(`  \x1b[31mFALTA\x1b[0m ${m}`); };
const nota = (m) => console.log(`  ..   ${m}`);
const velho = (m) => console.log(`  [33mvelho[0m ${m}`);

/**
 * **Divergir do banco NÃO é problema; faltar no banco é.**
 *
 * O disco é ESPELHO e o banco é a FONTE — o jogo lê de lá, e é de lá que o
 * `.exe` de outra pessoa lê. Um arquivo local diferente quase sempre é só um
 * espelho velho: a semente que veio dentro do exe, ou uma cópia que ficou para
 * trás. O sinal que importa, e o único sem ambiguidade, é o que existe SÓ aqui:
 * um deck ou tabuleiro que nunca chegou ao banco não existe para mais ninguém.
 *
 * (Já houve aqui uma tentativa de adivinhar o lado pela data do arquivo. Ela
 * mente: a extração do payload grava todo o `store/` com a data da INSTALAÇÃO,
 * então metade do espelho aparecia como "edição não publicada".)
 */

console.log('\n  ####  O CONTEUDO EDITADO ESTA PUBLICADO?  ####\n');
console.log(`  banco: ${URL_BASE}`);
for (const r of RAIZES) console.log(`  disco: ${r.nome} -> ${r.dir}`);
console.log('');

// ---------------------------------------------------------------- conteudo
const linhas = await banco('conteudo?select=chave,dados,atualizado_em');
const noBanco = new Map(linhas.map((l) => [l.chave, l.dados]));
console.log(`  [1] conteudo (${linhas.length} chave(s) no banco)`);
for (const l of linhas.sort((a, b) => a.chave.localeCompare(b.chave))) {
  nota(`${l.chave} — publicado em ${String(l.atualizado_em).replace('T', ' ').slice(0, 19)}`);
}

for (const raiz of RAIZES) {
  const dirStore = join(raiz.dir, 'store');
  if (!existsSync(dirStore)) continue;
  for (const arq of readdirSync(dirStore).filter((f) => f.endsWith('.json'))) {
    const chave = arq.replace(/\.json$/, '');
    // store/ também guarda coisa que NÃO é conteúdo publicado (a carteira, as
    // sessões, as contas): só confere o que o banco conhece como chave.
    if (!noBanco.has(chave) && !/^lista/.test(chave)) continue;
    let disco;
    try { disco = JSON.parse(readFileSync(join(dirStore, arq), 'utf8')); } catch { continue; }
    if (igual(disco, noBanco.get(chave))) ok(`${chave} (${raiz.nome}) bate com o banco`);
    else velho(`${chave} (${raiz.nome}) — espelho diferente do banco (o jogo le do banco)`);
  }
}

// ------------------------------------------------------------- decks de NPC
console.log('\n  [2] decks de NPC');
const decks = await banco('decks_npc?select=npc,nome,ydk,atualizado_em');
nota(`${decks.length} deck(s) no banco`);
const idsDoYdk = (t) => (t.match(/^\s*\d+\s*$/gm) ?? []).map((s) => s.trim()).join(',');
for (const raiz of RAIZES) {
  const dir = join(raiz.dir, 'decks', 'npc');
  if (!existsSync(dir)) continue;
  for (const npc of readdirSync(dir)) {
    const pasta = join(dir, npc);
    if (!statSync(pasta).isDirectory()) continue;
    for (const arq of readdirSync(pasta).filter((f) => f.endsWith('.ydk'))) {
      const nome = arq.replace(/\.ydk$/, '');
      const noBanco2 = decks.find((d) => d.npc === npc && d.nome === nome);
      if (!noBanco2) { falha(`${npc}/${nome} (${raiz.nome}) NAO existe no banco`); continue; }
      const local = readFileSync(join(pasta, arq), 'utf8');
      if (idsDoYdk(local) === idsDoYdk(noBanco2.ydk)) ok(`${npc}/${nome} (${raiz.nome}) bate com o banco`);
      else velho(`${npc}/${nome} (${raiz.nome}) — espelho diferente do banco (o jogo le do banco)`);
    }
  }
}

// -------------------------------------------------------------- tabuleiros
console.log('\n  [3] tabuleiros');
const tabuleiros = await banco('tabuleiros?select=nome');
nota(`${tabuleiros.length} tabuleiro(s) no banco`);
for (const raiz of RAIZES) {
  const dir = join(raiz.dir, 'boards');
  if (!existsSync(dir)) continue;
  for (const arq of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const nome = arq;
    if (tabuleiros.some((t) => t.nome === nome || t.nome === arq.replace(/\.json$/, ''))) {
      ok(`${nome} (${raiz.nome}) existe no banco`);
    } else {
      falha(`${nome} (${raiz.nome}) NAO existe no banco — só nesta máquina`);
    }
  }
}

console.log('');
if (problemas === 0) {
  console.log('  \x1b[32mtudo que esta em disco tambem esta no banco.\x1b[0m\n');
  console.log('  (as linhas em amarelo sao espelho desatualizado: o jogo le do banco.)');
} else {
  console.log(`  [31m${problemas} item(ns) existem SO em disco.[0m`);
  console.log('  Nunca chegaram ao banco, entao nao existem para mais ninguem.');
  console.log('  Abra a tela que edita cada um e salve de novo, LOGADO COMO ADMIN:');
  console.log('  publicar e o unico caminho pelo qual a alteracao chega no jogo de');
  console.log('  outra pessoa.');
}
process.exit(problemas === 0 ? 0 : 1);

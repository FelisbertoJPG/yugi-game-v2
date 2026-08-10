/**
 * Publica o CONTEÚDO DO JOGO no Supabase.
 *
 *   node tools/publicar-conteudo.mjs                 # confere e mostra o que mudaria
 *   node tools/publicar-conteudo.mjs --publicar      # sobe de verdade
 *
 * Credenciais de admin por variável de ambiente (não por argumento — argumento
 * fica no histórico do shell):
 *
 *   DUELACADEMY_ADMIN_EMAIL=...  DUELACADEMY_ADMIN_SENHA=...
 *
 * O que sobe, e por quê:
 *
 *   store/banlist.json, boosters.json, npcs.json  ->  conteudo
 *   decks/npc/<npc>/<nome>.ydk                    ->  decks_npc
 *   boards/*.json                                 ->  tabuleiros
 *
 * Isto é o que resolve a pendência §11 do INSTALADOR-PENDENCIAS.md: até aqui um
 * deck de NPC só viajava dentro do `.exe`, então reequilibrar o deck do Kaiba
 * exigia publicar um Release e esperar todo mundo atualizar. Pelo banco, o
 * jogador recebe no próximo boot.
 *
 * A escrita é barrada pela RLS para quem não é admin (`eh_admin()`), então este
 * script não tem poder nenhum sem uma conta promovida — a chave que ele usa é a
 * publishable, a mesma que vai dentro do jogo.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_BASE = 'https://shclhlbfkdnnqxboiuqc.supabase.co';
const KEY = 'sb_publishable_FxGEPSbXqJEBBUqG9ugJ6w_3z5AaVzC';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const publicar = process.argv.includes('--publicar');

let ok = 0, erros = 0;
const linha = (s) => console.log(`  ${s}`);

// ------------------------------------------------------------------ sessão

async function entrar() {
  const email = process.env.DUELACADEMY_ADMIN_EMAIL;
  const senha = process.env.DUELACADEMY_ADMIN_SENHA;
  if (!email || !senha) {
    console.error('\n  Faltam DUELACADEMY_ADMIN_EMAIL e DUELACADEMY_ADMIN_SENHA.\n');
    process.exit(2);
  }
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: KEY },
    body: JSON.stringify({ email, password: senha }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    console.error(`\n  Login falhou: ${j.msg || j.error_description || r.status}\n`);
    process.exit(2);
  }
  return j.access_token;
}

async function conferirAdmin(token) {
  // Filtra pelo PRÓPRIO id: a policy de `perfis` deixa um admin ver todo mundo,
  // então sem o filtro a primeira linha podia ser de outra conta — e o script
  // anunciava um nome que não era o de quem estava publicando.
  const sub = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub;

  const r = await fetch(`${URL_BASE}/rest/v1/perfis?select=usuario,admin&id=eq.${sub}`, {
    headers: { apikey: KEY, authorization: `Bearer ${token}` },
  });
  const [p] = await r.json();
  if (!p?.admin) {
    // Sem isto o script "funcionaria" e cada gravação levaria 403 em silêncio,
    // porque a RLS não distingue "não é admin" de "linha não existe".
    console.error(`\n  ${p?.usuario ?? 'esta conta'} não é admin — a RLS vai recusar tudo.\n`);
    process.exit(2);
  }
  return p.usuario;
}

// -------------------------------------------------------------------- REST

async function upsert(token, tabela, linhaDados, conflito) {
  if (!publicar) return { ok: true, seco: true };
  const r = await fetch(`${URL_BASE}/rest/v1/${tabela}?on_conflict=${conflito}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(linhaDados),
  });
  if (r.ok) return { ok: true };
  return { ok: false, error: `${r.status} ${(await r.text()).slice(0, 160)}` };
}

async function enviar(token, rotulo, tabela, dados, conflito) {
  const r = await upsert(token, tabela, dados, conflito);
  if (r.ok) { ok++; linha(`ok   ${rotulo}${r.seco ? '  (dry-run)' : ''}`); }
  else { erros++; linha(`ERRO ${rotulo}: ${r.error}`); }
}

// ------------------------------------------------------------------ coleta

async function lerJson(caminho) {
  try { return JSON.parse(await readFile(caminho, 'utf8')); }
  catch { return null; }
}

/** Todos os .ydk de decks/npc, com o id do NPC deduzido da pasta. */
async function decksDeNpc() {
  const base = join(ROOT, 'decks', 'npc');
  const out = [];
  async function anda(dir) {
    let itens = [];
    try { itens = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of itens) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { await anda(full); continue; }
      if (!e.name.toLowerCase().endsWith('.ydk')) continue;
      const rel = relative(base, full).split(sep);
      out.push({
        npc: rel.length > 1 ? rel[0] : 'sem-npc',
        nome: e.name.replace(/\.ydk$/i, ''),
        ydk: await readFile(full, 'utf8'),
      });
    }
  }
  await anda(base);
  return out;
}

async function tabuleiros() {
  const base = join(ROOT, 'boards');
  let itens = [];
  try { itens = await readdir(base); } catch { return []; }
  const out = [];
  for (const nome of itens) {
    if (!nome.toLowerCase().endsWith('.json')) continue;
    const dados = await lerJson(join(base, nome));
    if (dados) out.push({ nome, dados });
  }
  return out;
}

// -------------------------------------------------------------------- main

console.log('\n  ####  DUEL ACADEMY - PUBLICAR CONTEUDO  ####\n');
if (!publicar) linha('DRY-RUN (nada sera gravado). Use --publicar para subir.\n');

const token = await entrar();
const quem = await conferirAdmin(token);
linha(`admin: ${quem}\n`);

// 1. store/*.json -> conteudo
for (const chave of ['banlist', 'boosters', 'npcs', 'npc-base-meta']) {
  const dados = await lerJson(join(ROOT, 'store', `${chave}.json`));
  if (dados === null) { linha(`--   ${chave} (nao existe, pulando)`); continue; }
  await enviar(token, `conteudo/${chave}`, 'conteudo', { chave, dados }, 'chave');
}

// 1b. Lista 1 RESOLVIDA -> conteudo/lista1
//
// A regra (`inLista1`) depende do banco de cartas, que não vive no Supabase:
// são "todos os monstros Normais e de Fusão mais 153 magias/armadilhas por id".
// O servidor não tem como avaliar isso, então publicamos o RESULTADO — a lista
// de ids permitidos — e `salvar_deck` só confere pertinência.
//
// Republicar isto é obrigatório depois de um `npm run data:build` que mude o
// conjunto; sem republicar, o servidor conferiria contra uma lista velha.
{
  const { pathToFileURL } = await import('node:url');
  const idx = JSON.parse(await readFile(join(ROOT, 'ygo-data', 'data', 'cards.index.json'), 'utf8'));
  const cartas = Array.isArray(idx) ? idx : (idx.cards ?? idx.data ?? Object.values(idx)[0]);
  const { inLista1 } = await import(pathToFileURL(join(ROOT, 'web', 'js', 'lista1.js')).href);
  const ids = cartas.filter(inLista1).map((c) => c.id);
  await enviar(token, `conteudo/lista1  (${ids.length} cartas)`, 'conteudo',
               { chave: 'lista1', dados: ids }, 'chave');
}

// 2. decks/npc/**.ydk -> decks_npc
const decks = await decksDeNpc();
for (const d of decks) {
  await enviar(token, `decks_npc/${d.npc}/${d.nome}`, 'decks_npc', d, 'npc,nome');
}
if (!decks.length) linha('--   nenhum deck de NPC encontrado');

// 3. boards/*.json -> tabuleiros
const boards = await tabuleiros();
for (const b of boards) {
  await enviar(token, `tabuleiros/${b.nome}`, 'tabuleiros', b, 'nome');
}
if (!boards.length) linha('--   nenhum tabuleiro encontrado');

console.log(`\n  ${ok} ok, ${erros} erro(s)${publicar ? '' : ' (dry-run)'}\n`);
process.exit(erros === 0 ? 0 : 1);

/**
 * Cruza os BOOSTERS publicados com a LISTA de cartas ativa.
 *
 *   node tools/conferir-boosters.mjs
 *
 * Por que existe: o Booster Builder monta o pacote a partir do banco INTEIRO,
 * não do pool da lista. Nada impede pôr num booster uma carta que a Lista 1 não
 * conhece — e o estrago é silencioso e caro. O jogador paga DP, abre a carta,
 * ela entra na Coleção, aparece no Deck Builder; só na hora de SALVAR o deck é
 * que `salvar_deck` responde "não está na lista permitida". Nada acusa isso
 * antes, em lugar nenhum.
 *
 * Foi assim que De-Spell, Ritual Cage, Birthright e Swing of Memories ficaram à
 * venda e injogáveis ao mesmo tempo.
 *
 * A leitura é do BANCO (a verdade viva), não de `store/*.json` — esses arquivos
 * são espelho e envelhecem: no dia em que isto foi escrito, o espelho local
 * dizia que estava tudo certo enquanto o banco tinha as quatro cartas soltas.
 * Só lê, não escreve nada; a chave é a publishable, a mesma que vai no jogo.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_BASE = 'https://shclhlbfkdnnqxboiuqc.supabase.co';
const KEY = 'sb_publishable_FxGEPSbXqJEBBUqG9ugJ6w_3z5AaVzC';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

/** Um documento da tabela `conteudo`. Leitura é aberta (não precisa de sessão). */
async function conteudo(chave) {
  const r = await fetch(
    `${URL_BASE}/rest/v1/conteudo?select=dados&chave=eq.${encodeURIComponent(chave)}`,
    { headers: { apikey: KEY } },
  );
  if (!r.ok) throw new Error(`conteudo/${chave}: HTTP ${r.status}`);
  const linhas = await r.json();
  return linhas[0]?.dados ?? null;
}

const idx = JSON.parse(await readFile(join(ROOT, 'ygo-data/data/cards.index.json'), 'utf8'));
const porId = new Map(idx.map((c) => [c.id, c]));

const boosters = await conteudo('boosters');
const fonte = await conteudo('cardlists');
const lista = fonte?.listas?.[0];
if (!Array.isArray(boosters)) throw new Error('conteudo/boosters não é uma lista');
if (!lista) throw new Error('conteudo/cardlists sem nenhuma lista');

// O mesmo filtro de `cardlists.js`: os tipos entram por REGRA, os ids um a um.
const ids = new Set(lista.ids ?? []);
const tipos = new Set(lista.tipos ?? []);
const naLista = (c) => ids.has(c.id) || (c.t === 'M' && tipos.has(c.tl));

const fora = new Map();
let total = 0;
for (const b of boosters) {
  for (const [raridade, cartas] of Object.entries(b.cards ?? {})) {
    for (const id of cartas) {
      total++;
      const c = porId.get(id);
      const onde = `${b.name}/${raridade}`;
      if (!c) {
        fora.set(id, { nome: '(id fora do índice de cartas)', tl: '?', onde: [onde] });
        continue;
      }
      if (naLista(c)) continue;
      if (!fora.has(id)) fora.set(id, { nome: c.name, tl: c.tl, onde: [] });
      fora.get(id).onde.push(onde);
    }
  }
}

console.log(`\n  ${boosters.length} booster(s), ${total} entrada(s) de carta`);
console.log(`  lista ativa: ${lista.label ?? lista.id} — ${ids.size} avulsas + tipos [${[...tipos].join(', ')}]\n`);

if (!fora.size) {
  console.log('  OK: toda carta dos boosters está na lista.\n');
  process.exit(0);
}

console.log(`  ${fora.size} carta(s) VENDIDA(S) e fora da lista — o jogador abre e não pode jogar:\n`);
for (const [id, { nome, tl, onde }] of [...fora].sort((a, b) => a[1].nome.localeCompare(b[1].nome))) {
  console.log(`    ${String(id).padStart(9)}  ${nome}  [${tl}]`);
  console.log(`               em: ${onde.join(', ')}`);
}
console.log('\n  Conserto: pôr as cartas na lista pelo editor (web/listas.html, Área de\n' +
            '  Teste) ou tirá-las do booster (web/booster.html). Antes de pôr na lista,\n' +
            '  confira que o efeito roda — é para isso que serve --test-cartas-booster.\n');
process.exit(1);

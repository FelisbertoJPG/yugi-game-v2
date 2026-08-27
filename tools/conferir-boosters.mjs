/**
 * **Toda carta que o jogo ENTREGA é jogável?**
 *
 *   node tools/conferir-boosters.mjs
 *
 * As três portas por onde uma carta chega ao jogador são o BOOSTER, o DECK
 * ESTRUTURAL e o POOL DE DROP de NPC. Se uma delas entrega uma carta que a lista
 * ativa não aceita, o estrago é silencioso e caro: o jogador paga DP (ou vence o
 * duelo), a carta entra na Coleção, aparece no Deck Builder — e só na hora de
 * SALVAR o deck é que `salvar_deck` responde "não está na lista permitida".
 *
 * Foi assim que De-Spell, Ritual Cage, Birthright e Swing of Memories ficaram à
 * venda e injogáveis ao mesmo tempo; e depois disso, mais dez, quase todas dos
 * pacotes de NPC (Shifting Shadows, Dark Factory of More Production…).
 *
 * ## O que mudou, e por que este arquivo mudou junto
 *
 * A regra deixou de ser tarefa de quem administra e virou INVARIANTE: a
 * migration 0048 fez `lista_ativa()` devolver a lista publicada **mais** o que
 * `cartas_obteniveis()` encontra nessas três portas. Perguntar de novo "a carta
 * do booster está na lista ativa?" passou a ser tautologia — a resposta é sim
 * por construção, e um relatório que só sabe dizer "sim" deixa de ser lido.
 *
 * A pergunta útil virou outra: **`cartas_obteniveis()` enxerga mesmo tudo?**
 * Ela varre JSON editado por painel (`conteudo/boosters`, `conteudo/npc-drops`)
 * e o `.ydk` dos estruturais; uma forma nova de dado — um pool aninhado de outro
 * jeito, um campo renomeado — a faria devolver de menos **em silêncio**, e as
 * cartas voltariam a ser vendidas e injogáveis sem nada acusar.
 *
 * Por isso este arquivo faz a varredura POR CONTA PRÓPRIA e compara com a do
 * servidor. É a única duplicação legítima do projeto: a de um conferidor, cujo
 * trabalho é justamente discordar. Em todo o resto, quem pergunta lê a resposta
 * do servidor em vez de recalculá-la.
 *
 * Só lê, não escreve nada; a chave é a publishable, a mesma que vai no jogo.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_BASE = 'https://shclhlbfkdnnqxboiuqc.supabase.co';
const KEY = 'sb_publishable_FxGEPSbXqJEBBUqG9ugJ6w_3z5AaVzC';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

async function pegar(caminho, { metodo = 'GET', corpo } = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    method: metodo,
    headers: { apikey: KEY, ...(corpo ? { 'content-type': 'application/json' } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.json();
}

/** Um documento da tabela `conteudo`. Leitura é aberta (não precisa de sessão). */
async function conteudo(chave) {
  const linhas = await pegar(`conteudo?select=dados&chave=eq.${encodeURIComponent(chave)}`);
  return linhas[0]?.dados ?? null;
}

/** `#main`/`#extra`/`!side` de um `.ydk` → os ids, com repetição. */
function idsDoYdk(ydk) {
  const saida = [];
  for (const linha of String(ydk ?? '').split(/\r?\n/)) {
    const s = linha.trim();
    if (!s || s.startsWith('#') || s.startsWith('!')) continue;
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) saida.push(n);
  }
  return saida;
}

// ---------------------------------------------------------------- a varredura

const idx = JSON.parse(await readFile(join(ROOT, 'ygo-data/data/cards.index.json'), 'utf8'));
const porId = new Map(idx.map((c) => [c.id, c]));

const boosters = await conteudo('boosters');
const drops = await conteudo('npc-drops');
const estruturais = await pegar('decks_estruturais?select=nome,ydk');
if (!Array.isArray(boosters)) throw new Error('conteudo/boosters não é uma lista');

/** id → de onde ele vem (para o relatório dizer ONDE consertar). */
const entregues = new Map();
const anotar = (id, onde) => {
  if (!Number.isFinite(id) || id <= 0) return;
  if (!entregues.has(id)) entregues.set(id, new Set());
  entregues.get(id).add(onde);
};

for (const b of boosters ?? []) {
  for (const [raridade, cartas] of Object.entries(b?.cards ?? {})) {
    if (!Array.isArray(cartas)) continue;
    for (const id of cartas) anotar(Number(id), `booster ${b.name}/${raridade}`);
  }
}

for (const [npc, cfg] of Object.entries(drops ?? {})) {
  // O pool do NPC e o de cada DECK dele — os dois, porque o sorteio do prêmio
  // também olha os dois (deck primeiro, NPC como reserva).
  const pools = [['', cfg?.pool], ...Object.entries(cfg?.decks ?? {}).map(([d, c]) => [d, c?.pool])];
  for (const [deck, pool] of pools) {
    for (const [raridade, cartas] of Object.entries(pool ?? {})) {
      if (!Array.isArray(cartas)) continue;
      const onde = `drop ${npc}${deck ? `/${deck}` : ''}/${raridade}`;
      for (const id of cartas) anotar(Number(id), onde);
    }
  }
}

for (const d of estruturais ?? []) {
  for (const id of idsDoYdk(d.ydk)) anotar(id, `estrutural ${d.nome}`);
}

// ------------------------------------------------- o que o SERVIDOR enxergou

const doServidor = new Set((await pegar('rpc/cartas_obteniveis', { metodo: 'POST', corpo: {} }))
  .map(Number));

const invisiveis = [...entregues.keys()].filter((id) => !doServidor.has(id));
const semCarta = [...entregues.keys()].filter((id) => !porId.has(id));

console.log(`\n  ${boosters.length} booster(s) · ${estruturais.length} estrutural(is) · `
          + `${Object.keys(drops ?? {}).length} NPC(s) com drop`);
console.log(`  ${entregues.size} carta(s) entregues pelo jogo · `
          + `${doServidor.size} vista(s) por cartas_obteniveis()\n`);

const relatar = (titulo, ids, conserto) => {
  console.log(`  ${ids.length} ${titulo}:\n`);
  for (const id of ids.sort((a, b) => a - b)) {
    const c = porId.get(id);
    console.log(`    ${String(id).padStart(9)}  ${c?.name ?? '(id fora do índice de cartas)'}`
              + `${c ? `  [${c.tl ?? c.t}]` : ''}`);
    console.log(`               em: ${[...entregues.get(id)].join(', ')}`);
  }
  console.log(`\n  ${conserto}\n`);
};

let ruim = false;

if (invisiveis.length) {
  ruim = true;
  relatar('carta(s) que o jogo entrega e `cartas_obteniveis()` NÃO enxerga',
          invisiveis,
          'A varredura do servidor (migration 0048) perdeu uma forma de dado — estas\n'
        + '  cartas voltaram a ser entregues e injogáveis. Conserte a função, não a\n'
        + '  lista: pôr as cartas na lista à mão esconde o buraco e ele volta na\n'
        + '  próxima carta.');
}

if (semCarta.length) {
  ruim = true;
  relatar('id(s) que o jogo entrega e não existem no banco de cartas',
          semCarta,
          'O jogador recebe uma carta que não existe: arte quebrada e um deck que o\n'
        + '  motor recusa. Tire do booster/pool (web/booster.html, aba DROPS) ou\n'
        + '  confira se o id foi digitado errado.');
}

if (!ruim) {
  console.log('  OK: tudo que o jogo entrega é visto pelo servidor e existe no banco.\n');
  process.exit(0);
}
process.exit(1);

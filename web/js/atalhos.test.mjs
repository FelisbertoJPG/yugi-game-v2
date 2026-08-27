/**
 * **O atalho de propriedade que referencia uma variável que não existe.**
 *   node web/js/atalhos.test.mjs
 *
 * `{ nomeDe }` parece uma chave e **é uma leitura de variável**. Escrever o
 * atalho com um nome que não existe no arquivo é sintaxe perfeitamente válida:
 * nada acusa ao salvar, nada acusa ao carregar a página, e o erro só aparece —
 * como `ReferenceError` — no instante em que aquela linha executa. Se a linha
 * mora num caminho raro, ela viaja para produção.
 *
 * Este projeto pagou por isso **duas vezes**:
 *
 *   1. `web/js/correntes.js` recebia `{ turno }` onde a variável da tela se
 *      chama `turn` — o duelo morria com *"turno is not defined"* na PRIMEIRA
 *      janela de corrente;
 *   2. `web/duel.html` passava `{ nomeDe }` para `montarRevelacao`, onde a
 *      função se chama `nameOf`. Este é pior porque o caminho é raro e caro: só
 *      estoura ao **vencer** um duelo contra um adversário que TEM pool de drop
 *      (sem drop o `renderDrops` volta antes). O relato foi vencer o Panik e
 *      receber *"ERRO na tela: nomeDe is not defined"*. E a linha que quebra vem
 *      DEPOIS de `liberarSaidaDoFim(false)` e ANTES de
 *      `$('end-overlay').hidden = false`: a tela de fim nunca aparecia, os dois
 *      botões de saída ficavam desligados, e o prêmio já tinha sido creditado no
 *      servidor. Vitória sem saída.
 *
 * A varredura é deliberadamente ESTREITA: só o atalho sozinho numa linha
 * (`  nomeDe,`), que é a forma exata dos dois casos reais. Ela é escopo-cega —
 * basta o nome existir em algum lugar do arquivo —, o que a deixa incapaz de
 * pegar um erro de escopo e, em troca, sem nenhum falso positivo na árvore de
 * hoje. Varredura que grita à toa deixa de ser lida.
 *
 * Como as outras varreduras do projeto (`esconder`, `vivo`), ela também prova
 * que RECONHECE o caso ruim — senão "nenhum culpado" não provaria nada.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

/**
 * Globais do navegador e palavras da linguagem. Um atalho com um destes nomes é
 * estranho, mas não é erro — e a lista existe para a varredura poder ser
 * escopo-cega sem inventar culpado.
 */
const GLOBAIS = new Set(['window', 'document', 'console', 'Math', 'JSON', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Promise', 'Map', 'Set', 'Date', 'location', 'localStorage',
  'sessionStorage', 'fetch', 'URL', 'URLSearchParams', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'navigator', 'crypto', 'Intl',
  'isNaN', 'parseInt', 'parseFloat', 'structuredClone', 'undefined', 'NaN', 'Infinity',
  'globalThis', 'performance', 'history', 'alert', 'confirm', 'prompt', 'Error', 'Symbol',
  'FileReader', 'Image', 'Blob', 'FormData', 'WebSocket', 'AbortController', 'CustomEvent',
  'HTMLElement', 'Event', 'DOMParser', 'TextEncoder', 'TextDecoder', 'atob', 'btoa',
  'this', 'arguments', 'true', 'false', 'null']);

/**
 * Fora comentário e texto de string. Sem isto, um `nome,` dentro de um template
 * literal ou de um comentário de bloco viraria culpado — e a folha de estilo
 * embutida no `duel.html` está cheia deles.
 */
function limpar(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/`(?:[^`\\]|\\[\s\S])*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\[\s\S])*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\[\s\S])*"/g, '""');
}

/**
 * Todo nome que o arquivo DECLARA, de qualquer jeito. É escopo-cego de
 * propósito: a pergunta aqui não é "este nome vale nesta linha?", é "este nome
 * existe em algum lugar?". A primeira exigiria um parser de verdade — e o front
 * tem zero dependências.
 */
function declaracoes(c) {
  const d = new Set();
  const add = (n) => { if (/^[A-Za-z_$][\w$]*$/.test(n)) d.add(n); };
  // Uma lista de parâmetros ou de destructuring: fica com o nome que a ligação
  // realmente cria (`a: b` liga `b`; `a = 1` liga `a`; `...resto` liga `resto`).
  const lista = (s) => s.split(',').forEach((x) => {
    let n = x.includes(':') ? x.split(':').pop() : x;
    n = n.split('=')[0].replace(/[.[\]{}]/g, ' ').trim().split(/\s+/).pop() || '';
    add(n.replace(/^as\s+/, ''));
  });

  for (const m of c.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of c.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of c.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of c.matchAll(/\bimport\s*{([^}]*)}/g))
    m[1].split(',').forEach((x) => add(x.split(/\s+as\s+/).pop().trim()));
  for (const m of c.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of c.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of c.matchAll(/\bfor\s*(?:await\s*)?\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of c.matchAll(/(?:const|let|var)\s*{([^{}]*)}/g)) lista(m[1]);
  for (const m of c.matchAll(/(?:const|let|var)\s*\[([^[\]]*)\]/g)) lista(m[1]);
  for (const m of c.matchAll(/\(([^()]*)\)\s*=>/g)) lista(m[1]);
  for (const m of c.matchAll(/\bfunction\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g)) lista(m[1]);
  for (const m of c.matchAll(/\b(?:async\s+)?function\s*\(([^()]*)\)/g)) lista(m[1]);
  for (const m of c.matchAll(/[A-Za-z_$][\w$]*\s*\(([^()]*)\)\s*{/g)) lista(m[1]);
  for (const m of c.matchAll(/\(\s*{([^{}]*)}\s*(?:=\s*{[^{}]*}\s*)?\)\s*(?:=>|{)/g)) lista(m[1]);
  return d;
}

/** Os atalhos de um trecho de código que não casam com declaração nenhuma. */
export function atalhosOrfaos(codigo) {
  const c = limpar(codigo);
  const decl = declaracoes(c);
  const achados = [];
  c.split('\n').forEach((l, i) => {
    const m = l.match(/^\s*([A-Za-z_$][\w$]*)\s*,\s*$/);
    if (!m) return;
    if (decl.has(m[1]) || GLOBAIS.has(m[1])) return;
    achados.push({ linha: i + 1, nome: m[1] });
  });
  return achados;
}

/** Cada `<script type="module">` de uma página, e o código dos módulos soltos. */
function fontes() {
  const saida = [];
  for (const f of readdirSync(WEB)) {
    if (!f.endsWith('.html')) continue;
    const src = readFileSync(join(WEB, f), 'utf8');
    let n = 0;
    for (const m of src.matchAll(/<script type="module">([\s\S]*?)<\/script>/g))
      saida.push({ rotulo: `${f} (bloco ${++n})`, codigo: m[1] });
  }
  for (const f of readdirSync(join(WEB, 'js'))) {
    if (!/\.m?js$/.test(f) || f.endsWith('.test.mjs')) continue;
    saida.push({ rotulo: `js/${f}`, codigo: readFileSync(join(WEB, 'js', f), 'utf8') });
  }
  return saida;
}

const TODAS = fontes();

t('a varredura encontrou as telas e os modulos de verdade', () => {
  assert.ok(TODAS.length >= 20, `so achei ${TODAS.length} fontes`);
  assert.ok(TODAS.some((f) => f.rotulo.startsWith('duel.html')), 'duel.html ficou de fora');
  assert.ok(TODAS.some((f) => f.rotulo === 'js/correntes.js'), 'correntes.js ficou de fora');
});

t('nenhum atalho de propriedade aponta para variavel inexistente', () => {
  const culpados = [];
  for (const { rotulo, codigo } of TODAS)
    for (const a of atalhosOrfaos(codigo))
      culpados.push(`${rotulo}:${a.linha} → { ${a.nome} }`);
  assert.deepEqual(culpados, [],
    'atalho sem variavel — ReferenceError na hora em que a linha rodar:\n        '
    + culpados.join('\n        '));
});

t('a varredura RECONHECE o caso ruim (senao "nenhum culpado" nao prova nada)', () => {
  // O código exato do bug do fim de duelo, reduzido: `nameOf` existe, `nomeDe`
  // não — e é o atalho que estoura.
  const ruim = `
    const nameOf = (id) => String(id);
    function renderDrops(itens) {
      return montarRevelacao(itens, {
        nomeDe,
        colunas: 7,
      });
    }`;
  const achados = atalhosOrfaos(ruim);
  assert.equal(achados.length, 1, 'devia acusar exatamente um');
  assert.equal(achados[0].nome, 'nomeDe');
});

t('e NAO acusa o atalho legitimo (o nome existe no arquivo)', () => {
  const bom = `
    const nameOf = (id) => String(id);
    const colunas = 7;
    const opts = {
      nameOf,
      colunas,
    };`;
  assert.deepEqual(atalhosOrfaos(bom), []);
});

t('destructuring e parametro contam como declaracao', () => {
  // Sem isto a varredura acusaria meio front: `const { a } = o` e `({ a }) =>`
  // declaram `a`, e o atalho seguinte é legítimo.
  const bom = `
    const { alcancou } = pullFileEx();
    function f({ modo }, [primeiro]) {
      return {
        alcancou,
        modo,
        primeiro,
      };
    }`;
  assert.deepEqual(atalhosOrfaos(bom), []);
});

t('comentario e template literal nao viram culpado', () => {
  // O `duel.html` tem uma folha de estilo inteira dentro do arquivo, e listas
  // separadas por vírgula em comentário são comuns nele.
  const bom = `
    /* uma lista,
       assim, */
    const css = \`
      opacity,
    \`;
    // outra,
    const x = 1;
    export { x };`;
  assert.deepEqual(atalhosOrfaos(bom), []);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);

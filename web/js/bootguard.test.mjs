/**
 * A REDE DE SEGURANÇA DO BOOT — `node web/js/bootguard.test.mjs`
 *
 * Toda página do jogo abre com uma corrente de `await` no topo do módulo. Um
 * `throw` em qualquer elo para o módulo ali mesmo, e o estrago é **calado**: o
 * que já foi desenhado fica, os "carregando…" de fábrica ficam para sempre, e
 * não há erro em lugar nenhum que alguém veja — o `duel-server.log` é do
 * servidor, e isto acontece no navegador.
 *
 * Foi assim que dois jogadores ficaram presos numa *"home eternamente
 * carregando"* em 23/08/2026, com TODAS as respostas do Supabase em 200 e nada
 * para perguntar a eles: não aparecia nada.
 *
 * As duas metades erram calado, e por isso as duas são provadas aqui:
 *
 *   • **a varredura** — a página que esquecer a rede volta a falhar em silêncio,
 *     e ninguém percebe até alguém ficar preso. Uma página nova nasce sem ela;
 *   • **a ORDEM** — os `<script type="module">` rodam na ordem do documento.
 *     Registrar a rede DEPOIS do módulo da página é o mesmo que não a ter: a
 *     falha que ela existe para mostrar já aconteceu.
 *
 * E a decisão do próprio módulo: as paradas de PROPÓSITO (o `throw` que segue um
 * redirect para o login) não podem virar faixa vermelha. Errar aí põe "esta tela
 * nao terminou de abrir" na cara de todo mundo que é mandado para o login — o
 * caminho normal virando erro.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(AQUI, '..');

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};
const ta = async (nome, fn) => {
  try { await fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

// ------------------------------------------------------------- a varredura

const TAG = /<script[^>]*\btype="module"[^>]*>/g;
const GUARDA = /bootguard\.js/;

/**
 * O veredito de uma página. Devolve `null` quando está tudo certo e o MOTIVO
 * quando não — é isto que o teste de controle mais abaixo exercita.
 */
function culpa(html) {
  const tags = [...html.matchAll(TAG)];
  if (!tags.length) return null;                 // página sem módulo não trava assim

  const iGuarda = html.search(GUARDA);
  if (iGuarda < 0) return 'nao importa a rede de seguranca';

  // A primeira tag de módulo que NÃO é a da rede precisa vir depois dela.
  const primeiraOutra = tags
    .map((m) => m.index)
    .find((i) => !GUARDA.test(html.slice(i, html.indexOf('</script>', i))));

  if (primeiraOutra !== undefined && primeiraOutra < iGuarda) {
    return 'a rede vem DEPOIS do modulo da pagina — nao pega a falha dele';
  }
  return null;
}

const paginas = fs.readdirSync(WEB).filter((f) => f.endsWith('.html'));

t('há páginas para varrer (a varredura vazia passaria sozinha)', () => {
  assert.ok(paginas.length >= 15, `achei so ${paginas.length} pagina(s) em web/`);
});

t('toda página com módulo tem a rede de segurança, e antes do próprio módulo', () => {
  const culpados = [];
  for (const f of paginas) {
    const motivo = culpa(fs.readFileSync(path.join(WEB, f), 'utf8'));
    if (motivo) culpados.push(`${f}: ${motivo}`);
  }
  assert.deepEqual(culpados, [], 'paginas que voltam a falhar caladas:\n        '
    + culpados.join('\n        '));
});

// O CONTROLE. Sem ele, "nenhum culpado" não prova que a varredura funciona —
// prova só que ela não acusou nada, que é o que uma varredura quebrada faz.
t('a varredura reconhece a página SEM a rede', () => {
  assert.match(culpa('<script type="module">import "/web/js/loja.js";</script>'),
               /nao importa/);
});

t('a varredura reconhece a rede na ORDEM ERRADA', () => {
  const torto = '<script type="module">await boot();</script>'
              + '<script type="module">import "/web/js/bootguard.js";</script>';
  assert.match(culpa(torto), /DEPOIS/);
});

t('e não acusa a página que não tem módulo nenhum', () => {
  assert.equal(culpa('<html><body>so texto</body></html>'), null);
});

// --------------------------------------------------- a decisão do módulo

/**
 * Um DOM de mentira, do tamanho exato do que o `bootguard.js` toca. Trazer uma
 * biblioteca de DOM para isto seria uma dependência num front que tem zero — e
 * o que se quer provar aqui não é o desenho da faixa, é QUANDO ela aparece.
 */
async function comDomFalso(fn) {
  const ouvintes = new Map();
  const criado = [];
  const fake = () => {
    const el = {
      style: { cssText: '', _set(k, v) { this[k] = v; } },
      children: [], textContent: '', id: '',
      setAttribute() {}, append(...x) { this.children.push(...x); },
      prepend(...x) { this.children.unshift(...x); },
    };
    criado.push(el);
    return el;
  };
  const corpo = fake();

  const antes = { window: global.window, document: global.document, console: global.console };
  const erros = [];
  global.window = { addEventListener: (n, h) => ouvintes.set(n, h) };
  global.document = { createElement: fake, body: corpo, documentElement: corpo };
  global.console = { ...console, error: (...a) => erros.push(a.join(' ')) };

  try {
    // `?v=` força uma instância nova: o módulo tem estado (`mostrado`), e a
    // segunda chamada do teste veria o do primeiro.
    await import(`./bootguard.js?v=${Math.random()}`);
    return await fn({ ouvintes, corpo, erros });
  } finally {
    Object.assign(global, antes);
  }
}

/** O que a faixa diz, ou null quando ela não foi criada. */
const faixaDe = (corpo) => corpo.children.length
  ? corpo.children[0].children.map((c) => c.textContent).join(' | ')
  : null;

await ta('uma falha de verdade vira faixa na tela', () => comDomFalso(async ({ ouvintes, corpo }) => {
  ouvintes.get('unhandledrejection')({ reason: new TypeError('x is not a function') });
  assert.match(faixaDe(corpo) ?? '', /TypeError: x is not a function/);
}));

await ta('o redirect para o login NÃO vira faixa', () => comDomFalso(async ({ ouvintes, corpo }) => {
  // `requireLogin` manda para o login e ENTÃO lança, para parar a corrente de
  // `await`. Acusar isso poria um erro vermelho no caminho mais normal do jogo.
  ouvintes.get('unhandledrejection')({ reason: new Error('redirecionando para login') });
  ouvintes.get('unhandledrejection')({ reason: new Error('indo para a recuperacao') });
  assert.equal(faixaDe(corpo), null);
}));

await ta('a arte que não carregou não vira faixa', () => comDomFalso(async ({ ouvintes, corpo }) => {
  // As artes vêm do ygoprodeck.com e faltam o tempo todo (sem internet o jogo
  // funciona com as cartas em branco, de propósito). Um `error` de <img> sobe
  // para a window com `target` sendo o elemento.
  ouvintes.get('error')({ target: { tagName: 'IMG' }, message: 'load failed' });
  assert.equal(faixaDe(corpo), null);
}));

await ta('o import que não resolveu vira faixa (o módulo que não viajou no zip)',
  () => comDomFalso(async ({ ouvintes, corpo }) => {
    ouvintes.get('error')({ target: undefined, message: 'Failed to fetch dynamically imported module' });
    assert.match(faixaDe(corpo) ?? '', /Failed to fetch/);
  }));

await ta('só o PRIMEIRO erro aparece — os seguintes são efeito dele',
  () => comDomFalso(async ({ ouvintes, corpo }) => {
    ouvintes.get('unhandledrejection')({ reason: new Error('a causa') });
    ouvintes.get('unhandledrejection')({ reason: new Error('o efeito') });
    assert.equal(corpo.children.length, 1);
    assert.match(faixaDe(corpo) ?? '', /a causa/);
    assert.doesNotMatch(faixaDe(corpo) ?? '', /o efeito/);
  }));

await ta('a falha também vai para o console (quem tem o F12 quer a pilha)',
  () => comDomFalso(async ({ ouvintes, erros }) => {
    ouvintes.get('unhandledrejection')({ reason: new Error('boom') });
    assert.ok(erros.some((l) => /boom/.test(l)), 'nada foi para o console');
  }));

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

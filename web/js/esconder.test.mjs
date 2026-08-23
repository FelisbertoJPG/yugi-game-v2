/**
 * O atributo `hidden` REALMENTE esconde? — `node web/js/esconder.test.mjs`
 *
 * Este projeto já pagou três vezes pela mesma armadilha, e ela nunca dá erro:
 *
 *   • a seta de ataque foi PUBLICADA invisível porque `svg.hidden = false` não
 *     faz nada — `hidden` é propriedade do `HTMLElement` e um `<svg>` é
 *     `SVGElement`, então aquilo virava um campo solto no objeto;
 *   • a escolha de ícones do drop era desenhada dentro de um `.quadro-corpo`
 *     com `display:none` (ver `drops.test.mjs`);
 *   • e o aviso "ÍCONE NOVO" ficava na tela em TODO fim de duelo, para quem não
 *     ganhou ícone nenhum e para quem PERDEU, porque `#end-icone` tinha
 *     `display: flex` numa regra de ID e nenhum guarda `[hidden]`.
 *
 * O terceiro é o que se prova aqui, e é o mais traiçoeiro dos três: o `hidden`
 * do HTML **não é mágica** — é uma regra `[hidden] { display: none }` na folha
 * de estilo do NAVEGADOR, com a especificidade mais baixa que existe. Qualquer
 * `#foo { display: … }` escrito por nós ganha dela. O JavaScript continua
 * marcando o atributo, o DOM fica certo, o `hidden` é `true` — e o elemento
 * continua na tela. Não há erro, não há aviso, e quem testou de olho só vê o
 * caso em que o elemento DEVE aparecer.
 *
 * A regra provada: **todo id que alguém esconde (no markup ou no script) e que
 * recebe um `display:` de uma regra nossa precisa de um guarda `[hidden]`.**
 *
 * É um teste de MARKUP + CSS, não de lógica, pela mesma razão que a bancada
 * visual existe: mudança de aparência não se prova em teste de lógica.
 */
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

const DIR = new URL('../', import.meta.url);
const PAGINAS = readdirSync(DIR).filter((f) => f.endsWith('.html')).sort();

/** O conteúdo de todos os `<style>` de uma página, junto. */
const estilos = (html) =>
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

/** Tira comentários de CSS: um seletor comentado não vale como guarda. */
const semComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Os ids que ALGUÉM esconde: o atributo escrito no markup, ou um
 * `.hidden = …` no script apontando para aquele id.
 */
function idsEscondidos(html) {
  const ids = new Set();

  // <div id="x" ... hidden> — em qualquer ordem dentro da tag
  for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const tag = m[0];
    if (!/\shidden(\s|=|>|\/)/.test(tag)) continue;
    const id = tag.match(/\sid="([^"]+)"/);
    if (id) ids.add(id[1]);
  }

  // $('x').hidden = …   /   getElementById('x').hidden = …
  for (const m of html.matchAll(/\$\(\s*'([^']+)'\s*\)\.hidden\s*=/g)) ids.add(m[1]);
  for (const m of html.matchAll(/getElementById\(\s*'([^']+)'\s*\)\.hidden\s*=/g)) ids.add(m[1]);

  return ids;
}

/**
 * As regras `{...}` que declaram `display:` — devolvidas como
 * `{ seletor, temDisplayNone }`.
 *
 * Nada de parser de CSS de verdade: as folhas daqui são escritas à mão, sem
 * `@media` aninhado dentro de regra e sem `{}` dentro de valor.
 */
function regrasComDisplay(css) {
  const fora = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const corpo = m[2];
    if (!/(^|;)\s*display\s*:/.test(corpo)) continue;
    fora.push({
      seletor: m[1].replace(/\s+/g, ' ').trim(),
      none: /(^|;)\s*display\s*:\s*none/.test(corpo),
    });
  }
  return fora;
}

// --------------------------------------------------------------- a varredura

t('todo id escondido que ganha `display` tem o guarda [hidden]', () => {
  const culpados = [];

  for (const pagina of PAGINAS) {
    const html = readFileSync(new URL(pagina, DIR), 'utf8');
    const css = semComentarios(estilos(html));
    if (!css.trim()) continue;

    const regras = regrasComDisplay(css);
    // Um `[hidden] { display: none }` solto na folha resolve a página inteira:
    // ele tem especificidade maior que a folha do navegador e alcança todo
    // mundo. Nenhuma página daqui faz isso hoje, mas é uma saída legítima.
    const guardaGeral = regras.some((r) => r.none && /^\[hidden\]$/.test(r.seletor));
    if (guardaGeral) continue;

    const escondidos = idsEscondidos(html);

    for (const id of escondidos) {
      // Alguma regra NOSSA dá display a este id sem falar de [hidden]?
      const dando = regras.filter((r) =>
        !/\[hidden\]/.test(r.seletor)
        && new RegExp(`#${id}(?![\\w-])`).test(r.seletor)
        // `#pai #filho` / `#pai .x` estiliza outra coisa; só conta quando o id
        // é o ALVO, isto é, o último elemento do seletor.
        && r.seletor.split(',').some((s) => new RegExp(`#${id}(?![\\w-])[^ >+~]*$`).test(s.trim())));
      if (!dando.length) continue;

      const guardado = regras.some((r) => r.none
        && new RegExp(`#${id}(?![\\w-])\\[hidden\\]`).test(r.seletor));
      if (guardado) continue;

      culpados.push(`${pagina}  #${id}  —  ${dando[0].seletor} { display: … }`);
    }
  }

  assert.deepEqual(culpados, [],
    'estes escondem por `hidden` mas o CSS manda mais alto — o elemento fica na tela:\n        '
    + culpados.join('\n        '));
});

// A outra metade: se um dia alguém "consertar" isto pondo um `[hidden]` global
// e depois removê-lo, o teste acima volta a valer sozinho. O que NÃO pode
// acontecer é o teste passar porque a varredura parou de achar as páginas.
t('a varredura encontrou as telas de verdade', () => {
  assert.ok(PAGINAS.length >= 10, `so' ${PAGINAS.length} pagina(s) em web/`);
  for (const obrigatoria of ['duel.html', 'index.html', 'deck.html']) {
    assert.ok(PAGINAS.includes(obrigatoria), `${obrigatoria} ficou de fora da varredura`);
  }
});

// E que ela sabe reconhecer o caso ruim — senão "nenhum culpado" não prova nada.
t('a varredura reconhece o caso ruim quando ele existe', () => {
  const ruim = `<style>#x { display: flex; }</style><div id="x" hidden></div>`;
  const regras = regrasComDisplay(semComentarios(estilos(ruim)));
  assert.equal(regras.length, 1);
  assert.ok(!regras[0].none);
  assert.ok(idsEscondidos(ruim).has('x'));

  const bom = `<style>#x { display: flex; } #x[hidden] { display: none; }</style><div id="x" hidden></div>`;
  const r2 = regrasComDisplay(semComentarios(estilos(bom)));
  assert.ok(r2.some((r) => r.none && /#x\[hidden\]/.test(r.seletor)));
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

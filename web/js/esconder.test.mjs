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
const MODULOS = readdirSync(new URL('js/', DIR))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(new URL(`js/${f}`, DIR), 'utf8'));

/** O conteúdo de todos os `<style>` de uma página, junto. */
const estilos = (html) =>
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

/** Tira comentários de CSS: um seletor comentado não vale como guarda. */
const semComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** As CLASSES de cada id, lidas do markup. */
function classesPorId(html) {
  const mapa = new Map();
  for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const tag = m[0];
    const id = tag.match(/\sid="([^"]+)"/);
    if (!id) continue;
    const cls = tag.match(/\sclass="([^"]+)"/);
    mapa.set(id[1], cls ? cls[1].split(/\s+/).filter(Boolean) : []);
  }
  return mapa;
}

/**
 * Os ids escondidos por SCRIPT, em qualquer arquivo — as páginas e os módulos
 * de `web/js/`.
 *
 * Os módulos entraram depois, e por um caso real: `mostrarAba` mora em
 * `builder.js` e esconde `#aba-deck` / `#aba-drops`, que ganham `display:flex`
 * da classe `.aba` em `deck.html`. Trocar de aba não escondia nada — as duas
 * ficavam na tela ao mesmo tempo —, e a varredura não via porque olhava só o
 * `<script>` inline da página. Um teste de ausência que lê metade dos arquivos
 * dá a mesma falsa segurança que não ler nenhum.
 */
function idsEscondidosPorScript(fontes) {
  const ids = new Set();
  for (const texto of fontes) {
    for (const m of texto.matchAll(/\$\(\s*'([^']+)'\s*\)\.hidden\s*=/g)) ids.add(m[1]);
    for (const m of texto.matchAll(/getElementById\(\s*'([^']+)'\s*\)\.hidden\s*=/g)) ids.add(m[1]);
  }
  return ids;
}

/** Os ids escondidos pelo ATRIBUTO, no markup desta página. */
function idsEscondidosNoMarkup(html) {
  const ids = new Set();
  for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const tag = m[0];
    if (!/\shidden(\s|=|>|\/)/.test(tag)) continue;
    const id = tag.match(/\sid="([^"]+)"/);
    if (id) ids.add(id[1]);
  }
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

/**
 * Um seletor simples (`#id` ou `.classe`) virado em fonte de regex, com a borda
 * que impede `#end` de casar dentro de `#end-icone`. Nada é escapado além do
 * ponto da classe: id e classe aqui são sempre `[\w-]+`.
 */
function escapa(alvo) {
  const marca = alvo[0] === '#' ? '#' : '\\.';
  return marca + alvo.slice(1) + '(?![\\w-])';
}

// --------------------------------------------------------------- a varredura

t('todo id escondido que ganha `display` tem o guarda [hidden]', () => {
  const culpados = [];
  const porScript = idsEscondidosPorScript([
    ...PAGINAS.map((p) => readFileSync(new URL(p, DIR), 'utf8')),
    ...MODULOS,
  ]);

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

    const classes = classesPorId(html);
    // O id conta como escondido quando o atributo esta' no markup DESTA pagina,
    // ou quando QUALQUER script (inline ou modulo) o esconde — e, nesse segundo
    // caso, so' se o id existir aqui: dois ids iguais em paginas diferentes sao
    // elementos diferentes.
    const escondidos = new Set([
      ...idsEscondidosNoMarkup(html),
      ...[...porScript].filter((id) => classes.has(id)),
    ]);

    for (const id of escondidos) {
      // Os SELETORES que podem alcançar este elemento: o id dele e cada uma das
      // CLASSES dele.
      //
      // A classe entrou depois, e por um caso real: o "voltar para a versão
      // anterior" de `atualizando.html` é `<div class="acoes" id="linha-voltar"
      // hidden>`, e quem lhe dá `display:flex` é a regra `.acoes` — nenhuma
      // regra cita `#linha-voltar`. A varredura olhava só o id, passou, e o
      // botão ficou VISÍVEL em toda atualização, inclusive quando não havia
      // backup nenhum para restaurar. Um teste de ausência que olha só metade
      // dos caminhos dá exatamente a falsa segurança que ele existe para evitar.
      const alvos = [`#${id}`, ...(classes.get(id) ?? []).map((c) => `.${c}`)];

      // O guarda vale vindo por QUALQUER um dos caminhos: `#id[hidden]` resolve
      // mesmo quando o `display` veio da classe, e `.classe[hidden]` resolve
      // para todos os elementos daquela classe de uma vez.
      const guardado = alvos.some((a) =>
        regras.some((r) => r.none && new RegExp(`${escapa(a)}\\[hidden\\]`).test(r.seletor)));
      if (guardado) continue;

      for (const alvo of alvos) {
        // Alguma regra NOSSA dá display a este alvo sem falar de [hidden]?
        // Só conta quando o alvo é o ÚLTIMO elemento do seletor: `#pai #filho`
        // e `#pai .x` estilizam outra coisa.
        const dando = regras.filter((r) =>
          !/\[hidden\]/.test(r.seletor)
          && r.seletor.split(',').some((s) =>
               new RegExp(`${escapa(alvo)}[^ >+~]*$`).test(s.trim())));
        if (!dando.length) continue;

        culpados.push(`${pagina}  #${id}  —  ${dando[0].seletor} { display: … }`);
        break;
      }
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
  assert.ok(idsEscondidosNoMarkup(ruim).has('x'));

  const bom = `<style>#x { display: flex; } #x[hidden] { display: none; }</style><div id="x" hidden></div>`;
  const r2 = regrasComDisplay(semComentarios(estilos(bom)));
  assert.ok(r2.some((r) => r.none && /#x\[hidden\]/.test(r.seletor)));
});

// Os DOIS caminhos que a varredura ganhou depois, cada um vindo de um caso real.
// Sem estas asserticoes, "nenhum culpado" voltaria a nao provar nada no dia em
// que alguem simplificasse a busca.
t('a varredura enxerga o display que vem da CLASSE', () => {
  const html = `<style>.caixa { display: flex; }</style><div class="caixa" id="x" hidden></div>`;
  assert.deepEqual(classesPorId(html).get('x'), ['caixa']);
  const regras = regrasComDisplay(semComentarios(estilos(html)));
  assert.ok(regras.some((r) => r.seletor === '.caixa' && !r.none));
});

t('a varredura enxerga o `.hidden =` que mora num MODULO', () => {
  const modulo = `export function f() { $('x').hidden = true; }`;
  assert.ok(idsEscondidosPorScript([modulo]).has('x'));
  assert.ok(MODULOS.length >= 5, `so' ${MODULOS.length} modulo(s) em web/js/`);
});


console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

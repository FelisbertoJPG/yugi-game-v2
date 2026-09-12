/**
 * AS GAVETAS POR RARIDADE — `node web/js/gavetas.test.mjs`
 *
 * A caixa "ver as cartas" da Loja e a lista de drops da Trilha são a MESMA
 * (`gavetas.js` + `web/css/gavetas.css`). O visual dela não se prova aqui — o
 * que se prova é o **gesto de ler a carta**, que a Loja ligou e a Trilha ainda
 * não, e que erra calado de três jeitos:
 *
 *   • **o gesto abre a carta ERRADA.** Todo id passa pelo mesmo laço, e uma
 *     função presa na variável do laço abriria sempre a última carta da
 *     gaveta. Nada quebra: a janela abre, com a carta de outra pessoa;
 *   • **a janela abre DUAS vezes.** `wireLongPress` devolve um "consumiu?"
 *     justamente porque soltar o botão depois de segurar dispara o clique logo
 *     atrás. Ignorar essa resposta reabre o mesmo detalhe;
 *   • **o "segurar" não conta.** O navegador começa a arrastar uma `<img>` ao
 *     primeiro pixel de movimento com o botão apertado, e o `dragstart` cancela
 *     a contagem — sem `draggable="false"` o gesto falha para quem não segura a
 *     mão parada, e falha em silêncio.
 *
 * E o que a Trilha garante: **sem `aoAmpliar` a miniatura fica como sempre
 * foi**. Um cursor de lupa ou um `onclick` pendurado numa caixa que não tem
 * janela para abrir seria uma promessa que a tela não cumpre.
 *
 * O DOM é de mentira e mínimo: o front tem ZERO dependências, então não há
 * jsdom aqui. Ele responde só ao que o módulo usa.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

// ------------------------------------------------------------ o DOM de mentira
function elemento(tag) {
  const el = {
    tag, filhos: [], innerHTML: '', title: '', className: '', textContent: undefined,
    append(...f) { el.filhos = el.filhos.filter((x) => !f.includes(x)).concat(f); },
    replaceChildren(...f) { el.filhos = f; },
    addEventListener() {},
  };
  return el;
}
globalThis.document = { createElement: elemento };

// ------------------------------------------------------ a carteira de mentira
// `gavetas.js` importa `wallet.js` pelo caminho ABSOLUTO do navegador
// (`/web/js/wallet.js`), que em Node não resolve — e importar a carteira de
// verdade arrastaria o Supabase junto, para responder uma pergunta que este
// teste não faz (o ✔ de "você tem" é assunto da coleção, não do gesto).
//
// Então o módulo é carregado com a linha do import TROCADA por dois retornos
// fixos. O `assert` no meio é o que impede o teste de virar um espelho vazio no
// dia em que esse import mudar de forma: sem ele a troca falharia calada e o
// arquivo carregado seria outro.
const fonte = readFileSync(new URL('./gavetas.js', import.meta.url), 'utf8');
const trocado = fonte.replace(
  /^import \{[^}]*\} from '\/web\/js\/wallet\.js';$/m,
  'const ownsCard = () => false, ownedCount = () => 0;');
assert.notEqual(trocado, fonte,
  'o import de wallet.js mudou de forma — conserte a troca aqui, senao o teste roda no arquivo errado');
const { renderGavetas } = await import(
  'data:text/javascript;charset=utf-8,' + encodeURIComponent(trocado));

/** As miniaturas (`.carta`) de todas as gavetas, na ordem. */
const cartas = (alvo) => alvo.filhos.flatMap((g) => g.filhos.at(-1).filhos);

const POOL = { UR: [1001], SR: [], R: [2002, 3003], N: [] };

// ------------------------------------------------------------------- a Trilha
t('sem aoAmpliar a miniatura fica INERTE, como sempre foi', () => {
  const alvo = elemento('div');
  renderGavetas(alvo, POOL);
  for (const c of cartas(alvo)) {
    assert.equal(c.onclick, undefined, 'pendurou clique numa caixa sem janela para abrir');
    assert.equal(c.oncontextmenu, undefined, 'pendurou botao direito sem janela para abrir');
    assert.ok(!c.className.includes('lupa'), 'prometeu o cursor de lupa sem gesto nenhum');
    assert.ok(!/segurar/.test(c.title), 'o title anuncia um gesto que a tela nao liga');
  }
});

// --------------------------------------------------------------------- a Loja
t('cada miniatura abre o SEU id, e nao o ultimo da gaveta', () => {
  const abertos = [];
  const alvo = elemento('div');
  renderGavetas(alvo, POOL, { aoAmpliar: (id) => abertos.push(id) });
  cartas(alvo).forEach((c) => c.onclick());
  assert.deepEqual(abertos, [1001, 2002, 3003]);
});

t('o botao direito abre a mesma carta, sem menu do navegador', () => {
  const abertos = [];
  const alvo = elemento('div');
  renderGavetas(alvo, POOL, { aoAmpliar: (id) => abertos.push(id) });
  let barrou = 0;
  cartas(alvo)[1].oncontextmenu({ preventDefault: () => barrou++ });
  assert.deepEqual(abertos, [2002]);
  assert.equal(barrou, 1, 'deixou o menu de contexto do navegador aparecer por cima');
});

t('segurar abre UMA vez — o clique de soltar nao reabre a janela', () => {
  // `wireLongPress` devolve o "consumiu?" exatamente para isto: soltar o botao
  // depois de segurar dispara o `click` logo atras.
  const abertos = [];
  const alvo = elemento('div');
  let aoSegurar = null;
  renderGavetas(alvo, { UR: [7], SR: [], R: [], N: [] }, {
    aoAmpliar: (id) => abertos.push(id),
    ligarGesto: (_el, acao) => {
      aoSegurar = acao;
      let disparou = false;
      return () => { const r = disparou; disparou = false; return r; };
    },
  });
  // Aqui o `ligarGesto` de mentira nunca dispara, então o clique vale.
  cartas(alvo)[0].onclick();
  assert.deepEqual(abertos, [7]);
  assert.ok(typeof aoSegurar === 'function', 'o gesto nem chegou a ser ligado na miniatura');
});

t('o "consumiu?" do gesto BARRA o clique seguinte', () => {
  const abertos = [];
  const alvo = elemento('div');
  let segurando = false;
  renderGavetas(alvo, { UR: [7], SR: [], R: [], N: [] }, {
    aoAmpliar: (id) => abertos.push(id),
    ligarGesto: (_el, acao) => {
      // Segurar de verdade: a ação roda e o "consumiu?" fica armado.
      segurando = true; acao();
      return () => { const r = segurando; segurando = false; return r; };
    },
  });
  cartas(alvo)[0].onclick();   // o clique de SOLTAR
  assert.deepEqual(abertos, [7], 'a janela abriu duas vezes no mesmo gesto');
});

t('a arte nao arrasta — arrastar CANCELA a contagem do segurar', () => {
  const alvo = elemento('div');
  renderGavetas(alvo, POOL, { aoAmpliar: () => {} });
  for (const c of cartas(alvo)) {
    assert.match(c.innerHTML, /<img[^>]*draggable="false"/,
      'a <img> arrasta, e o dragstart mata o "segurar" sem erro nenhum');
  }
});

t('com o gesto ligado, o title e o cursor anunciam que da para ler', () => {
  const alvo = elemento('div');
  renderGavetas(alvo, POOL, { nomeDe: () => 'Dark Magician', aoAmpliar: () => {} });
  const c = cartas(alvo)[0];
  assert.match(c.title, /^Dark Magician/);
  assert.match(c.title, /segurar/);
  assert.ok(c.className.includes('lupa'), 'sem a classe o cursor nao muda e o gesto fica escondido');
});

// ------------------------------------------------------------------- o CSS
t('quem usa o modulo tambem carrega o CSS dele', () => {
  // Sem a folha as gavetas viram uma lista de imagens soltas — e o `.lupa` do
  // cursor do "segurar" mora nela.
  //
  // A varredura vai em DOIS passos porque nenhuma página importa `gavetas.js`
  // direto: quem importa é o módulo da tela (`loja.js`, `trilha.js`), e é a
  // página que linka o CSS. Olhar só o HTML não veria nada.
  const JS = new URL('./', import.meta.url);
  const DIR = new URL('../', import.meta.url);

  const telas = readdirSync(JS)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /from '\/web\/js\/gavetas\.js'/.test(readFileSync(new URL(f, JS), 'utf8')));
  assert.ok(telas.length >= 2,
    `so ${telas.length} modulo(s) importam as gavetas — a varredura cegou`);

  const paginas = readdirSync(DIR).filter((f) => f.endsWith('.html'));
  let checadas = 0;
  for (const tela of telas) {
    const usa = new RegExp(`src="/web/js/${tela.replace('.', '\\.')}"`);
    for (const p of paginas) {
      const html = readFileSync(new URL(p, DIR), 'utf8');
      if (!usa.test(html)) continue;
      checadas++;
      assert.match(html, /css\/gavetas\.css/, `${p} carrega ${tela} e nao linka o CSS das gavetas`);
    }
  }
  assert.ok(checadas >= 2, `so ${checadas} pagina(s) casaram com os modulos — a varredura cegou`);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);

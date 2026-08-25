/**
 * A REVELAÇÃO carta a carta — `node web/js/revelacao.test.mjs`
 *
 * Duas telas dividem esta cerimônia: o drop do NPC no fim de duelo e a abertura
 * de pacote na Loja. O VISUAL dela (a virada, a aproximação, a grade) não se
 * prova aqui — isso é `node tools/bancada-revelacao.mjs`, que a põe na tela sem
 * servidor e sem login. O que sobra para o teste é o pouco que TRAVA o jogo:
 *
 *   • **`aoTerminar` dispara na ÚLTIMA carta, uma vez só.** É ele que religa os
 *     botões de saída do fim de duelo e o [abrir outro] da Loja. Cedo demais
 *     libera a saída por cima do prêmio; nunca, e o jogador fica preso numa tela
 *     de botões desligados — sem erro nenhum;
 *   • **a carta abre uma vez.** Ela continua clicável depois de revelada de
 *     propósito (um `disabled` a apagaria pelo `button:disabled` de `ui.css` e
 *     mataria o "segurar para ampliar"), então quem conta é este módulo;
 *   • **quem usa o módulo carrega o CSS dele.** Sem a folha nada gira e a grade
 *     desmonta — e foi a falta dessa pergunta que deixou a Loja com uma
 *     revelação própria, sem virada, por tanto tempo;
 *   • **o [organizar por raridade]** — a ordem UR→N, a volta para a ordem do
 *     pacote (que é a única que diz de qual dos dez pacotes cada carta veio), a
 *     sem-raridade indo para o FIM (um `indexOf` cru devolve -1 e a jogaria na
 *     frente da UR, calado) e o fato de organizar REVELAR o que ainda estiver
 *     virado — agrupar cartas viradas diria onde estão as boas antes de alguém
 *     as virar.
 *
 * O DOM é de mentira e mínimo: o front tem ZERO dependências, então não há
 * jsdom aqui. Ele responde só ao que o módulo usa.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { montarRevelacao } from './revelacao.js';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

// ------------------------------------------------------------ o DOM de mentira
function elemento(tag) {
  const el = {
    tag, filhos: [], innerHTML: '', title: '',
    style: { _v: {}, setProperty(k, v) { this._v[k] = v; }, valor(k) { return this._v[k]; } },
    classes: new Set(),
    // `append` de um no' que ja' esta' no pai o MOVE — e' disso que a
    // reordenacao vive, entao o DOM de mentira precisa fazer o mesmo.
    append(...f) { el.filhos = el.filhos.filter((x) => !f.includes(x)).concat(f); },
    replaceChildren(...f) { el.filhos = f; },
    addEventListener() {},
  };
  el.classList = {
    add: (...c) => c.forEach((x) => el.classes.add(x)),
    remove: (...c) => c.forEach((x) => el.classes.delete(x)),
    contains: (c) => el.classes.has(c),
  };
  return el;
}
globalThis.document = { createElement: elemento };

/** As cartas (`.rev-carta`) da grade, na ordem. */
const cartas = (alvo) => alvo.filhos[0].filhos.map((cel) => cel.filhos[0]);
const itens = (n) => Array.from({ length: n }, (_, i) => ({ id: 100 + i, raridade: 'N' }));

t('a carta abre no clique, e insistir nela nao conta como progresso', () => {
  const alvo = elemento('div');
  let fim = 0;
  montarRevelacao(alvo, itens(2), { aoTerminar: () => fim++ });
  const [a, b] = cartas(alvo);

  a.onclick();
  assert.ok(a.classList.contains('aberta'));
  a.onclick(); a.onclick();
  assert.equal(fim, 0, 'reabrir a mesma carta liberou a saida com a outra virada');

  b.onclick();
  assert.equal(fim, 1);
});

t('[revelar rapido] abre TUDO de verdade, e nao so avisa que acabou', () => {
  // A diferenca importa: um atalho que so' chamasse o callback deixaria as 50
  // cartas viradas na tela com os botoes ja' livres.
  const alvo = elemento('div');
  let fim = 0;
  const rev = montarRevelacao(alvo, itens(5), { aoTerminar: () => fim++ });
  rev.revelarTudo();
  rev.revelarTudo();
  assert.ok(cartas(alvo).every((c) => c.classList.contains('aberta')));
  assert.equal(fim, 1, 'o aoTerminar disparou mais de uma vez');
});

t('lista vazia ja chega terminada (senao a saida travaria para sempre)', () => {
  const alvo = elemento('div');
  let fim = 0;
  montarRevelacao(alvo, [], { aoTerminar: () => fim++ });
  assert.equal(fim, 1);
});

t('o nome so aparece DEPOIS de virar', () => {
  const alvo = elemento('div');
  montarRevelacao(alvo, [{ id: 46986414, raridade: 'UR' }], { nomeDe: () => 'Dark Magician' });
  const cel = alvo.filhos[0].filhos[0];
  assert.equal(cel.filhos[1].textContent, undefined, 'o nome vazou antes da virada');
  cel.filhos[0].onclick();
  assert.equal(cel.filhos[1].textContent, 'Dark Magician');
});

t('o selo de raridade e o NEW!! ficam na face da FRENTE', () => {
  // Dentro dela porque VIRAM com a carta: no verso, o selo entregaria a
  // raridade antes da revelacao e a virada nao descobriria mais nada.
  const alvo = elemento('div');
  montarRevelacao(alvo, [{ id: 1, raridade: 'UR', nova: true, selo: '★' }]);
  const html = cartas(alvo)[0].innerHTML;
  const frente = html.slice(html.indexOf('rev-frente'));
  assert.match(frente, /rev-rar">★UR</);
  assert.match(frente, /rev-nova/);
});

// ------------------------------------------------------- organizar por raridade

t('[organizar por raridade] agrupa UR->N e VOLTA a ordem do pacote', () => {
  const alvo = elemento('div');
  const lote = [
    { id: 1, raridade: 'N' }, { id: 2, raridade: 'UR' },
    { id: 3, raridade: 'R' }, { id: 4, raridade: 'SR' }, { id: 5, raridade: 'N' },
  ];
  const rev = montarRevelacao(alvo, lote);
  const ordemDe = () => alvo.filhos[0].filhos.map((cel) => cel.id);
  // A celula nao guarda o item, entao a ordem sai pelo `id` que o teste marca.
  alvo.filhos[0].filhos.forEach((cel, i) => { cel.id = lote[i].id; });

  rev.ordenar(true);
  assert.deepEqual(ordemDe(), [2, 4, 3, 1, 5], 'nao agrupou UR->SR->R->N');
  assert.ok(rev.agrupadoPorRaridade());

  rev.ordenar(false);
  assert.deepEqual(ordemDe(), [1, 2, 3, 4, 5], 'a ordem do pacote nao voltou');
  assert.ok(!rev.agrupadoPorRaridade());
});

t('carta sem raridade vai para o FIM, e nao para a frente', () => {
  // Ausencia de raridade nao e' um degrau da escala — e um `indexOf` cru
  // devolve -1, que ordenaria a sem-raridade ANTES da UR, calado.
  const alvo = elemento('div');
  const lote = [{ id: 1 }, { id: 2, raridade: 'N' }, { id: 3, raridade: 'UR' }];
  const rev = montarRevelacao(alvo, lote);
  alvo.filhos[0].filhos.forEach((cel, i) => { cel.id = lote[i].id; });
  rev.ordenar(true);
  assert.deepEqual(alvo.filhos[0].filhos.map((c) => c.id), [3, 2, 1]);
});

t('organizar REVELA o que ainda estava virado', () => {
  // Agrupar com cartas viradas diria onde estao as boas antes de alguem as
  // virar: a cerimonia morreria sem nenhum aviso.
  const alvo = elemento('div');
  let fim = 0;
  const rev = montarRevelacao(alvo, itens(4), { aoTerminar: () => fim++ });
  rev.ordenar(true);
  assert.ok(cartas(alvo).every((c) => c.classList.contains('aberta')));
  assert.equal(fim, 1);
});

t('quem usa o modulo tambem carrega o CSS dele', () => {
  const DIR = new URL('../', import.meta.url);
  const paginas = readdirSync(DIR).filter((f) => f.endsWith('.html'));
  let usam = 0;
  for (const f of paginas) {
    const html = readFileSync(new URL(f, DIR), 'utf8');
    if (!/revelacao\.js/.test(html)) continue;
    usam++;
    assert.match(html, /css\/revelacao\.css/, `${f} usa o modulo e nao linka o CSS`);
  }
  assert.ok(usam >= 2, `so ${usam} pagina(s) usam o modulo — a varredura cegou`);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);

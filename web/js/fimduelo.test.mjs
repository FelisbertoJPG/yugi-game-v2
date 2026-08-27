/**
 * **A tela de fim de duelo** — `node web/js/fimduelo.test.mjs`
 *
 * É a tela menos exercitada do jogo: só aparece quando o duelo acaba, e a parte
 * com prêmio só quando você VENCE um adversário que tem pool de drop. Quando ela
 * quebra, quebra no pior momento possível — o jogador já ganhou o DP e as cartas
 * (quem credita é `premiar_vitoria`, no servidor, antes desta tela existir) e
 * fica olhando uma mesa morta.
 *
 * Foi o que aconteceu: `renderDrops` passava `{ nomeDe }` para
 * `montarRevelacao`, onde a função da tela se chama `nameOf`. Um
 * `ReferenceError` na montagem do objeto — e a ordem das linhas transformou um
 * erro de digitação em beco sem saída:
 *
 * ```
 * liberarSaidaDoFim(false);        ← desliga [novo duelo] e [voltar para a home]
 * montarRevelacao(..., { nomeDe }) ← ESTOURA aqui
 * ...
 * $('end-overlay').hidden = false; ← nunca chega
 * ```
 *
 * Botões desligados, overlay nunca mostrado, e a mensagem vermelha do `catch` do
 * `apply` por cima. `node web/js/atalhos.test.mjs` guarda a CAUSA (o atalho de
 * propriedade órfão, em todo o front); este arquivo guarda a CONSEQUÊNCIA, que é
 * o que o jogador sentiu — e que qualquer outra exceção nesse trecho produziria
 * de novo.
 *
 * As funções são **FATIADAS** do `duel.html`, nunca copiadas: uma cópia passaria
 * a valer por si e deixaria de provar o que está no jogo — a mesma regra das
 * bancadas (`tools/bancada-visual.mjs`). O `montarRevelacao` é o módulo de
 * verdade; só o DOM é de mentira, porque o front tem ZERO dependências e não há
 * jsdom aqui.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarRevelacao } from './revelacao.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DUEL = readFileSync(join(RAIZ, 'duel.html'), 'utf8');

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

/** Fatia um bloco do `duel.html` entre dois marcadores, incluindo os dois. */
function fatia(de, ate, nome) {
  const i = DUEL.indexOf(de);
  const j = DUEL.indexOf(ate, i);
  assert.ok(i >= 0 && j >= 0, `nao achei o bloco ${nome} no duel.html`);
  return DUEL.slice(i, j + ate.length);
}

// ------------------------------------------------------------ o DOM de mentira
function elemento(tag) {
  const el = {
    tag, filhos: [], innerHTML: '', title: '', textContent: '',
    hidden: false, disabled: false, onclick: null, oncontextmenu: null,
    style: { _v: {}, setProperty(k, v) { this._v[k] = v; } },
    classes: new Set(),
    append(...f) { el.filhos = el.filhos.filter((x) => !f.includes(x)).concat(f); },
    replaceChildren(...f) { el.filhos = f; },
    addEventListener() {},
    querySelector() { return elemento('img'); },
  };
  el.classList = {
    add: (...c) => c.forEach((x) => el.classes.add(x)),
    remove: (...c) => c.forEach((x) => el.classes.delete(x)),
    toggle: (c, v) => (v ? el.classes.add(c) : el.classes.delete(c)),
    contains: (c) => el.classes.has(c),
  };
  return el;
}

/** Uma tela nova a cada caso: estado de teste que vaza esconde regressão. */
function tela() {
  const ids = new Map();
  const $ = (id) => {
    if (!ids.has(id)) ids.set(id, elemento('div'));
    return ids.get(id);
  };
  globalThis.document = {
    createElement: elemento,
    querySelector: () => $('end-box'),
  };
  return { $, ids };
}

/** As cartas (`.rev-carta`) da grade montada dentro de `#end-drops`. */
const cartas = (caixa) => (caixa.filhos[0]?.filhos ?? [])
  .flatMap((cel) => cel.filhos.filter((x) => x.classes?.has?.('rev-carta')
                                          || x.tag === 'button'));

/**
 * Monta as funções REAIS do `duel.html` com as dependências injetadas.
 *
 * `nameOf` devolve um nome de verdade de propósito: é o que prova que o
 * resolvedor chegou até a revelação — com o atalho órfão isto nem executava.
 */
function montarTela({ nameOf = (id) => `carta ${id}` } = {}) {
  const { $ } = tela();
  const fonte = [
    fatia('function renderDrops(drops) {', '  pular.onclick = () => rev.revelarTudo();\n}', 'renderDrops'),
    fatia('function liberarSaidaDoFim(pode) {', "$('end-again').disabled = !pode;\n}", 'liberarSaidaDoFim'),
    fatia('function mostrarFimDuelo(venci, empate, premio) {', "$('end-overlay').hidden = false;\n}", 'mostrarFimDuelo'),
    fatia('function mostrarIconeGanho(icone) {', "caixa.querySelector('.nome').textContent = icone.nome;\n}", 'mostrarIconeGanho'),
  ].join('\n\n');

  const fabrica = new Function(
    '$', 'nameOf', 'ART', 'montarRevelacao', 'showCardDetail', 'wireLongPress',
    'HOLD_MS', 'caminhoDoIcone', 'lp',
    `${fonte}\nreturn { renderDrops, mostrarFimDuelo, liberarSaidaDoFim };`);

  const api = fabrica(
    $, nameOf, (id) => `arte/${id}.jpg`, montarRevelacao, () => {}, () => () => false,
    400, (i) => i.imagem ?? '', { 0: 8000, 1: 0 });
  return { ...api, $ };
}

// --------------------------------------------------------------- o caso do bug

t('vencer COM drop: a tela de fim aparece', () => {
  // O relato: vencer o Panik devolvia "ERRO na tela: nomeDe is not defined" e
  // NENHUMA tela de fim — a linha que a mostra vem depois da que estourava.
  const { mostrarFimDuelo, $ } = montarTela();
  mostrarFimDuelo(true, false, {
    dp: 200,
    drops: [{ id: 46986414, raridade: 'UR', nova: true }, { id: 5053103, raridade: 'N' }],
  });
  assert.equal($('end-overlay').hidden, false, 'o overlay do fim de duelo nao apareceu');
  assert.equal($('end-title').textContent, 'Você venceu!');
});

t('e as cartas do premio chegam viradas, com o NOME resolvido', () => {
  // `nomeDe: nameOf` é o que o atalho órfão impedia de existir. Um nome errado
  // aqui é o sintoma barato do mesmo erro: a carta apareceria como "46986414".
  const { renderDrops, $ } = montarTela();
  renderDrops([{ id: 46986414, raridade: 'UR', nova: true }, { id: 5053103, raridade: 'N' }]);
  const grade = cartas($('end-drops'));
  assert.equal(grade.length, 2, 'as duas cartas do drop tinham de estar na grade');
  assert.ok(grade.every((b) => !b.classes.has('aberta')), 'as cartas chegam VIRADAS');
  grade[0].onclick();
  assert.match(grade[0].title, /carta 46986414/,
    'o nome nao chegou a revelacao — e `nomeDe` que o leva ate la');
});

t('os botoes de saida VOLTAM quando a ultima carta abre', () => {
  // A trava é de propósito (o prêmio não pode passar despercebido atrás de um
  // clique apressado em "novo duelo"), e por isso ela precisa destravar. Com a
  // exceção no meio, ela ficava ligada para sempre: vitória sem saída.
  const { renderDrops, $ } = montarTela();
  renderDrops([{ id: 46986414, raridade: 'UR' }, { id: 5053103, raridade: 'N' }]);
  assert.equal($('end-home').disabled, true, 'com carta virada a saida fica desligada');
  for (const b of cartas($('end-drops'))) b.onclick();
  assert.equal($('end-home').disabled, false, '[voltar para a home] ficou desligado');
  assert.equal($('end-again').disabled, false, '[novo duelo] ficou desligado');
  assert.equal($('end-pular').hidden, true, 'o [pular] devia sumir com tudo revelado');
});

t('o [pular] revela tudo de uma vez e tambem devolve a saida', () => {
  const { renderDrops, $ } = montarTela();
  renderDrops([{ id: 46986414, raridade: 'UR' }, { id: 5053103, raridade: 'N' }]);
  $('end-pular').onclick();
  assert.equal($('end-home').disabled, false);
  assert.ok(cartas($('end-drops')).every((b) => b.classes.has('aberta')));
});

// ------------------------------------------------------------ os outros fins

t('perder (sem premio nenhum) libera a saida na hora', () => {
  // Sem drop, `renderDrops` volta antes de tudo — e era por isso que o bug só
  // aparecia na VITORIA contra quem tem pool. O par controle importa: se a
  // saida ficasse presa aqui, quem perde nao sairia da tela.
  const { mostrarFimDuelo, $ } = montarTela();
  mostrarFimDuelo(false, false, null);
  assert.equal($('end-overlay').hidden, false);
  assert.equal($('end-title').textContent, 'Você perdeu');
  assert.equal($('end-home').disabled, false, 'quem perdeu ficou preso na tela');
  assert.equal($('end-pular').hidden, true, 'sem drop nao ha o que pular');
});

t('vitoria sem pool de drop tambem libera (premio so de DP)', () => {
  const { mostrarFimDuelo, $ } = montarTela();
  mostrarFimDuelo(true, false, { dp: 100, drops: [] });
  assert.equal($('end-overlay').hidden, false);
  assert.equal($('end-home').disabled, false);
});

t('o icone ganho aparece; sem icone, a caixa some', () => {
  // `#end-icone` tem guarda `[hidden]` propria em `duel.html` (ver
  // `esconder.test.mjs`); aqui o que se prova e' a DECISAO de mostra-la.
  const comIcone = montarTela();
  comIcone.mostrarFimDuelo(true, false, { dp: 50, drops: [], icone: { nome: 'Panik', imagem: 'data:,' } });
  assert.equal(comIcone.$('end-icone').hidden, false);

  const sem = montarTela();
  sem.mostrarFimDuelo(true, false, { dp: 50, drops: [] });
  assert.equal(sem.$('end-icone').hidden, true, 'sem icone a caixa tem de sumir');
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);

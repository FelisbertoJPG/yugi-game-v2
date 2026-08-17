/**
 * Testes da FILA DE VISOES.
 *   node web/js/filavisoes.test.mjs
 *
 * O caso 3 e' o acidente de verdade, reproduzido: uma aplicacao que ESPERA por
 * dentro (o aviso de fase) sendo atropelada por uma visao que chega no meio.
 * Sem fila, a aplicacao mais VELHA termina por ultimo e escreve o estado antigo
 * por cima do novo — a janela de corrente some da tela e o duelo trava
 * esperando uma resposta que ninguem consegue mais dar.
 *
 * Nada disto precisa de navegador: a fila nao toca no DOM de proposito. E' o
 * unico jeito de eu provar concorrencia sem duas pessoas jogando de verdade.
 */
import { criarFilaDeVisoes } from './filavisoes.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const testes = [];
const t = (nome, fn) => testes.push([nome, fn]);
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------- ordem

t('aplica na ORDEM de chegada, mesmo com tempos diferentes', async () => {
  const ordem = [];
  const fila = criarFilaDeVisoes(async (v) => {
    await dorme(v.demora);
    ordem.push(v.id);
  });
  fila.enfileirar({ id: 'a', demora: 30 });
  fila.enfileirar({ id: 'b', demora: 1 });
  await fila.enfileirar({ id: 'c', demora: 1 });
  assert.deepEqual(ordem, ['a', 'b', 'c'], 'a ordem do motor tem de ser a ordem da tela');
});

t('NUNCA duas aplicacoes vivas ao mesmo tempo', async () => {
  let vivas = 0, maximo = 0;
  const fila = criarFilaDeVisoes(async () => {
    vivas += 1; maximo = Math.max(maximo, vivas);
    await dorme(5);
    vivas -= 1;
  });
  fila.enfileirar({}); fila.enfileirar({});
  await fila.enfileirar({});
  assert.equal(maximo, 1, `duas aplicacoes se sobrepuseram (pico de ${maximo})`);
});

// -------------------------------------------------- o acidente de 17/08/2026

t('a visao VELHA nao apaga a pergunta que acabou de chegar', async () => {
  // Espelha o `apply` do duel.html: ele ESPERA no meio (aviso de fase) e so'
  // no fim escreve `question = j.question`.
  let question = null;
  const aplicar = async (v) => {
    if (v.temFase) await dorme(40);   // o aviso de fase segurando o laco
    question = v.question;            // o passo que apagava a janela
  };

  const fila = criarFilaDeVisoes(aplicar);
  fila.enfileirar({ temFase: true, question: null });        // a End Phase
  await dorme(10);                                           // ...e no meio dela:
  await fila.enfileirar({ temFase: false, question: 'chain: Aegis' });

  assert.equal(question, 'chain: Aegis',
    'a janela de corrente foi apagada pela aplicacao anterior — o duelo trava aqui');
});

t('SEM fila o mesmo cenario perde a pergunta (prova que o teste tem dente)', async () => {
  let question = null;
  const aplicar = async (v) => {
    if (v.temFase) await dorme(40);
    question = v.question;
  };
  aplicar({ temFase: true, question: null });                 // sem esperar, como a ponte fazia
  await dorme(10);
  await aplicar({ temFase: false, question: 'chain: Aegis' });
  await dorme(60);
  assert.equal(question, null, 'sem fila a visao velha DEVE vencer — e' + ' o bug');
});

// ------------------------------------------------------------- ritmo e erro

t('`esperando` acusa visao na fila (e' + ' o que faz o aviso de fase nao atrasar)', async () => {
  let durante = null;
  const fila = criarFilaDeVisoes(async () => {
    durante = fila.esperando;   // lido DENTRO da primeira aplicacao
    await dorme(10);
  });
  const p = fila.enfileirar({});
  fila.enfileirar({});          // chega enquanto a primeira roda
  await p;
  assert.equal(durante, true, 'com visao esperando, a pausa dramatica vira atraso');
});

t('sozinha na fila, `esperando` e' + ' falso (o ritmo normal vale)', async () => {
  let durante = null;
  const fila = criarFilaDeVisoes(async () => { durante = fila.esperando; });
  await fila.enfileirar({});
  assert.equal(durante, false);
});

t('uma aplicacao que EXPLODE nao trava a fila', async () => {
  const feitas = [];
  const fila = criarFilaDeVisoes(async (v) => {
    if (v.id === 'ruim') throw new Error('erro de tela');
    feitas.push(v.id);
  });
  const ruim = fila.enfileirar({ id: 'ruim' });
  await assert.rejects(ruim, /erro de tela/, 'quem espera precisa VER o erro');
  await fila.enfileirar({ id: 'depois' });
  assert.deepEqual(feitas, ['depois'], 'a visao seguinte tem de ser aplicada assim mesmo');
});

t('a contagem volta a zero quando tudo assenta', async () => {
  const fila = criarFilaDeVisoes(async () => { await dorme(1); });
  fila.enfileirar({}); fila.enfileirar({});
  await fila.enfileirar({});
  assert.equal(fila.pendentes, 0, `sobrou ${fila.pendentes} na contagem`);
});

t('sem funcao de aplicar, recusa na hora de criar', () => {
  assert.throws(() => criarFilaDeVisoes(null), /funcao/);
});

// ---------------------------------------------------------------------------

for (const [nome, fn] of testes) {
  try { await fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
}
console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

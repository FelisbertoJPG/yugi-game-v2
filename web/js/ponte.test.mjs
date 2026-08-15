/**
 * Testes da PERSPECTIVA da ponte.
 *   node web/js/ponte.test.mjs
 *
 * O `duel.html` tem uma suposição embutida em cada linha: **jogador 0 sou eu**.
 * `hand[0]` é uma lista de códigos e `hand[1]` é só um NÚMERO (a contagem da mão
 * do adversário); `field[0]` desenha embaixo, `field[1]` em cima.
 *
 * Quem entra na sala como segundo é o jogador 1 do motor. Sem virar a mesa na
 * entrada, quatro coisas quebram de uma vez — e foi o relato do primeiro teste
 * de verdade:
 *
 *   1. a mão dele cai em `hand[1]` (um número) → "carta não encontrada";
 *   2. o campo dele desenha em cima, no lugar do adversário;
 *   3. ele não consegue jogar, porque a tela só oferece ação ao 0;
 *   4. o turno parece compartilhado, porque os dois se veem como 0.
 *
 * Estes casos existem porque o erro é VISÍVEL mas não é uma exceção: nada
 * quebra, tudo aparece do lado errado. Um teste que só olha "chegou evento?"
 * passaria com a mesa invertida.
 */
// Importa a função DE VERDADE — nada de reimplementar a lógica aqui, senão o
// teste passa enquanto o jogo quebra.
import { espelharVisao, CAMPOS_DE_JOGADOR } from './ponte.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log(`  \x1b[32mOK  \x1b[0m ${nome}`); pass++; }
  catch (e) { console.log(`  \x1b[31mFALHA\x1b[0m ${nome}\n        ${e.message}`); fail++; }
};

// ---------------------------------------------------------------- o jogador 1

t('a MAO do jogador 1 chega como sendo a dele (o bug do "carta nao encontrada")', () => {
  const visao = {
    events: [{ type: 'draw', player: 1, cards: [{ code: 46986414, hidden: false }] }],
    question: null, ended: false,
  };
  const v = espelharVisao(visao, 1);
  assert.equal(v.events[0].player, 0, 'a mao dele tem de virar player 0 — hand[0] e a lista');
  assert.equal(v.events[0].cards[0].code, 46986414, 'o codigo nao pode se perder no caminho');
});

t('a mao do ADVERSARIO vira a contagem (player 1)', () => {
  const v = espelharVisao({ events: [{ type: 'draw', player: 0, cards: [{ code: 0, hidden: true }] }] }, 1);
  assert.equal(v.events[0].player, 1);
});

t('o CAMPO dele desce para baixo (controller 1 -> 0)', () => {
  const v = espelharVisao({
    events: [{ type: 'move', code: 5053103, controller: 1, fromCtrl: 1, loc: 4, seq: 0, pos: 1 }],
  }, 1);
  assert.equal(v.events[0].controller, 0, 'o campo dele tem de desenhar embaixo');
  assert.equal(v.events[0].fromCtrl, 0, 'a origem tambem vira');
});

t('a PERGUNTA vira dele (o bug de "nao consegui fazer nada")', () => {
  const v = espelharVisao({ events: [], question: { kind: 'idle', player: 1, choices: [] } }, 1);
  assert.equal(v.question.player, 0, 'sem isto a tela nao oferece acao nenhuma');
});

t('os ALVOS dentro da pergunta viram junto', () => {
  const v = espelharVisao({
    events: [],
    question: { kind: 'selectcard', player: 1, choices: [
      { code: 111, controller: 1, location: 4, sequence: 0 },
      { code: 222, controller: 0, location: 4, sequence: 1 },
    ] },
  }, 1);
  assert.equal(v.question.choices[0].controller, 0, 'a carta dele e do lado dele');
  assert.equal(v.question.choices[1].controller, 1, 'e a do adversario, do outro');
});

t('o TURNO vira (o bug do "turno compartilhado")', () => {
  const v = espelharVisao({ events: [{ type: 'turn', player: 1 }] }, 1);
  assert.equal(v.events[0].player, 0, 'o turno dele tem de aparecer como "seu turno"');
});

t('LP e vencedor tambem viram', () => {
  const v = espelharVisao({
    events: [{ type: 'lp', player: 1, lp: 7000, delta: -1000 }, { type: 'end', winner: 1 }],
  }, 1);
  assert.equal(v.events[0].player, 0, 'o dano nele e o SEU dano');
  assert.equal(v.events[1].winner, 0, 'se o motor diz que o 1 ganhou, para ele foi vitoria');
});

// ---------------------------------------------------------------- o jogador 0

t('para o jogador 0 NADA muda (a mesa ja esta do jeito dele)', () => {
  const visao = {
    events: [{ type: 'draw', player: 0, cards: [{ code: 99 }] }, { type: 'turn', player: 1 }],
    question: { kind: 'idle', player: 0 },
    ended: false,
  };
  assert.deepEqual(espelharVisao(visao, 0), visao);
});

// ------------------------------------------------------------------- bordas

t('campo que NAO e de jogador nao e tocado', () => {
  const v = espelharVisao({
    events: [{ type: 'move', code: 1, controller: 1, loc: 1, seq: 1, pos: 1, fromSeq: 0 }],
  }, 1);
  const e = v.events[0];
  assert.equal(e.loc, 1, 'loc nao e jogador');
  assert.equal(e.seq, 1, 'seq nao e jogador');
  assert.equal(e.pos, 1, 'pos nao e jogador');
  assert.equal(e.code, 1, 'code nao e jogador');
});

t('valor de jogador fora de 0/1 passa intacto (ex.: winner -1 = empate)', () => {
  const v = espelharVisao({ events: [{ type: 'end', winner: -1 }] }, 1);
  assert.equal(v.events[0].winner, -1, 'empate nao vira vitoria de ninguem');
});

t('visao vazia ou nula nao explode', () => {
  assert.equal(espelharVisao(null, 1), null);
  assert.deepEqual(espelharVisao({ events: [] }, 1).events, []);
  assert.equal(espelharVisao({ events: [], question: null }, 1).question, null);
});

t('a tabela de campos cobre TODOS os que o motor emite', () => {
  // Se o `InteractiveDuel` ganhar um evento com um campo de jogador novo, ele
  // tem de entrar aqui — senão a carta aparece do lado errado, sem erro nenhum.
  for (const c of ['player', 'controller', 'fromCtrl', 'winner', 'chainTriggerPlayer']) {
    assert.ok(CAMPOS_DE_JOGADOR.includes(c), `campo "${c}" saiu da tabela do espelho`);
  }
});

t('o GATILHO da corrente vira (quem ativou a carta que abriu a janela)', () => {
  // A janela de corrente diz "seu oponente ativou X". O `chainTriggerPlayer`
  // sempre veio do motor, mas so' passou a ser LIDO quando a janela ganhou esse
  // texto — sem espelhar, o segundo jogador leria a frase com os lados trocados.
  const v = espelharVisao({
    events: [],
    question: { kind: 'chain', player: 1, chainTriggerKind: 'activation',
                chainTriggerCode: 55144522, chainTriggerPlayer: 0, choices: [] },
  }, 1);
  assert.equal(v.question.player, 0, 'a janela e minha');
  assert.equal(v.question.chainTriggerPlayer, 1, 'quem ativou foi o ADVERSARIO');
  assert.equal(v.question.chainTriggerCode, 55144522, 'o codigo da carta nao e jogador');
});

t('espelhar DUAS vezes volta ao original (a operacao e simetrica)', () => {
  const original = {
    events: [{ type: 'move', controller: 1, fromCtrl: 0 }, { type: 'lp', player: 1, lp: 8000 }],
    question: { kind: 'idle', player: 1 },
    ended: false,
  };
  assert.deepEqual(espelharVisao(espelharVisao(original, 1), 1), original);
});

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);

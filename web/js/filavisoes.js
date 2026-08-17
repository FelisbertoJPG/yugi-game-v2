/**
 * **A fila de visões do duelo — uma aplicação de cada vez.**
 *
 * Uma "visão" é o `{events, question, ended}` que o motor devolve. Aplicá-la
 * muta o estado da tela: o campo, a mão, os LP e — a parte perigosa — a
 * PERGUNTA pendente.
 *
 * De onde vem a concorrência: no modo NPC a visão chega como RETORNO da jogada
 * do próprio jogador, uma por vez, e nada se atropela. No MULTIPLAYER ela chega
 * por canal, quando o OUTRO joga, a qualquer momento. Enquanto aplicar uma
 * visão era instantâneo isso não incomodava; passou a incomodar no dia em que a
 * aplicação começou a ESPERAR por dentro (o aviso de fase segura o laço ~1 s de
 * propósito, para o duelo ficar legível).
 *
 * O acidente de 17/08/2026, lido nos lances de uma partida real:
 *
 *     43.019  estado: [{phase: 512}]  question: null        <- End Phase
 *     44.172  estado: question chain (Aegis) para a gabby
 *
 * 1,15 s entre os dois, e o aviso segura 1,1 s. A segunda aplicação rodou
 * inteira DENTRO da primeira: a janela apareceu na tela, a primeira acordou do
 * aviso, seguiu para o seu `question = j.question` — com o estado ANTIGO, onde
 * `question` era `null` — e apagou a janela. O duelo ficou esperando para
 * sempre uma resposta que a tela não tinha mais como dar.
 *
 * A regra, então, é uma só: **nunca duas aplicações vivas ao mesmo tempo**, e
 * na ordem de chegada, que é a ordem do motor. Uma corrente de promessas dá
 * exatamente isso, e é barata.
 *
 * `esperando` existe para o outro lado do problema: se já há visão na fila, a
 * pausa dramática do aviso de fase deixa de ser ritmo e vira atraso — quem
 * espera não é mais o jogador, é o duelo inteiro. Ver `avisoFase` no
 * `duel.html`.
 */

export function criarFilaDeVisoes(aplicar) {
  if (typeof aplicar !== 'function') throw new TypeError('a fila precisa de uma funcao para aplicar');

  let corrente = Promise.resolve();
  let pendentes = 0;

  /**
   * Põe a visão na fila. Devolve a promessa DESTA aplicação — quem quiser
   * esperar (o modo NPC espera, para travar o clique até assentar) espera; a
   * ponte não espera, e é por isso que a fila existe.
   */
  function enfileirar(visao) {
    pendentes += 1;
    const minha = corrente.then(() => aplicar(visao));
    // A CORRENTE nunca guarda uma promessa rejeitada: uma aplicação que falhou
    // não pode impedir a próxima visão de ser aplicada — no meio de um duelo,
    // parar de aplicar é pior que aplicar torto.
    corrente = minha.then(() => { pendentes -= 1; }, () => { pendentes -= 1; });
    return minha;
  }

  return {
    enfileirar,
    /** Quantas visões estão na fila, contando a que está sendo aplicada. */
    get pendentes() { return pendentes; },
    /** Há visão ESPERANDO além da que está sendo aplicada agora? */
    get esperando() { return pendentes > 1; },
  };
}

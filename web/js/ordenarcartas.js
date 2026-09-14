/**
 * A ORDEM de um grupo de cartas — a pergunta `sortcard` do motor
 * (MSG_SORT_CARD). É o "olhe as cartas do topo do seu Deck e devolva na ordem
 * que quiser" da Card Advance e de toda carta que chama
 * `Duel.SortDecktop`/`SortDeckbottom`.
 *
 * (Não confundir com `ordenar.js`, que é a tela "Ordenar Trilha" da Área de
 * Teste — a regra dela mora em `trilhaordem.js`.)
 *
 * Sem DOM, porque a conversão erra CALADA. O jogador clica as cartas na ordem
 * em que quer que fiquem (a 1ª clicada fica em cima); o motor quer o INVERSO
 * disso — para cada carta, na ordem em que ELE a listou, o lugar que ela vai
 * ocupar (`lugares[i]`, 0 = em cima). Mandar a lista de cliques crua dá uma
 * permutação válida, o motor aceita, e a ordem sai trocada sempre que houver
 * três cartas ou mais (com duas, a inversa é igual a ela mesma — e é por isso
 * que o erro passaria num teste feito com duas). Nada acusa: o deck só fica
 * numa ordem que ninguém pediu.
 *
 * O que o motor lista primeiro é a carta de CIMA — medido em
 * `--test-card-advance`, que compra a carta no turno seguinte.
 */

/**
 * Clicar numa carta: entra no fim da fila. Clicar de novo tira ela, e as de
 * trás sobem um lugar — o jogador corrige um clique sem recomeçar tudo.
 * Devolve uma lista NOVA.
 */
export function alternarNaOrdem(ordem, indice) {
  const atual = Array.isArray(ordem) ? ordem : [];
  return atual.includes(indice) ? atual.filter((i) => i !== indice) : [...atual, indice];
}

/** O lugar (1, 2, 3…) de uma carta na fila marcada, ou 0 se ainda não foi escolhida. */
export function lugarNaOrdem(ordem, indice) {
  const i = Array.isArray(ordem) ? ordem.indexOf(indice) : -1;
  return i < 0 ? 0 : i + 1;
}

/**
 * A resposta do motor para uma fila COMPLETA de cliques: `lugares[i]` é onde
 * a i-ésima carta da lista do motor vai parar. `null` enquanto a fila não for
 * uma permutação de 0..total-1 — confirmar pela metade seria mandar uma ordem
 * que o motor recusa.
 */
export function respostaDaOrdem(ordem, total) {
  if (!Number.isInteger(total) || total < 1) return null;
  if (!Array.isArray(ordem) || ordem.length !== total) return null;
  const lugares = new Array(total).fill(-1);
  for (let lugar = 0; lugar < total; lugar++) {
    const indice = ordem[lugar];
    if (!Number.isInteger(indice) || indice < 0 || indice >= total || lugares[indice] !== -1) return null;
    lugares[indice] = lugar;
  }
  return lugares;
}

/** "Manter como está": a fila na ordem em que o motor listou. */
export const ordemDoMotor = (total) => Array.from({ length: Math.max(0, total | 0) }, (_, i) => i);

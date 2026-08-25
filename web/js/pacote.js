/**
 * **A CONTA das chances de um pacote de booster.**
 *
 * Mora fora do `boosters.js` por um motivo só: aqui não há `localStorage` nem
 * `projectstore`, então o Node consegue importar e o `pacote.test.mjs` existe.
 * Uma conta que a tela promete ao jogador e ninguém testa é uma promessa que
 * ninguém cobra.
 *
 * **A regra é a do SERVIDOR, não a do front.** Quem sorteia o pacote é
 * `abrir_pacote()` (migration 0004/0023), e ele NÃO renormaliza os pesos entre
 * as raridades que o booster tem: ele rola os 662/237/80/21 fixos e, quando a
 * raridade sorteada está vazia, DESCE pela cascata até achar uma com carta. Um
 * booster sem UR não dá 0% de UR e "sobe" o resto proporcionalmente — os 2,1%
 * da UR viram SR, que é outra distribuição.
 *
 * Isso é diferente do drop do NPC (`drops.js`), que renormaliza de verdade — lá
 * o servidor faz o mesmo. Copiar a fórmula de um no outro seria mostrar na tela
 * uma chance que o sorteio não cumpre; é por isso que cada um tem a sua.
 */

/** Da mais alta para a mais baixa — a ordem importa (define a "maior"). */
export const RARIDADES = ['UR', 'SR', 'R', 'N'];

/**
 * Peso de cada raridade no sorteio, em MILÉSIMOS (somam 1000). O mesmo número
 * está no `abrir_pacote()` do banco, que é quem manda.
 *
 * A conta que importa é por PACOTE, não por carta: são 5 cartas, e o que o
 * jogador sente é "quantos pacotes até sair uma UR". Com peso p por carta, a
 * chance de pelo menos uma no pacote é 1-(1-p)^5.
 *
 * **O ALVO É POR PACOTE; o peso é por CARTA.** Os dois não são a mesma coisa e
 * a diferença é de 5x — confundi-los é o erro mais fácil de cometer aqui. Para
 * uma chance-alvo `a` por pacote, o peso sai da conta inversa:
 *
 *     1-(1-p)^5 = a   →   p = 1 - (1-a)^(1/5)
 *
 * UR a 10% por pacote → p = 1 - 0,90^0,2 = 2,085% → peso **21**.
 *
 *            por carta     por pacote      1 a cada
 *   UR   4 →  21   0,4% → 2,1%    1,98% → 10,07%   50,4 → 9,9 pacotes
 *   SR  38 →  80   3,8% → 8,0%   17,61% → 34,09%    5,7 → 2,9 pacotes
 *   R  252 → 237
 *   N  706 → 662
 *
 * O que saiu de N e R manteve a proporção entre os dois, então o pacote não
 * fica mais pobre embaixo — fica mais rico em cima.
 *
 * **A SR FICA EM 80.** Ela já foi 100 e caiu para 38 porque o jogador FECHAVA a
 * lista de SR de um booster antes de tirar a primeira UR — o problema era a
 * RAZÃO entre as duas, não o número da SR. Com a UR a 21 saem ~3,4 SR por UR,
 * contra as ~8,8 de antes: a SR não corre mais na frente.
 *
 * **O PISO É DE 30 PACOTES** e dispara em ~4% dos casos: ele é a rede de quem
 * tem azar de verdade, não o caminho normal. O número certo depende da taxa —
 * com a UR a 22,6%/pacote (uma versão que chegou a existir) um piso de 20 caía
 * para 0,59% e virava decoração. Ao mexer numa das duas, olhe a outra:
 * `node web/js/economia.test.mjs` imprime essa porcentagem a cada rodada.
 */
export const PACK_ODDS = { N: 662, R: 237, SR: 80, UR: 21 };

/**
 * Para onde a raridade sorteada CAI quando o booster não tem carta nenhuma
 * nela. É a cascata do `abrir_pacote()`, copiada da ordem exata do SQL — e não
 * é simétrica: a UR desce, a N sobe, e SR/R descem antes de subir.
 */
export const CASCATA = {
  UR: ['UR', 'SR', 'R', 'N'],
  SR: ['SR', 'R', 'N', 'UR'],
  R:  ['R', 'N', 'SR', 'UR'],
  N:  ['N', 'R', 'SR', 'UR'],
};

/**
 * A chance real de cada raridade num pacote deste booster, em %.
 *
 * `cards` é o `{ UR: [...], SR: [...], R: [...], N: [...] }` do booster.
 * Não conta as GARANTIAS (a SR a cada 20 pacotes, a UR a cada 10.000 DP): elas
 * substituem uma carta do pacote e a tela as anuncia à parte, no card da Loja.
 *
 * Booster sem carta nenhuma devolve tudo zero, em vez de dividir por zero.
 */
export function chancesDoPacote(cards) {
  const out = { UR: 0, SR: 0, R: 0, N: 0 };
  const tem = (r) => (cards?.[r]?.length ?? 0) > 0;
  if (!RARIDADES.some(tem)) return out;

  const total = RARIDADES.reduce((s, r) => s + PACK_ODDS[r], 0);
  const bruto = { UR: 0, SR: 0, R: 0, N: 0 };
  for (const sorteada of RARIDADES) {
    const destino = CASCATA[sorteada].find(tem);
    bruto[destino] += PACK_ODDS[sorteada];
  }
  for (const r of RARIDADES) out[r] = Math.round((bruto[r] / total) * 1000) / 10;
  return out;
}

/** Quantas cartas distintas o booster tem, somando as quatro gavetas. */
export function totalDoPacote(cards) {
  return RARIDADES.reduce((n, r) => n + (cards?.[r]?.length ?? 0), 0);
}

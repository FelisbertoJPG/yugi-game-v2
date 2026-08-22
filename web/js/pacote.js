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
 * as raridades que o booster tem: ele rola os 706/252/38/4 fixos e, quando a
 * raridade sorteada está vazia, DESCE pela cascata até achar uma com carta. Um
 * booster sem UR não dá 0% de UR e "sobe" o resto proporcionalmente — os 0,4%
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
 * A SR já foi 100 em 1000. Com 5 cartas por pacote isso dava ~1 SR a cada 2
 * pacotes: o jogador FECHAVA a lista de SR de um booster antes de tirar a
 * primeira UR, e a raridade perdia o sentido. Com 38 e a garantia a cada 20, o
 * mesmo investimento rende ~11. O que saiu de SR foi para R (240→252) e N
 * (700→706): o pacote não fica mais pobre, fica menos inflacionado no topo.
 */
export const PACK_ODDS = { N: 706, R: 252, SR: 38, UR: 4 };

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

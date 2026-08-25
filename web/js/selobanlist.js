/**
 * **O selo da banlist numa miniatura de carta** — uma regra, três telas.
 *
 * A banlist em vigor diz de quantas cópias de cada carta um deck pode ter
 * (`cardLimits`), quanto ela custa em pontos (`cardPoints`) e de que lista
 * compartilhada ela participa (`cardGroups`). O Deck Builder já desenhava isso
 * na miniatura; a **Loja não**, e era justamente onde a informação decide uma
 * compra: *"assim o jogador sabe que daquela carta ele só precisa de X cópias"*.
 * Sem o selo, ele abre dez pacotes atrás de uma terceira cópia que o deck nunca
 * vai poder usar.
 *
 * **Por que um módulo, e não uma cópia em cada tela.** Este projeto já pagou
 * por duas cópias da mesma regra que se desencontraram em silêncio
 * (`chancesDe` × `chancesDoPacote`, e as quatro ordenações de pool que viraram
 * o `poolordem.js`). Um selo escrito duas vezes erra do mesmo jeito: a Loja
 * diria "L2" numa carta que o Deck Builder já trata como Limitada, e as duas
 * telas estariam certas pela sua própria conta.
 *
 * **Quem decide SE a banlist se aplica é quem chama.** No Deck Builder ela só
 * vale com a Lista 1 marcada (fora dela a banlist nem se aplica); na Loja vale
 * sempre, porque a lista publicada é a que o servidor usa ao salvar o deck.
 * Passar `null` como banlist devolve string vazia — é o "não sei" honesto, e
 * mantém a tela igual a antes.
 */

/** A carta tem alguma regra? `null` quando não há nada a desenhar. */
function regrasDe(banlist, id) {
  if (!banlist) return null;
  const chave = String(id);
  const pts = banlist.cardPoints?.[chave];
  const grp = banlist.cardGroups?.[chave];
  // O teto ZERO é a carta BANIDA, e um `!lim` o descartaria junto com o
  // "sem regra" — a carta proibida seria a única sem selo na tela. Por isso a
  // presença da CHAVE é o que decide, não o valor dela.
  const bruto = banlist.cardLimits?.[chave];
  const temLim = bruto !== undefined && bruto !== null && bruto !== '';
  const lim = temLim ? Math.floor(Number(bruto)) : null;
  if (!pts && !temLim && !grp) return null;
  return { pts, lim: Number.isFinite(lim) ? lim : null, grp };
}

/**
 * O rótulo humano de um teto individual. `1` e `2` têm nome no jogo de verdade
 * (Limitada / Semilimitada) e é por ele que o jogador reconhece a regra; um
 * teto de 3 para cima é uma regra própria desta banlist e sai como número.
 */
export function rotuloDoLimite(lim) {
  if (lim === 0) return 'BANIDA';
  return lim === 1 ? 'Limitada' : lim === 2 ? 'Semilimitada' : lim ? `máx ${lim}` : '';
}

/**
 * A linha de banlist para o `title` de uma miniatura — string vazia quando a
 * carta não tem regra nenhuma. Começa com `\n` porque sempre entra ATRÁS do
 * nome da carta.
 */
export function textoDaBanlist(banlist, id) {
  const r = regrasDe(banlist, id);
  if (!r) return '';
  const limLabel = rotuloDoLimite(r.lim);
  return '\nbanlist:'
    + (r.pts ? ` ${r.pts} pontos` : '')
    + (limLabel ? ` · ${limLabel}` : '')
    + (r.grp ? ` · grupo ${r.grp}` : '');
}

/**
 * Os selos visuais, na mesma linguagem de `web/banlist.html`: **[L1]/[L2]** em
 * vermelho para o teto individual, o número do grupo em **amarelo** para a
 * lista compartilhada, e os pontos em **azul**.
 *
 * As miniaturas de cada tela já têm os seus cantos ocupados (CST à esquerda,
 * raridade à direita, o `NEW!!` da revelação), então `hasTopLeft`/`hasTopRight`
 * empurram o selo para uma segunda linha em vez de arriscar sobrepor — o `top`
 * sai inline por isso, e o CSS (`web/css/ui.css`) cuida só da cor e do lado.
 */
export function selosDaBanlist(banlist, id, { hasTopLeft = false, hasTopRight = false } = {}) {
  const r = regrasDe(banlist, id);
  if (!r) return '';

  let html = '';
  // Canto esquerdo: o limite primeiro, o grupo embaixo — empilhados quando os
  // dois existem.
  let leftRow = hasTopLeft ? 1 : 0;
  if (r.lim !== null) {
    // A BANIDA não é "L0": ela é outra coisa, e o selo diz isso com todas as
    // letras. Um `L0` no meio de `L1`/`L2` parece o degrau seguinte da mesma
    // escala, quando na verdade é a única que proíbe a carta inteira.
    const txt = r.lim === 0 ? 'BAN' : `L${r.lim}`;
    const cls = r.lim === 0 ? 'bl-badge bl-limit bl-ban' : 'bl-badge bl-limit';
    html += `<span class="${cls}" style="top:${2 + leftRow * 11}px">${txt}</span>`;
    leftRow++;
  }
  if (r.grp) {
    html += `<span class="bl-badge bl-group" style="top:${2 + leftRow * 11}px">${r.grp}</span>`;
  }
  if (r.pts) {
    const rightRow = hasTopRight ? 1 : 0;
    html += `<span class="bl-badge bl-points" style="top:${2 + rightRow * 11}px">${r.pts}p</span>`;
  }
  return html;
}

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
 * O selo fica **colado no canto**. Ele nasceu com 2px de folga, para acompanhar
 * os vizinhos da miniatura do Deck Builder, e do lado de quem olha aquilo virou
 * um respiro estranho entre a borda da carta e a etiqueta — foi o relato.
 * Colado é também o que a contagem de cópias (`.thumb .count`) sempre fez.
 *
 * **Quando o canto do limite já está ocupado, ele TROCA DE LADO** em vez de
 * descer. O caso real é a carta revelada da Loja: o `NEW!!` mora exatamente no
 * canto superior esquerdo, e empilhar o [L1] debaixo dele deixava a etiqueta do
 * limite espremida justamente na carta que o jogador acabou de ganhar. Trocar
 * de lado sai de graça porque o `NEW!!` só existe ali — na miniatura do Deck
 * Builder, onde a banlist é lida o tempo todo, o [L1] fica sempre à esquerda.
 *
 * `hasTopLeft`/`hasTopRight` dizem quais cantos a tela já usa, e `desvio` diz
 * quanto descer quando não há para onde trocar. O `desvio` é da TELA porque a
 * altura do vizinho é dela: na miniatura o selo de cima vai de 2px a 14px; na
 * carta revelada o `NEW!!` vai de 3px a 16px. Um número só serviria para uma
 * das duas, e o erro é mudo — as etiquetas se sobrepõem e a de baixo some.
 *
 * O `top` sai inline por isso; o CSS (`web/css/ui.css`) cuida da cor e de que
 * lado cada classe encosta (`bl-dir` joga o selo do limite para a direita).
 */
export function selosDaBanlist(banlist, id, {
  hasTopLeft = false, hasTopRight = false, desvio = 14,
} = {}) {
  const r = regrasDe(banlist, id);
  if (!r) return '';

  // O passo entre dois selos DESTA função é a altura de um deles: 8px de fonte,
  // 1px de recheio em cima e embaixo, e 1px de respiro.
  const PASSO = 11;

  // Cada lado é uma COLUNA com o seu próprio cursor vertical. O cursor começa
  // em 0 quando o canto está livre (colado na borda) e em `desvio` quando a
  // tela já pôs alguma coisa ali — e daí em diante anda de PASSO em PASSO.
  //
  // Um cursor, e não uma conta por índice: a primeira versão multiplicava a
  // linha pelo desvio e o SEGUNDO selo de um canto livre saía a 14px em vez de
  // 11 — três pixels de buraco no meio de duas etiquetas coladas.
  const coluna = (ocupado) => {
    let y = ocupado ? desvio : 0;
    return () => { const atual = y; y += PASSO; return atual; };
  };
  const proxEsq = coluna(hasTopLeft);
  const proxDir = coluna(hasTopRight);

  // O limite (e o grupo junto dele) vai para a esquerda; com a esquerda tomada
  // e a direita livre, TROCA DE LADO em vez de descer. Juntos porque separá-los
  // deixaria "2 cópias somando as duas cartas" longe do "L1" da mesma carta.
  const trocaDeLado = hasTopLeft && !hasTopRight;
  const classeLado = trocaDeLado ? ' bl-dir' : '';
  const proxLimite = trocaDeLado ? proxDir : proxEsq;

  let html = '';
  if (r.lim !== null) {
    // A BANIDA não é "L0": ela é outra coisa, e o selo diz isso com todas as
    // letras. Um `L0` no meio de `L1`/`L2` parece o degrau seguinte da mesma
    // escala, quando na verdade é a única que proíbe a carta inteira.
    const txt = r.lim === 0 ? 'BAN' : `L${r.lim}`;
    const ban = r.lim === 0 ? ' bl-ban' : '';
    html += `<span class="bl-badge bl-limit${ban}${classeLado}" `
          + `style="top:${proxLimite()}px">${txt}</span>`;
  }
  if (r.grp) {
    html += `<span class="bl-badge bl-group${classeLado}" `
          + `style="top:${proxLimite()}px">${r.grp}</span>`;
  }
  if (r.pts) {
    // Os pontos são sempre da direita — é o canto que sobra, e trocá-los de
    // lado os poria em cima do limite quando os dois existem.
    html += `<span class="bl-badge bl-points" style="top:${proxDir()}px">${r.pts}p</span>`;
  }
  return html;
}

/**
 * **A lista de cartas de um conteúdo, por RARIDADE e com o que você já tem.**
 *
 * É a caixa que a Trilha de Duelos abre em "visualizar lista de drops", agora
 * usada também pela Loja, no "ver as cartas" de cada booster e de cada Deck
 * Estrutural. A pergunta do jogador é a mesma nos três: *o que vem aqui dentro,
 * e o que disso ainda me falta?*
 *
 * Mora num módulo só porque a resposta tem de ser IGUAL nos três. Duas cópias
 * de uma tela divergem sem ninguém perceber — uma ganha o selo de "você tem" e
 * a outra fica para trás, e o jogador conclui que o conteúdo é diferente. O CSS
 * segue junto, em `web/css/gavetas.css`, pela mesma razão.
 *
 * O que este módulo NÃO faz: sortear, e calcular chance. A chance de cada
 * raridade chega pronta de quem sabe a regra daquele conteúdo — `chancesDe`
 * (drops.js) para o NPC, `chancesDoPacote` (pacote.js) para o booster —, porque
 * as duas contas são diferentes e cada uma tem de bater com o sorteio que o
 * SERVIDOR faz. Um Deck Estrutural não passa chance nenhuma: ele vem inteiro.
 */

import { ownsCard, ownedCount } from '/web/js/wallet.js';

/** As mesmas quatro de sempre, da mais alta para a mais baixa. */
export const RARIDADES = ['UR', 'SR', 'R', 'N'];

/** `{ UR: [], SR: [], R: [], N: [] }` — o formato que o renderizador espera. */
export const gavetasVazias = () => ({ UR: [], SR: [], R: [], N: [] });

/**
 * Desenha as gavetas dentro de `alvo` e devolve o resumo da coleção
 * (`{ tem, total }`), que é o que a linha de cima da caixa costuma dizer.
 *
 * `pool` é `{ UR: [ids], SR: [...], R: [...], N: [...] }`.
 *
 * Opções:
 *   • `nomeDe(id)` / `arte(id)` — quem resolve nome e imagem. Ficam de fora
 *     porque cada tela já tem o seu (a Loja carrega arte de carta customizada,
 *     a Trilha não);
 *   • `chances` — `{ UR: %, … }`, ou `null` quando não há sorteio;
 *   • `copias(id)` — quantas cópias o conteúdo traz. Um Deck Estrutural leva 3
 *     da mesma carta, e "3 cartas" contadas como uma esconderia metade do que
 *     se está comprando.
 *
 * "Você tem" é lido da COLEÇÃO inteira, não do que veio DESTE conteúdo: uma
 * carta que você tem pode ter vindo de um booster ou de um drop, e ainda assim
 * marcá-la é o que o jogador quer saber ("falta esta").
 */
export function renderGavetas(alvo, pool, {
  nomeDe = (id) => String(id),
  arte = (id) => `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`,
  chances = null,
  copias = null,
} = {}) {
  alvo.replaceChildren();
  let tem = 0, total = 0;

  for (const r of RARIDADES) {
    const ids = pool?.[r] ?? [];
    if (!ids.length) continue;

    const g = document.createElement('div');
    g.className = `gaveta ${r}`;
    const pct = chances ? `${chances[r]}% de chance · ` : '';
    g.innerHTML = `<h3>${r} <span class="pct">${pct}${ids.length} carta(s)</span></h3>`;

    const cartas = document.createElement('div');
    cartas.className = 'cartas';
    for (const id of ids) {
      total++;
      const possuo = ownsCard(id);
      if (possuo) tem++;
      const n = copias ? copias(id) : 1;

      const c = document.createElement('div');
      c.className = `carta${possuo ? ' tenho' : ''}`;
      c.title = nomeDe(id)
        + (n > 1 ? ` — ${n} cópias neste conteúdo` : '')
        + (possuo ? ` — você tem ${ownedCount(id)}` : ' — você ainda não tem');
      c.innerHTML = `<img src="${arte(id)}" alt="" loading="lazy">`
        + (n > 1 ? `<span class="qtd">×${n}</span>` : '')
        + (possuo ? '<span class="marca">✔</span>' : '')
        + `<div class="nm">${escapar(nomeDe(id))}</div>`;
      cartas.append(c);
    }
    g.append(cartas);
    alvo.append(g);
  }

  if (!total) {
    const vazio = document.createElement('div');
    vazio.className = 'nada';
    vazio.textContent = 'Este conteúdo ainda não tem carta nenhuma configurada.';
    alvo.append(vazio);
  }
  return { tem, total };
}

/** "12 de 20 já estão na sua Coleção" — a frase que acompanha as gavetas. */
export function fraseDaColecao({ tem, total }) {
  if (!total) return '';
  if (tem === total) return `você já tem <b>todas</b> as ${total} cartas desta lista.`;
  return `<b>${tem}</b> de ${total} já estão na sua Coleção — faltam <b>${total - tem}</b>.`;
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

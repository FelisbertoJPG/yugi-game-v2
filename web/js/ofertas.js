/**
 * **Qual EFEITO da carta o motor está oferecendo.**
 *
 * O `ocgcore` não oferece cartas, oferece efeitos: uma carta com dois efeitos
 * ativáveis aparece DUAS vezes na mesma pergunta, com o mesmo código e a mesma
 * arte. O que separa as duas é a `description` que vem junto (o
 * `aux.Stringid(code, i)` do script, resolvido no servidor contra a tabela
 * `texts` do `cards.cdb` — ver `DatabaseManager.TextoDoEfeito`).
 *
 * O relato que originou este módulo: a Forgotten Temple of the Deep tem dois
 * efeitos ("banir 1 peixe" e "Invocar Especialmente o banido"), o jogador quer
 * o segundo, clica na única linha que a tela mostrava e resolve o primeiro.
 *
 * Mora fora do `duel.html` porque é REGRA, não desenho: o teste
 * (`node web/js/ofertas.test.mjs`) a usa de verdade, em vez de reimplementá-la.
 */

/** Localização "mão" no protocolo do motor (LOCATION_HAND). */
export const LOCATION_MAO = 0x02;

/**
 * O que o efeito oferecido vai fazer, na frase do próprio motor.
 *
 * Vazio quando o motor não mandou descrição (efeito sem texto próprio, ou um
 * texto de sistema que não mora no banco de cartas) — aí a tela não diz nada,
 * em vez de dizer algo inventado.
 */
export function textoDoEfeito(o) {
  const t = o && o.descText;
  return typeof t === 'string' && t.trim() ? t.trim() : '';
}

/**
 * As ofertas de ativação de cada posição da MÃO, uma LISTA por posição.
 *
 * Guardar um índice por posição (o que o `mapList` fazia) perdia o segundo
 * efeito: ele simplesmente não tinha como ser ativado da mão, em silêncio, com
 * o menu prometendo um "Ativar" que sempre resolvia o mesmo. É o mesmo problema
 * que o campo já resolvia guardando uma lista por zona.
 *
 * Filtra a mão de propósito: `activatable` traz o CAMPO junto, e uma carta em
 * campo com o mesmo código de uma da mão roubava a posição dela — o clique na
 * mão mandava o índice da outra.
 *
 * @param {number[]} mao    códigos na mão, na ordem em que a tela desenha
 * @param {Array}    lista  `question.activatable` do motor
 * @returns {Array<Array>}  uma lista de ofertas por posição da mão
 */
export function ofertasPorMao(mao, lista) {
  const out = Array.from({ length: mao.length }, () => []);
  const porCodigo = new Map();
  for (const a of lista || []) {
    if (a.location !== LOCATION_MAO) continue;
    if (!porCodigo.has(a.code)) porCodigo.set(a.code, []);
    porCodigo.get(a.code).push(a);
  }
  for (const [code, acts] of porCodigo) {
    const posicoes = [];
    for (let h = 0; h < mao.length; h++) if (mao[h] === code) posicoes.push(h);
    if (!posicoes.length) continue;
    // Divisível: cada cópia fica com a sua fatia, na ordem — 1 cópia com 2
    // efeitos recebe as duas ofertas; 2 cópias com 1 efeito cada recebem uma
    // cada. Quando não divide, toda cópia recebe a lista inteira: são ofertas
    // da MESMA carta, então qualquer índice ativa um efeito legítimo dela — o
    // que é melhor do que esconder um.
    const porCopia = acts.length % posicoes.length === 0 ? acts.length / posicoes.length : 0;
    posicoes.forEach((h, i) => {
      out[h] = porCopia ? acts.slice(i * porCopia, (i + 1) * porCopia) : acts.slice();
    });
  }
  return out;
}

/**
 * O rótulo de cada linha de "Ativar" no menu da carta.
 *
 * Uma oferta só: "Ativar", como sempre foi. Duas ou mais: o texto do motor
 * quando ele veio, e a ORDEM em que ele ofereceu quando não veio — numerar não
 * diz o que cada um faz, mas é honesto e separa as linhas, que é o mínimo para
 * a escolha deixar de ser no escuro.
 *
 * @returns {{index:number, texto:string|null, sub:string}[]} `texto` null =
 *          use o rótulo padrão da ação.
 */
export function linhasDeAtivacao(ofertas) {
  const n = (ofertas || []).length;
  return (ofertas || []).map((a, i) => {
    const sub = textoDoEfeito(a);
    return { index: a.index, texto: n > 1 && !sub ? `Ativar (efeito ${i + 1})` : null, sub };
  });
}

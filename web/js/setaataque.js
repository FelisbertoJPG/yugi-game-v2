/**
 * **A geometria da seta de ataque** — quem ataca quem, desenhado na mesa.
 *
 * O relato que originou isto: a janela de resposta abria junto com a jogada do
 * oponente, e dava para ler no log que houve um ataque mas não QUAL monstro
 * atacava QUAL — que é justamente o que decide se vale gastar a armadilha.
 *
 * Mora fora do `duel.html` porque erra CALADO: uma divisão por zero (atacante e
 * alvo no mesmo ponto, que acontece de verdade quando as duas zonas ainda não
 * foram posicionadas) põe `NaN` no atributo `d` do caminho, e o navegador
 * simplesmente não desenha nada — sem erro no console, sem sintoma além de "a
 * seta não apareceu às vezes".
 *
 * Tudo em pixels de tela (`getBoundingClientRect`), origem no canto superior
 * esquerdo. Sem DOM aqui: `node web/js/setaataque.test.mjs`.
 */

/** Quanto a curva foge da reta, como fração da distância. */
const CURVA = 0.14;
/** Comprimento da cabeça da seta, em pixels. */
const PONTA = 13;
/** Meia-largura da cabeça, em pixels. */
const ABA = 7;
/** Recuo mínimo quando não há alvo com tamanho (ataque direto). */
const RECUO_MIN = 26;

/**
 * @param {{x:number,y:number}} from  centro do atacante
 * @param {{x:number,y:number}} to    centro do alvo
 * @param {number} raio               o quanto a ponta recua antes do alvo
 *                                    (metade da carta; 0 no ataque direto)
 * @returns {{d:string, abas:string}|null}
 *          `null` quando não dá para desenhar — os dois pontos no mesmo lugar,
 *          uma coordenada ausente ou não-finita. Nunca um caminho com `NaN`.
 */
export function geometriaDaSeta(from, to, raio = 0) {
  if (!ehPonto(from) || !ehPonto(to)) return null;
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  // Distância zero não tem direção: qualquer seta aqui seria inventada.
  if (!(dist > 1)) return null;

  const ux = dx / dist, uy = dy / dist;
  // A ponta para ANTES do alvo: uma seta que termina no centro da carta fica
  // escondida debaixo da arte. Limitada a 45% do trajeto para que zonas
  // vizinhas ainda rendam uma seta com corpo visível.
  const recuo = Math.min(raio > 0 ? raio : RECUO_MIN, dist * 0.45);
  const pX = to.x - ux * recuo, pY = to.y - uy * recuo;
  // O corpo termina onde a cabeça começa — e nunca atrás do atacante.
  const corpo = Math.min(PONTA, Math.max(0, dist - recuo));
  const fimX = pX - ux * corpo, fimY = pY - uy * corpo;

  const cX = (from.x + fimX) / 2 - uy * dist * CURVA;
  const cY = (from.y + fimY) / 2 + ux * dist * CURVA;
  const nx = -uy, ny = ux;   // normal da direção: as abas da cabeça

  return {
    d: `M ${n(from.x)} ${n(from.y)} Q ${n(cX)} ${n(cY)} ${n(fimX)} ${n(fimY)}`,
    abas: [
      `${n(pX)} ${n(pY)}`,
      `${n(fimX + nx * ABA)} ${n(fimY + ny * ABA)}`,
      `${n(fimX - nx * ABA)} ${n(fimY - ny * ABA)}`,
    ].join(' '),
  };
}

/**
 * O HALO do alvo: a mancha suave em volta da carta que está sendo atacada.
 *
 * É um retângulo — o formato da carta —, e não um círculo: um anel em volta de
 * uma carta em pé sobra nos cantos e corta as bordas de cima e de baixo. Quem
 * borra a linha é o CSS (`filter: blur`), então aqui só sai a moldura, com uma
 * folga para a mancha nascer FORA da arte em vez de por cima dela.
 *
 * @param {{left,top,width,height}} r  o retângulo da carta na tela
 * @param {number} folga               quantos pixels para fora
 * @returns {{x,y,width,height,rx}|null}
 */
export function haloDoAlvo(r, folga = 8) {
  if (!r || !Number.isFinite(r.left) || !Number.isFinite(r.top)) return null;
  if (!(r.width > 0) || !(r.height > 0)) return null;
  return {
    x: n(r.left - folga), y: n(r.top - folga),
    width: n(r.width + folga * 2), height: n(r.height + folga * 2),
    rx: 4,
  };
}

/** O centro de um retângulo de tela, ou null. */
export function centroDe(r) {
  return r && Number.isFinite(r.left) && Number.isFinite(r.top)
    ? { x: r.left + (r.width || 0) / 2, y: r.top + (r.height || 0) / 2 }
    : null;
}

const ehPonto = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
/** Uma casa decimal basta em pixel de tela, e encurta o atributo pela metade. */
const n = (v) => Math.round(v * 10) / 10;

/**
 * Mostrar/esconder a camada da seta — sempre pelo ATRIBUTO.
 *
 * **`svg.hidden = false` não funciona.** A propriedade `hidden` é do
 * `HTMLElement`; um `<svg>` é `SVGElement`, que não a implementa — atribuir ali
 * só cria um campo solto no objeto, o atributo continua no elemento e o
 * `display:none` junto. Não dá erro nenhum, não aparece no console: a seta
 * simplesmente nunca aparece. Foi assim que ela foi publicada da primeira vez.
 */
export const mostrarCamada = (el) => { if (el) el.removeAttribute('hidden'); };
export const esconderCamada = (el) => { if (el) el.setAttribute('hidden', ''); };

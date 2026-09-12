/**
 * **PARA ONDE A CARTA FOI** — o lugar, na tela, de cada localização do motor.
 *
 * O relato: *"a carta escolhida simplesmente desaparece da zona, sem animação
 * nenhuma, e parece que foi para a mão do oponente"*. Era exatamente isso, e a
 * causa é de uma linha: o mapa de localização → âncora não conhecia a MÃO nem o
 * EXTRA, e `flyGhost` desiste em silêncio quando não tem destino
 * (`if (!from || !to) return`). Então a carta devolvida à mão saía da zona num
 * único quadro de vídeo e reaparecia como um número maior na contagem da mão do
 * outro lado — que é, do lado de quem olha, uma carta teleportada.
 *
 * O estado sempre esteve certo (o `handle` do `move` trata a mão desde sempre);
 * quem faltava era o desenho. É a mesma família do "card alvejado vai pra mão do
 * oponente" que a investida do ataque já custou: ninguém lê um movimento que não
 * acontece — inventa-se um.
 *
 * A regra mora aqui, e não dentro do `duel.html`, porque ela erra CALADA: uma
 * localização nova (ou renomeada) devolve `null`, o fantasma não sai, e a carta
 * volta a sumir num buraco sem que nada acuse. O teste
 * (`node web/js/movimento.test.mjs`) cobra um lugar para TODA localização que o
 * motor sabe mandar.
 */
import { LOCAL } from './alvos.js';

/**
 * A zona de campo. Não está no `LOCAL` de `alvos.js` de propósito: para a
 * ESCOLHA ela chega como `SZONE` com sequência 5 (é assim que o motor a lista),
 * e este `0x100` é o `LOCATION_FZONE` que aparece em evento de movimento.
 * Os dois caminhos existem no motor, e o `duel.html` já tratava os dois.
 */
export const FZONE = 0x100;

/**
 * TODA localização que o motor pode mandar num evento de movimento. É a lista
 * que o teste varre — o buraco desta feature foi justamente uma localização
 * legítima que ninguém tinha mapeado.
 */
export const LOCALIZACOES = [
  LOCAL.DECK, LOCAL.MAO, LOCAL.MZONE, LOCAL.SZONE,
  LOCAL.CEMITERIO, LOCAL.BANIDA, LOCAL.EXTRA, FZONE,
];

/**
 * Onde esta carta está, na tela.
 *
 * Devolve uma de duas formas — e são duas porque a mão não é uma zona:
 *
 *   `{ tipo: 'ancora', ancora }`  a zona/pilha com aquele `data-anchor`;
 *   `{ tipo: 'mao', caixa }`      a FILEIRA da mão (`#hand-you` / `#hand-opp`),
 *                                 que não tem lugar fixo por carta — quem chega
 *                                 aterrissa no meio dela, que é para onde a
 *                                 compra já voa.
 *
 * `null` só para localização que não existe. Quem receber `null` tem de fazer a
 * carta SUMIR NO LUGAR (encolhendo), nunca deixá-la desaparecer entre dois
 * quadros: o buraco é que é ilegível, não a falta de destino.
 */
export function lugarDaCarta(controller, loc, seq = 0) {
  const c = Number(controller) === 0 ? 0 : 1;
  const ancora = (a) => ({ tipo: 'ancora', ancora: a });

  switch (Number(loc)) {
    case LOCAL.MZONE:     return ancora(`${c}:4:${seq}`);
    // Sequência 5 da zona de magia É a zona de campo — o mesmo par que
    // `fieldRows` desenha (`sk(8, 5)`).
    case LOCAL.SZONE:     return ancora(`${c}:8:${seq}`);
    case FZONE:           return ancora(`${c}:8:5`);
    case LOCAL.CEMITERIO: return ancora(`${c}:gy`);
    case LOCAL.BANIDA:    return ancora(`${c}:banido`);
    case LOCAL.DECK:      return ancora(`${c}:deck`);
    case LOCAL.EXTRA:     return ancora(`${c}:extra`);
    case LOCAL.MAO:       return { tipo: 'mao', caixa: c === 0 ? 'hand-you' : 'hand-opp' };
    default:              return null;
  }
}

/**
 * A âncora de uma localização, ou `null` quando ela não é uma zona (a mão).
 * É o formato antigo — serve a quem só sabe apontar para uma zona (o brilho de
 * entrada em campo, o destaque de stats), e nunca a um movimento, que precisa
 * saber para onde a carta vai mesmo quando o destino é a mão.
 */
export function ancoraDaCarta(controller, loc, seq = 0) {
  const l = lugarDaCarta(controller, loc, seq);
  return l && l.tipo === 'ancora' ? l.ancora : null;
}

/**
 * **O ataque tem CINCO momentos, e a tela mostrava um.**
 *
 * No Yu-Gi-Oh a batalha não é um instante: declara-se o ataque escolhendo quem
 * ataca e em quem; um alvo com a face para baixo **abre**; uma janela de
 * resposta permite impedir o golpe; os corpos colidem; e só então o dano é
 * calculado. Cada fronteira dessas é uma decisão de alguém, e juntá-las tira do
 * jogador justamente as chances de agir.
 *
 * O motor sempre mandou tudo — `MSG_ATTACK (110)`, `MSG_ATTACK_DISABLED (112)`,
 * `MSG_DAMAGE_STEP_START (113)`, `MSG_BATTLE (111)`, `MSG_DAMAGE_STEP_END
 * (114)`. As três do meio não tinham tradução no `InteractiveDuel`, e o laço de
 * mensagens anda pelo tamanho declarado de cada uma: elas eram puladas em
 * silêncio, sem erro e sem log.
 *
 * A sequência abaixo não é suposta — é a medida por `--test-etapa-dano`:
 *
 * ```
 * contra monstro virado: attack → damagestep:inicio → pos (o alvo abre)
 *                                → battle (1700 x 1400) → damagestep:fim
 * ataque direto:         attack → damagestep:inicio → battle (1700 x 0)
 *                                → lp (dano) → damagestep:fim
 * ataque anulado:        attack → [janela de resposta] → attackcancel
 * ```
 *
 * Este módulo é só a DECISÃO — sem DOM, para ser provado em Node
 * (`batalha.test.mjs`). Quem desenha é o `web/duel.html`.
 */

/**
 * Os momentos do ataque, na ordem. O valor é o que aparece na tela; `null` é
 * "não há ataque em curso", que não é um momento e por isso não tem nome.
 */
export const ETAPAS = {
  declaracao: 'Declaração de Ataque',
  dano: 'Etapa de Dano',
  calculo: 'Cálculo de Dano',
  anulado: 'Ataque Anulado',
};

/**
 * **Em que momento do ataque o duelo está?** Recebe o momento de agora e um
 * evento do motor; devolve o momento seguinte (`null` = nenhum ataque em
 * curso).
 *
 * A regra erra CALADA nos dois sentidos, e cada um estraga uma coisa diferente:
 * ficar preso num momento que já passou faz a próxima janela de corrente
 * prometer "responda ao ataque" quando não há ataque nenhum; e sair cedo demais
 * apaga a seta no meio da etapa de dano, deixando o golpe sem origem na tela.
 *
 * O `turn` é a rede de segurança: um ataque que não chegou ao fim (o duelo
 * acabou no meio, o motor mudou de ideia) não pode atravessar a virada do
 * turno. Momento velho é pior que momento nenhum.
 */
export function proximaEtapa(etapa, ev) {
  const t = ev && ev.type;
  if (t === 'attack') return 'declaracao';
  if (t === 'attackcancel') return 'anulado';
  if (t === 'battle') return 'calculo';
  if (t === 'damagestep') return ev.etapa === 'inicio' ? 'dano' : null;
  if (t === 'turn') return null;
  return etapa ?? null;
}

/** Há um ataque em curso? (o `anulado` já é o fim dele, mas ainda é notícia) */
export function emBatalha(etapa) {
  return etapa === 'declaracao' || etapa === 'dano' || etapa === 'calculo';
}

/**
 * **Quem ataca quem**, por extenso. Os nomes chegam prontos porque este módulo
 * não conhece o banco de cartas — e o alvo pode não ter nome nenhum: um monstro
 * com a face para baixo é `code: 0` (`Projetar`, no servidor) até a etapa de
 * dano abri-lo.
 */
export function textoDoAtaque({ atacante, alvo, direto } = {}) {
  const quem = atacante || 'um monstro';
  if (direto) return `${quem} ataca diretamente`;
  return `${quem} ataca ${alvo || 'uma carta virada'}`;
}

/** Posições do motor em que o monstro está DEITADO (0x4 face-up, 0x8 virado). */
const DEFESA = 0x4 | 0x8;

/**
 * **O cálculo de dano, do jeito que ele é lido na mesa.** Traduz o `MSG_BATTLE`
 * no par de números que colidiram e em quem sobrou.
 *
 * Duas coisas erram em silêncio aqui, e as duas mostram um número plausível:
 *
 * 1. **O ataque direto TAMBÉM manda `battle`** — medido: o lado do defensor vem
 *    ZERADO. Desenhar o quadro do defensor só porque o evento existe põe na
 *    tela um adversário de 0 de ATK apanhando, no único ataque que não tem
 *    alvo.
 * 2. **Um monstro deitado luta pela DEF.** O evento traz ATK e DEF dos dois
 *    lados, sempre; quem escolhe qual dos dois vale é a POSIÇÃO do defensor
 *    naquele instante. Mostrar o ATK dele faz a tela anunciar "1700 contra
 *    1400" numa batalha que o motor resolveu como 1700 contra 1200 — e o
 *    resultado (ninguém leva dano) passa a não fechar com os números à vista.
 *
 * `posDoAlvo` é a posição do defensor DEPOIS de a etapa de dano abri-lo: quem
 * atacou um monstro virado o encontra deitado com a face para cima aqui.
 */
export function calculoDaBatalha(ev, { posDoAlvo = 0, direto = false } = {}) {
  if (!ev) return null;
  const atacante = {
    valor: num(ev.atkAtk),
    destruido: !!ev.atkDestroyed,
  };
  // Sem alvo não há segundo quadro. A checagem é do ATAQUE (`direct`), e não de
  // "os números do defensor vieram zerados": um monstro de 0 de ATK deitado com
  // 0 de DEF existe no jogo e não é um ataque direto.
  if (direto) return { atacante, defensor: null, direto: true };

  const emDefesa = (posDoAlvo & DEFESA) !== 0;
  return {
    atacante,
    defensor: {
      valor: emDefesa ? num(ev.defDef) : num(ev.defAtk),
      emDefesa,
      destruido: !!ev.defDestroyed,
    },
    direto: false,
  };
}

function num(v) {
  return Number.isFinite(v) ? v : 0;
}

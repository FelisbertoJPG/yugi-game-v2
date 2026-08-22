/**
 * Posição de um monstro em campo — o que "mudar posição" faz com ele.
 *
 * O `ocgcore` tem UM comando (`reposition`) e as regras oficiais decidem o
 * resultado; não existe escolha a fazer. Então o menu da carta (`duel.html`)
 * não pergunta: ele diz o que vai acontecer.
 *
 * Sem DOM e sem `fetch` de propósito — é regra, e regra se prova em Node
 * (`node web/js/posicao.test.mjs`). Antes disto o rótulo era um "Mudar
 * posição" genérico e o jogador só descobria o resultado depois de clicar.
 *
 * A máscara é a do motor (`POS_*`, ver DUEL-TRAINING-HANDOFF.md):
 *   0x1 face-up ataque · 0x2 virada em ataque
 *   0x4 face-up defesa · 0x8 virada em defesa
 */

/** Os dois bits de "carta virada". Virada em ataque existe (Invocação-Virar
 *  responde por ela), então não dá para testar só o 0x8. */
export const VIRADA = 0x2 | 0x8;

/** A carta está com a face para baixo? */
export function estaVirada(pos) {
  return (Number(pos) & VIRADA) !== 0;
}

/**
 * O rótulo do menu para esta posição.
 *
 *   virada → vira para cima em ATAQUE (a Invocação-Virar);
 *   defesa face-up → levanta em ATAQUE;
 *   ataque face-up → deita em DEFESA.
 *
 * A ordem dos testes importa: virada em DEFESA (0x8) casaria com "tem bit de
 * defesa" se o 0x4 fosse testado antes, e o menu prometeria "Mudar para
 * Ataque" onde o motor faz uma Invocação-Virar.
 */
export function rotuloReposicao(pos) {
  const p = Number(pos) || 0;
  if (estaVirada(p)) return { texto: 'Virar para Ataque', icone: '🔄' };
  if (p & 0x4) return { texto: 'Mudar para Ataque', icone: '⚔️' };
  return { texto: 'Mudar para Defesa', icone: '🛡️' };
}

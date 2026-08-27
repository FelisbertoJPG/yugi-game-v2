/**
 * **Quando o duelo para pra te perguntar se você quer encadear.**
 *
 * O motor abre uma janela de corrente toda vez que alguma carta sua PODERIA ser
 * ativada — e "poderia" é muito mais frequente do que parece: uma Forgotten
 * Temple of the Deep pergunta a cada mudança de fase, todo turno, enquanto
 * houver monstro em campo. Perguntar sempre é o certo para quem está montando
 * uma corrente, e é sufocante para quem não está.
 *
 * Os três modos são os mesmos dos jogos de Yu-Gi-Oh, com o mesmo sentido —
 * copiar o vocabulário que o jogador já conhece vale mais que inventar o nosso:
 *
 *   off    (Master Duel "OFF", EDOPro "Chain: OFF")
 *          não incomoda com efeito opcional nenhum.
 *   auto   (Master Duel "Auto", o PADRÃO lá e aqui)
 *          pergunta nos momentos que importam: invocação, ativação, declaração
 *          de ataque e antes de o turno do oponente acabar.
 *   on     (Master Duel "ON", EDOPro "Chain: ON")
 *          pergunta em toda janela que o motor abrir.
 *
 * **Nenhum modo ativa carta por você**, e isso é de propósito: em jogo nenhum
 * de Yu-Gi-Oh existe "encadeia sozinho" — encadear na hora errada perde duelo.
 * O que muda entre os modos é só QUANDO o jogo pergunta. (Cuidado com a palavra
 * "auto" vinda do Duel Links: lá o *Auto-Duel* é a CPU jogando por você, coisa
 * completamente diferente.)
 *
 * Este módulo é só a DECISÃO, sem DOM, para poder ser provado em Node
 * (`correntes.test.mjs`) — quem desenha a janela é o `web/duel.html`.
 */

/** Rótulo de cada modo, na ordem em que aparecem na barra. */
export const MODOS = {
  off: 'desligado',
  auto: 'auto',
  on: 'sempre',
};

/** O padrão é o mesmo do Master Duel: `auto`. */
export const MODO_PADRAO = 'auto';

/** Bit da End Phase no motor (ver PHASE_NOME em duel.html). */
export const FASE_END = 0x200;

/**
 * Modo guardado vira modo válido.
 *
 * `manual` é o nome que este seletor teve por um dia, quando eu ainda achava
 * que "auto" queria dizer "ativa sozinho". Ele descrevia o comportamento do
 * `on` (pergunta em toda janela), então é para lá que vai quem já tinha
 * escolhido — em vez de cair no padrão e mudar de comportamento sem aviso.
 */
export function normalizarModo(valor) {
  if (valor === 'manual') return 'on';
  return Object.prototype.hasOwnProperty.call(MODOS, valor) ? valor : MODO_PADRAO;
}

/**
 * **Esta janela é de um momento que importa?** Devolve o motivo (para o log) ou
 * `null` quando é janela de rotina.
 *
 * Os quatro momentos são os que o Master Duel usa no modo Auto. Os TRÊS
 * primeiros o motor entrega de graça: o `chainTrigger*` diz o que abriu a
 * janela (ver `InteractiveDuel.MarcaGatilho`), e a declaração de ataque entrou
 * nele — antes ela era o único momento sem nome, e a janela mais importante do
 * duelo (Mirror Force, Waboku, Negate Attack) chegava rotulada como uma
 * mudança de fase. O quarto é a End Phase do oponente — a hora clássica do
 * Mystical Space Typhoon baixado.
 *
 * `ataqueDeclarado` ficou como reserva para o motor que ainda não manda o
 * gatilho de ataque (um cliente com o `engine` atrasado). Quem o alimenta é o
 * momento do ataque em `batalha.js`, e não uma bandeira própria: a bandeira
 * antiga só era apagada na virada do TURNO, então bastava um ataque para toda
 * janela seguinte daquele turno — inclusive as da Main Phase 2 — se anunciar
 * como resposta a um ataque que já tinha acabado.
 */
export function momentoDaJanela(pergunta, { turno = 0, fase = 0, ataqueDeclarado = false } = {}) {
  const p = pergunta || {};
  if (p.chainTriggerKind === 'activation') return 'uma carta foi ativada';
  if (p.chainTriggerKind === 'summon') return 'uma invocação está em andamento';
  if (p.chainTriggerKind === 'attack') return 'um ataque foi declarado';
  if (ataqueDeclarado) return 'um ataque foi declarado';
  if (turno === 1 && fase === FASE_END) return 'o turno do oponente vai acabar';
  return null;
}

/**
 * Perguntar ao jogador, ou responder por ele?
 *
 * Devolve sempre a mesma forma:
 *   `{ perguntar, resposta, porque }`
 *   • `perguntar: true`  → abra a janela; `resposta` é null.
 *   • `perguntar: false` + `resposta: -1` → passe a corrente sozinho.
 *   • `perguntar: false` + `resposta: null` → não é uma janela para decidir.
 *
 * A janela OBRIGATÓRIA (`chainForced`) ignora o modo e sempre pergunta: ali não
 * existe passar, o motor exige uma escolha, e responder por conta própria
 * escolheria a carta pelo jogador.
 */
export function decidirCorrente({ modo, pergunta, turno = 0, fase = 0, ataqueDeclarado = false } = {}) {
  const p = pergunta;
  if (!p || p.kind !== 'chain' || !Array.isArray(p.choices) || p.choices.length === 0)
    return { perguntar: false, resposta: null, porque: 'não é uma janela de corrente com opções' };

  if (p.chainForced)
    return { perguntar: true, resposta: null, porque: 'janela obrigatória: o motor exige uma escolha' };

  const m = normalizarModo(modo);

  if (m === 'off')
    return { perguntar: false, resposta: -1,
             porque: `modo desligado — ${p.choices.length} carta(s) que você poderia ativar` };

  if (m === 'on')
    return { perguntar: true, resposta: null, porque: 'modo sempre: toda janela pergunta' };

  const momento = momentoDaJanela(p, { turno, fase, ataqueDeclarado });
  return momento
    ? { perguntar: true, resposta: null, porque: `modo auto: ${momento}` }
    : { perguntar: false, resposta: -1,
        porque: 'modo auto: janela de rotina (ninguém invocou, ativou nem atacou)' };
}

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
// As localizações do motor moram num lugar só. Um `0x02` escrito à mão aqui
// seria uma segunda verdade para a mesma coisa, e `alvos.js` também é um módulo
// puro (sem DOM e sem `fetch`), então importá-lo não custa nada em Node.
import { LOCAL } from './alvos.js';

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
/** Bit da Standby Phase. A fase que existe, no jogo inteiro, para os gatilhos
 *  de tempo acontecerem — ver `momentoDaJanela`. */
export const FASE_STANDBY = 0x2;

/** Alguma das cartas oferecidas está na MINHA MÃO? */
const temCartaDaMao = (p) =>
  (p.choices || []).some((c) => Number(c?.location) === LOCAL.MAO);

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
  // **O GATILHO DE TEMPO, que passa uma vez e não volta.** Os três acima são
  // respostas a alguma coisa; estes dois são o contrário — ninguém fez nada, e
  // é justamente por isso que a janela é a única que vai existir.
  //
  // O relato: a **Golden Ladybug** (87102774) nunca pediu para ser ativada. O
  // efeito dela é `EVENT_PHASE|PHASE_STANDBY` com `SetRange(LOCATION_HAND)` e
  // `SetCountLimit(1)`: revelar a carta na mão, na SUA Standby Phase, e ganhar
  // 500 LP. Nada a invoca, nada a ativa, ninguém ataca — então a janela dela
  // caía em "rotina" e o modo `auto` (que é o PADRÃO) a passava sozinho, todo
  // turno, sem uma linha no log da tela. Do lado de quem joga não há defeito
  // nenhum para ver: a carta simplesmente nunca faz nada.
  //
  // As duas condições são proxies, e o comentário existe para não fingirem que
  // não são — o motor não diz "este efeito é de gatilho e some se você passar":
  //
  //   • **carta na MÃO numa janela que ninguém abriu.** Carta em campo com
  //     livre encadeamento (a Forgotten Temple do Mako) reaparece em TODA
  //     janela — é a rotina que o modo `auto` existe para calar. Da mão, fora
  //     de uma resposta, só aparece o que tem hora marcada: hand trap responde
  //     a ativação/invocação (que já perguntam) e Magia Rápida da mão só sai na
  //     sua Main Phase, pelo idle, nunca por aqui;
  //   • **a sua Standby Phase.** É a fase cuja razão de existir são os
  //     gatilhos de tempo, e ela acontece UMA vez por turno — o teto do
  //     incômodo é uma pergunta por turno, e só para quem tem o que ativar.
  //
  // LIMITE CONHECIDO: um gatilho de tempo de uma carta que já está em CAMPO,
  // fora da Standby, continua sendo passado no `auto`. Para esse caso o modo é
  // o `sempre` — e alargar mais devolveria o sufoco que os modos resolvem.
  if (temCartaDaMao(p)) return 'uma carta da sua mão pode ser ativada agora';
  if (turno === 0 && fase === FASE_STANDBY) return 'é a sua Standby Phase';
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

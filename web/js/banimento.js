/**
 * A pilha de cartas BANIDAS (`LOCATION_REMOVED`, 0x20).
 *
 * Ela não é uma zona do tabuleiro no sentido das regras — o `ocgcore` não tem
 * "5 zonas de banimento" —, é uma PILHA, como o cemitério: as cartas se
 * empilham na ordem em que saem do jogo, e o topo é a última a cair.
 *
 * Existe por um motivo prático: até agora a carta banida sumia da tela e não
 * ia para lugar nenhum. Ninguém conseguia conferir o que já tinha saído do
 * jogo, e efeitos que trazem carta banida de volta apareciam do nada.
 *
 * Duas coisas separam esta pilha do cemitério, e são as duas que este módulo
 * existe para acertar:
 *
 *   1. **Banir com a face para baixo existe.** O cemitério é sempre público;
 *      aqui a carta do adversário pode chegar virada, e nesse caso o servidor
 *      manda `code: 0` (ver `Projetar`/`Oculta` no `InteractiveDuel.cs`). A
 *      pilha guarda a entrada mesmo assim: o jogador precisa saber que TEM
 *      uma carta ali, mesmo sem saber qual.
 *   2. **Carta banida volta.** E quando volta, ela volta com o código REAL —
 *      inclusive a que foi banida virada e entrou aqui como 0. Tirar só por
 *      código deixaria essas para sempre na pilha.
 *
 * Sem DOM e sem `fetch`: é regra, e regra se prova em Node
 * (`node web/js/banimento.test.mjs`).
 */

import { estaVirada } from './posicao.js';

/** `LOCATION_REMOVED` do `constant.lua`. */
export const LOCATION_BANIDO = 0x20;

/**
 * Uma carta entra na pilha. `ev` é o evento `move` do servidor.
 *
 * Devolve a entrada criada — `{ code, virada }`. `code` é 0 quando a carta é
 * do adversário e foi banida com a face para baixo; `virada` é o que a tela
 * usa para desenhar o verso em vez da arte.
 */
export function banir(pilha, ev) {
  const virada = estaVirada(ev?.pos) || !ev?.code;
  const entrada = { code: ev?.code || 0, virada };
  pilha.push(entrada);
  return entrada;
}

/**
 * Uma carta sai da pilha (voltou ao jogo).
 *
 * Tira UMA ocorrência, nunca todas: com três cópias banidas, trazer uma de
 * volta não pode limpar as outras duas — é a mesma armadilha que o cemitério
 * já tinha (`indexOf`, não filtro).
 *
 * A ordem das tentativas é o coração da função:
 *   1. a mesma carta, aberta (o caso comum);
 *   2. não achou? a ÚLTIMA entrada virada — porque uma carta banida com a face
 *      para baixo entrou aqui como código 0 e agora está voltando com o código
 *      real. Sem este passo ela ficaria encalhada na pilha para sempre, e o
 *      contador mentiria pelo resto do duelo.
 *
 * Devolve `true` quando tirou alguma coisa.
 */
export function desbanir(pilha, code) {
  const i = code ? pilha.findIndex((c) => c.code === code && !c.virada) : -1;
  if (i >= 0) { pilha.splice(i, 1); return true; }

  for (let j = pilha.length - 1; j >= 0; j--) {
    if (pilha[j].virada) { pilha.splice(j, 1); return true; }
  }
  return false;
}

/**
 * A entrada do topo — a última carta banida, que é a que a tela mostra na
 * pilha. `null` com a pilha vazia.
 */
export function topoBanido(pilha) {
  return pilha.length ? pilha[pilha.length - 1] : null;
}

/**
 * Quantas cartas dá para IDENTIFICAR na pilha. O total é `pilha.length`; este
 * é o subconjunto aberto. Serve ao título da janela: "3 cartas (1 virada)" é
 * mais honesto que listar três versos sem explicação.
 */
export function contarAbertas(pilha) {
  return pilha.filter((c) => !c.virada && c.code).length;
}

/**
 * **As notificações chegando na hora.**
 *
 * Duas fontes de aviso, de propósito:
 *
 *   • o **Realtime** (`realtime.js`), que traz em menos de um segundo o INSERT
 *     de uma partida e qualquer mudança em `amizades`;
 *   • uma **consulta de reserva** a cada 15s, que é quem garante que a
 *     notificação apareça mesmo com o socket caído, o token vencido ou o
 *     serviço de Realtime fora do ar.
 *
 * > A reserva não é redundância desperdiçada: um push que falha calado é pior
 * > que nenhum push. Enquanto o canal está de pé ela quase nunca acha novidade
 * > — ela existe para o dia em que o canal não estiver.
 *
 * O evento do Realtime é usado só como "algo mudou, olhe de novo". Quem sabe
 * montar a lista é o banco, com a RLS e as regras de prazo (`meus_desafios` só
 * devolve o que chegou nos últimos 10 minutos); reimplementar isso a partir da
 * linha crua faria a tela mentir sobre um desafio já expirado.
 */
import { SUPABASE_URL, SUPABASE_KEY, tokenValido } from '/web/js/supabase.js';
import {
  meusDesafios, amigos, aceitarDesafio, recusarDesafio, responderAmizade,
} from '/web/js/multiplayer.js';
import { ouvirMudancas } from '/web/js/realtime.js';
import { montarNotificacoes, novidades, paraDesafio, paraAmizade } from '/web/js/notificacoes.js';

/** Intervalo da consulta de reserva. Ver o cabeçalho: ela é o seguro. */
export const RESERVA_MS = 15_000;

/**
 * Liga a vigilância.
 *
 * `aoMudar(lista, { novas, tempoReal })` é chamado quando a lista muda —
 * `novas` são as notificações que ainda não estavam lá, e `tempoReal` diz se o
 * canal está de pé (a tela usa isso só para o pontinho de "ao vivo"; nada
 * depende dele funcionalmente).
 *
 * @returns {() => void} chame para parar.
 */
export function vigiar(aoMudar) {
  let vivo = true;
  let ultimas = [];
  let tempoReal = false;
  let lendo = null;
  let primeira = false;

  async function reler() {
    if (!vivo) return;
    // Uma leitura por vez: o Realtime pode disparar três eventos no mesmo
    // instante (o INSERT da partida e as duas linhas da amizade), e três
    // consultas simultâneas voltariam fora de ordem — a lista ficaria com o
    // resultado da mais LENTA, que pode ser a mais velha.
    if (lendo) return lendo;

    lendo = (async () => {
      const [d, a] = await Promise.all([meusDesafios(), amigos()]);
      if (!vivo) return;
      // Consulta que falhou não é "lista vazia": limpar a tela porque a rede
      // piscou apagaria um desafio que ainda está de pé.
      if (!d.ok && !a.ok) return;

      const lista = montarNotificacoes(
        d.ok ? d.dados : ultimas.filter((n) => n.tipo === 'duelo').map(paraDesafio),
        a.ok ? a.dados : ultimas.filter((n) => n.tipo === 'amizade').map(paraAmizade),
      );

      const novas = novidades(ultimas, lista);
      // A PRIMEIRA leitura sempre avisa, mesmo vazia: é ela que tira a tela do
      // estado inicial (contador em branco, pontinho apagado). Sem isto, quem
      // não tem notificação nenhuma ficaria para sempre com a aparência de
      // "ainda carregando" — e o pontinho de tempo real nunca acenderia.
      const mudou = !primeira || novas.length > 0 || lista.length !== ultimas.length;
      primeira = true;
      ultimas = lista;
      if (mudou) aoMudar(lista, { novas, tempoReal });
    })().finally(() => { lendo = null; });

    return lendo;
  }

  const fecharCanal = ouvirMudancas(
    {
      url: SUPABASE_URL,
      apikey: SUPABASE_KEY,
      token: tokenValido,
      tabelas: [{ table: 'partidas', event: 'INSERT' }, { table: 'amizades' }],
    },
    () => reler(),
    (ligado) => {
      tempoReal = ligado;
      // O estado do canal e a lista são coisas diferentes: avisar SEMPRE, senão
      // o pontinho de "ao vivo" mente enquanto a lista não muda.
      aoMudar(ultimas, { novas: [], tempoReal: ligado });
      // O canal caiu e voltou: o que aconteceu no meio não foi entregue a
      // ninguém, então uma releitura na volta é obrigatória.
      if (ligado) reler();
    },
  );

  reler();
  const t = setInterval(reler, RESERVA_MS);

  return () => { vivo = false; clearInterval(t); fecharCanal(); };
}

/**
 * Aceita a notificação. Devolve `{ok, erro, ir}` — `ir` é para onde a tela deve
 * levar quem aceitou.
 *
 * O duelo precisa de um DECK, e por isso ele é um parâmetro: aceitar um desafio
 * sem dizer com o que jogar é o que o banco recusa, e perguntar depois de
 * aceitar deixaria a partida de pé com um dos lados sem baralho.
 */
export async function aceitar(n, deck = null) {
  if (n?.tipo === 'duelo') {
    if (!deck) return { ok: false, erro: 'escolha um deck para aceitar o duelo', ir: null };
    const r = await aceitarDesafio(n.partida, deck);
    return r.ok
      ? { ok: true, erro: null, ir: `/web/duel.html?partida=${encodeURIComponent(n.partida)}` }
      : { ok: false, erro: r.erro, ir: null };
  }

  if (n?.tipo === 'amizade') {
    const r = await responderAmizade(n.quem.id, true);
    // Sem `ir`: o amigo aparece na lista da PRÓPRIA home, ao lado. Mandar para
    // outra tela para ver o que já está à vista seria um passo a troco de nada.
    return { ok: r.ok, erro: r.erro, ir: null };
  }

  return { ok: false, erro: 'notificacao desconhecida', ir: null };
}

/** Recusa. O duelo é recusado no banco; a amizade é respondida com `false`. */
export async function recusar(n) {
  if (n?.tipo === 'duelo') {
    const r = await recusarDesafio(n.partida);
    return { ok: r.ok, erro: r.erro };
  }
  if (n?.tipo === 'amizade') {
    const r = await responderAmizade(n.quem.id, false);
    return { ok: r.ok, erro: r.erro };
  }
  return { ok: false, erro: 'notificacao desconhecida' };
}

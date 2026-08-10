/**
 * A PONTE — duelo entre duas máquinas, sem servidor no meio e sem custo.
 *
 * O motor (`ocgcore`) é uma DLL do Windows e só roda numa das duas pontas. Então
 * uma delas hospeda:
 *
 *   convidado --(jogada)--> Supabase --> navegador do ANFITRIÃO --> localhost:8770
 *   convidado <--(estado)-- Supabase <-- navegador do ANFITRIÃO <-- localhost:8770
 *
 * O convidado nunca alcança a máquina do anfitrião: nada de abrir porta no
 * roteador, nada de túnel, nada de IP fixo. É isso que faz o modo custar zero.
 *
 * O PREÇO, escrito aqui para ninguém descobrir depois: quem hospeda roda o motor
 * e recebe as DUAS visões — inclusive a mão do convidado. Não há como evitar sem
 * um servidor neutro. Por isso partida de ponte não paga DP nem conta ranking
 * (a coluna `partidas.modo` guarda isso desde a migration 0010).
 *
 * Para o `duel.html` as duas pontas são a mesma coisa: `responder()` manda o que
 * eu cliquei, `aoAtualizar()` avisa quando chega visão nova. Quem é anfitrião e
 * quem é convidado fica escondido aqui dentro.
 */
import { req } from '/web/js/supabase.js';

const SRV = 'http://localhost:8770';
const INTERVALO_MS = 900;

async function rpcLocal(caminho, corpo) {
  const r = await fetch(`${SRV}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}

async function rpcBanco(nome, args) {
  const r = await req(`rpc/${nome}`, { method: 'POST', body: args });
  if (!r.ok) throw new Error(r.error || 'falhou');
  return r.dados;
}

/** Os dados da sala: quem sou eu, quem hospeda, e os decks congelados. */
export async function carregarPartida(id, meuId) {
  const r = await req(
    `partidas?select=id,estado,modo,host,jogador_a,jogador_b,ydk_a,ydk_b,seed&id=eq.${id}&limit=1`);
  if (!r.ok || !r.dados?.[0]) return null;

  const p = r.dados[0];
  const souA = p.jogador_a === meuId;
  return {
    ...p,
    // O jogador 0 do MOTOR é sempre o `jogador_a` da sala. Sem essa amarração
    // fixa, os dois lados discordariam sobre quem é quem — e cada um veria a
    // mão do outro como sendo a sua.
    meuJogador: souA ? 0 : 1,
    souAnfitriao: p.host === meuId,
    meuYdk: souA ? p.ydk_a : p.ydk_b,
    ydkAdversario: souA ? p.ydk_b : p.ydk_a,
  };
}

/**
 * Abre a ponte.
 *
 * @param {object} sala   o que `carregarPartida` devolveu
 * @param {(visao) => void} aoAtualizar chamado a cada visão nova PARA MIM
 */
export function abrirPonte(sala, aoAtualizar) {
  let ultimoLance = 0;
  let vivo = true;
  let ocupado = false;   // uma jogada por vez: o motor é sequencial

  const outro = sala.meuJogador === 0 ? 1 : 0;

  // -------------------------------------------------------------- anfitrião

  /** Manda ao motor local e reparte o resultado: eu desenho, ele recebe. */
  async function aoMotor(caminho, corpo) {
    const j = await rpcLocal(caminho, corpo);

    // Sem `visoes` o servidor não entendeu que é multiplayer — provavelmente é
    // uma versão antiga. Melhor falhar claro que desenhar a visão errada.
    if (!j.visoes) throw new Error('o duel-server nao devolveu as duas visoes');

    const minha = j.visoes[String(sala.meuJogador)];
    const dele = j.visoes[String(outro)];

    // Publicar ANTES de desenhar a minha: se a publicação falhar, eu percebo com
    // as duas telas iguais em vez de seguir jogando sozinho.
    await rpcBanco('publicar_estado', { p_partida: sala.id, p_dados: dele });
    aoAtualizar(minha);
    return minha;
  }

  async function iniciarComoAnfitriao(corpoBase) {
    return aoMotor('/start', { ...corpoBase, multiplayer: true });
  }

  // ---------------------------------------------------------------- ambos

  /**
   * Eu joguei. Anfitrião fala com o motor; convidado põe na fila do Supabase e
   * espera a resposta chegar pelo `aoAtualizar`.
   */
  async function responder(action, arg, args) {
    const corpo = args ? { action, arg, args } : { action, arg };

    if (sala.souAnfitriao) {
      return aoMotor('/respond', { ...corpo, jogador: sala.meuJogador });
    }
    await rpcBanco('enviar_jogada', { p_partida: sala.id, p_dados: corpo });
    return null;   // a resposta vem pelo laço, não por aqui
  }

  /**
   * O laço.
   *
   * PESQUISA REPETIDA, não tempo real — mesma decisão do aviso de desafio: o
   * Realtime do Supabase fala o protocolo de canais do Phoenix sobre WebSocket, e
   * este front tem zero dependências de propósito. Com ~1s de intervalo o duelo
   * fica jogável; trocar por Realtime depois mexe só nesta função.
   */
  async function olhar() {
    if (!vivo || ocupado) return;
    ocupado = true;
    try {
      const lances = await rpcBanco('ler_lances', { p_partida: sala.id, p_desde: ultimoLance });
      for (const l of lances ?? []) {
        ultimoLance = Math.max(ultimoLance, l.id);
        if (!vivo) return;

        if (sala.souAnfitriao && l.tipo === 'jogada') {
          // A jogada do convidado entra no motor COMO SENDO DELE. É `jogador`
          // que impede o convidado de jogar na vez do anfitrião — a recusa vem
          // do motor, não daqui.
          const d = l.dados ?? {};
          await aoMotor('/respond', {
            action: d.action ?? 'endturn',
            arg: d.arg ?? 0,
            ...(d.args ? { args: d.args } : {}),
            jogador: outro,
          });
        } else if (!sala.souAnfitriao && l.tipo === 'estado') {
          aoAtualizar(l.dados);
        }
      }
    } catch (e) {
      // Uma volta que falha não derruba o duelo: a próxima tenta de novo, e o
      // `ultimoLance` garante que nada é processado duas vezes.
      console.warn('[ponte] volta falhou:', e.message);
    } finally {
      ocupado = false;
    }
  }

  const timer = setInterval(olhar, INTERVALO_MS);
  olhar();

  return {
    responder,
    iniciarComoAnfitriao,
    souAnfitriao: sala.souAnfitriao,
    meuJogador: sala.meuJogador,
    fechar() { vivo = false; clearInterval(timer); },
  };
}

/** `#main`/`#extra` de um .ydk → listas de ids, para mandar ao motor. */
export function idsDoYdk(ydk) {
  const main = [], extra = [];
  let secao = 'main';
  for (const bruta of String(ydk ?? '').split(/\r?\n/)) {
    const l = bruta.trim();
    if (!l) continue;
    if (/^#extra/i.test(l)) { secao = 'extra'; continue; }
    if (/^!side/i.test(l)) { secao = 'side'; continue; }
    if (/^#main/i.test(l)) { secao = 'main'; continue; }
    if (l[0] === '#' || l[0] === '!') continue;
    if (!/^\d{1,10}$/.test(l)) continue;
    if (secao === 'main') main.push(Number(l));
    else if (secao === 'extra') extra.push(Number(l));
  }
  return { main, extra };
}

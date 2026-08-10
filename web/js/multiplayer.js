/**
 * Multiplayer — amigos, salas por convite e desafio de 1 clique.
 *
 * Camada fina por cima das funções do Supabase (migrations 0009–0012). Nada de
 * regra mora aqui: quem decide se você pode desafiar, se o deck é legal e quem
 * pode aceitar é o banco. Este arquivo só chama e traduz o erro para português.
 *
 * É deliberado: o cliente é a parte que o jogador controla. Toda checagem que
 * vive só aqui é uma checagem que não existe.
 */
import { req, sessao } from '/web/js/supabase.js';

/** Chama uma função do banco. Devolve `{ok, dados, erro}`. */
async function rpc(nome, args = {}) {
  const r = await req(`rpc/${nome}`, { method: 'POST', body: args });
  if (r.ok) return { ok: true, dados: r.dados, erro: null };

  // O PostgREST devolve a mensagem do `raise exception` em `message`. Ela foi
  // escrita para ser lida por gente ("voce so pode desafiar quem esta na sua
  // lista de amigos"), então repassar é melhor que inventar um texto genérico.
  return { ok: false, dados: null, erro: r.error || 'nao consegui falar com o servidor' };
}

export const logado = () => !!sessao();

// ------------------------------------------------------------------ perfil

/** Seu nome e sua etiqueta — o `[22502]` que os outros usam para te achar. */
export async function meuPerfil() {
  const r = await req('perfis?select=usuario,etiqueta&limit=1');
  return r.ok && r.dados?.[0] ? r.dados[0] : null;
}

// ------------------------------------------------------------------ amigos

/** Procura por etiqueta exata (só números) ou por começo do nome. */
export async function buscar(termo) {
  const t = String(termo ?? '').trim();
  if (t.length < 2) return { ok: true, dados: [], erro: null };
  return rpc('buscar_jogador', { p_termo: t });
}

export const pedirAmizade = (etiqueta) => rpc('pedir_amizade', { p_etiqueta: Number(etiqueta) });
export const responderAmizade = (de, aceita) => rpc('responder_amizade', { p_de: de, p_aceita: !!aceita });
export const removerAmigo = (id) => rpc('remover_amigo', { p_amigo: id });

/**
 * A lista da tela. Cada item traz `direcao`, que decide os botões:
 *   'amigo'    → desafiar / remover
 *   'recebido' → aceitar / recusar
 *   'enviado'  → aguardando
 */
export const amigos = () => rpc('meus_amigos');

// ------------------------------------------------------------------- decks

/** Só os nomes — é o que o seletor precisa. */
export async function meusDecks() {
  const r = await req('decks_jogador?select=nome&order=nome');
  return r.ok && Array.isArray(r.dados) ? r.dados.map((d) => d.nome) : [];
}

// ---------------------------------------------------------------- desafios

export const desafiar = (amigoId, deck) => rpc('desafiar_amigo', { p_amigo: amigoId, p_deck: deck });
export const meusDesafios = () => rpc('meus_desafios');
export const aceitarDesafio = (partida, deck) => rpc('aceitar_desafio', { p_partida: partida, p_deck: deck });
export const recusarDesafio = (partida) => rpc('recusar_desafio', { p_partida: partida });

// ------------------------------------------------------------ sala por link

export const criarSala = (deck) => rpc('criar_sala', { p_deck: deck });
export const entrarNaSala = (convite, deck) => rpc('entrar_na_sala', { p_convite: convite, p_deck: deck });
export const espiarSala = (convite) => rpc('espiar_sala', { p_convite: convite });

/** A partida que já está de pé (aguardando ou rolando), se houver. */
export async function minhaPartida() {
  const r = await req(
    'partidas?select=id,estado,modo,convite,jogador_a,jogador_b,convidado' +
    '&estado=in.(aguardando,em_andamento)&order=criado_em.desc&limit=1');
  return r.ok && r.dados?.[0] ? r.dados[0] : null;
}

export const abandonar = (partida) => rpc('abandonar_partida', { p_partida: partida });

// ------------------------------------------------------------------ avisos

/**
 * Fica de olho nos desafios que chegam.
 *
 * É PESQUISA REPETIDA, não tempo real. O Supabase tem Realtime e a tabela
 * `partidas` já está publicada nele, mas o Realtime fala o protocolo de canais
 * do Phoenix sobre WebSocket — e este front tem ZERO dependências de propósito,
 * então usá-lo significaria escrever um cliente de canal à mão.
 *
 * Para "seu amigo te chamou", cinco segundos de atraso não mudam nada, e uma
 * consulta que falha simplesmente não acha nada — não derruba a tela. Trocar por
 * Realtime depois é mexer só nesta função.
 *
 * @returns {() => void} chame para parar de vigiar.
 */
export function vigiarDesafios(aoReceber, intervaloMs = 5000) {
  let vivo = true;
  let ultimos = '';

  async function olhar() {
    if (!vivo || !logado()) return;
    const r = await meusDesafios();
    if (!vivo || !r.ok) return;

    const lista = r.dados ?? [];
    // Só avisa quando MUDA: sem isto a tela se redesenharia a cada 5s, perdendo
    // o texto que o jogador está digitando na busca.
    const carimbo = lista.map((d) => d.partida).join(',');
    if (carimbo !== ultimos) { ultimos = carimbo; aoReceber(lista); }
  }

  olhar();
  const t = setInterval(olhar, intervaloMs);
  return () => { vivo = false; clearInterval(t); };
}

/** `[22502] Fulano` — o formato que aparece na tela inteira. */
export const rotulo = (p) => (p ? `[${p.etiqueta}] ${p.usuario}` : '—');

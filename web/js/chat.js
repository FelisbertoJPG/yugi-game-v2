/**
 * **O CHAT** — o global e a conversa com um amigo.
 *
 * Uma camada só para os dois, porque no banco eles são a mesma tabela e a única
 * diferença é uma coluna (`para` nulo = global). Duas camadas exigiriam dois
 * caminhos de envio, dois de leitura e dois de tempo real para a mesma coisa —
 * e elas divergiriam no primeiro ajuste.
 *
 * **Quem pode falar com quem é decidido no SERVIDOR** (`enviar_mensagem`,
 * migration 0040): a conversa privada só existe entre amigos, e a tabela não tem
 * policy de INSERT — um `POST /mensagens` direto é recusado. Esta camada nunca
 * repete essa regra: repetir seria dar duas respostas para a mesma pergunta, e a
 * do cliente é a que qualquer um edita no console.
 *
 * A ENTREGA tem os mesmos dois caminhos das notificações, e pelo mesmo motivo:
 * o Realtime traz em menos de um segundo, e uma releitura periódica garante a
 * entrega com o socket caído, o token vencido ou o serviço fora do ar. *Um push
 * que falha calado é pior que nenhum push.*
 */
// RELATIVO, e não `/web/js/…`: o caminho absoluto funciona no navegador e não
// resolve em Node, e é ele que torna este arquivo testável (`chat.test.mjs`) —
// a mesma escolha de `drops.js` e `banlist.js`.
import { req } from './supabase.js';

/**
 * Chamada de RPC, no mesmo formato que `multiplayer.js` usa: o `raise exception`
 * do banco chega em `message`, e ele foi escrito para ser lido por gente ("só dá
 * para conversar com amigos"). Repassar é melhor que inventar um texto genérico
 * — e melhor ainda que traduzir aqui, o que criaria uma segunda lista de
 * mensagens para manter em dia com a do servidor.
 */
async function rpc(nome, args = {}) {
  const r = await req(`rpc/${nome}`, { method: 'POST', body: args });
  return r.ok
    ? { ok: true, dados: r.dados, erro: null }
    : { ok: false, dados: null, erro: r.error || 'nao consegui falar com o servidor' };
}

/** O teto do texto. É o MESMO do banco (0040) — aqui só evita a viagem. */
export const MAX_TEXTO = 500;

/**
 * De quanto em quanto tempo cada conversa aberta relê, quando o tempo real não
 * está de pé. Só as ABERTAS: uma janela minimizada não relê nada.
 */
export const RESERVA_MS = 8000;

/**
 * Manda. `para` nulo = chat global.
 *
 * Devolve `{ok, erro}` — e o erro vem do banco, com o texto dele: "só dá para
 * conversar com amigos", "devagar — muitas mensagens seguidas". Traduzi-lo aqui
 * criaria uma segunda lista de mensagens para manter.
 */
export function enviar(para, texto) {
  return rpc('enviar_mensagem', { p_para: para ?? null, p_texto: String(texto ?? '') });
}

/**
 * Lê. `desde` é o id da última mensagem que a tela já tem — zero traz o
 * histórico inicial, e qualquer outro valor traz só o que chegou depois.
 *
 * O banco devolve do mais NOVO para o mais velho (é assim que o `limit` pega as
 * últimas), e a tela desenha na ordem da conversa. A inversão é feita aqui, num
 * lugar só: nas duas telas que leem isto, uma ordem trocada não dá erro — só
 * mostra a conversa de trás para a frente.
 */
export async function ler(para, desde = 0) {
  const r = para
    ? await rpc('chat_com', { p_amigo: para, p_desde: desde })
    : await rpc('chat_global', { p_desde: desde });
  if (!r.ok) return { ok: false, erro: r.erro, mensagens: [] };
  return { ok: true, erro: null, mensagens: (r.dados ?? []).slice().reverse() };
}

/**
 * Junta o que chegou ao que já estava, sem repetir e em ordem.
 *
 * Sem DOM e sem rede de propósito — é regra, e regra se prova em Node
 * (`node web/js/chat.test.mjs`). As três coisas que ela resolve erram CALADAS:
 *
 *   • a MESMA mensagem chega duas vezes (o Realtime avisa e a reserva relê logo
 *     depois), e a conversa passaria a mostrar tudo em dobro;
 *   • elas chegam FORA DE ORDEM quando duas releituras se cruzam, e a conversa
 *     apareceria embaralhada — o que ninguém lê como bug, só como estranho;
 *   • a lista cresce para sempre numa tela que fica aberta o dia todo.
 */
export function juntar(atuais, novas, teto = 200) {
  const vistos = new Set();
  const todas = [];
  for (const m of [...(atuais ?? []), ...(novas ?? [])]) {
    const id = Number(m?.id);
    if (!Number.isFinite(id) || vistos.has(id)) continue;
    vistos.add(id);
    todas.push(m);
  }
  todas.sort((a, b) => Number(a.id) - Number(b.id));
  // Corta pelo COMEÇO: o que interessa numa conversa é o fim dela.
  return todas.length > teto ? todas.slice(todas.length - teto) : todas;
}

/** O maior id da lista — o `desde` da próxima leitura. Zero para lista vazia. */
export function ultimoId(mensagens) {
  let max = 0;
  for (const m of mensagens ?? []) {
    const id = Number(m?.id);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max;
}

/**
 * A mensagem vale a viagem?
 *
 * Espaço em branco não é mensagem, e o banco recusaria — mas a recusa chegaria
 * como um erro vermelho na tela de quem só apertou Enter sem querer. O teto é
 * repetido do banco pelo mesmo motivo: cortar aqui é gentileza, e a trava
 * continua sendo a de lá.
 */
export function valeMandar(texto) {
  const t = String(texto ?? '').trim();
  return t.length > 0 && t.length <= MAX_TEXTO;
}

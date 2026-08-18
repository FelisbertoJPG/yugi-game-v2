/**
 * **A ordem da trilha** — a regra, sozinha.
 *
 * Mora num módulo próprio porque TRÊS lugares precisam dela e nenhum pode
 * carregar os outros: a Trilha de Duelos (`trilha.js`, que no topo já pede
 * sessão e mexe no DOM da página dela), a tela de ordenação (`ordenar.js`) e o
 * teste em Node (`trilha.test.mjs`). Importar `trilha.js` de dentro da tela de
 * ordenação executaria o boot da trilha na página errada.
 *
 * Sem import nenhum de propósito: é função pura, e é isso que a torna testável.
 */

/**
 * Ordena os adversários de uma campanha pela lista publicada em
 * `conteudo/npc-trilha` (`{ campanha: [id, id, …] }`, migration 0032).
 *
 * Por ID, e não por índice: índice muda de significado quando um adversário
 * novo entra na campanha, e trocaria a trilha de todo mundo sem ninguém mexer
 * em nada — a mesma armadilha que o deck ativo teve (migration 0030).
 *
 * Quem não está na lista publicada continua aparecendo, NO FIM e na ordem em
 * que veio. Sumir da trilha por falta de configuração seria pior que ficar fora
 * de ordem: um adversário criado agora ficaria invisível até alguém abrir a
 * tela de ordenação.
 *
 * @param {Array<{id: string}>} daCampanha adversários da campanha
 * @param {string[]} [idsPublicados] a ordem publicada, se houver
 */
export function ordenarCampanha(daCampanha, idsPublicados) {
  const pos = new Map((idsPublicados ?? []).map((id, i) => [id, i]));
  return daCampanha
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (pos.get(a.n.id) ?? Infinity) - (pos.get(b.n.id) ?? Infinity) || a.i - b.i)
    .map((x) => x.n);
}

/**
 * Quais adversários estão LIBERADOS: o primeiro sempre, e cada um que vier
 * depois de uma vitória. Vencer fora de ordem (por um link direto, ou porque a
 * ordem da campanha mudou depois) libera o próprio vencido e o seguinte — mas
 * não a trilha inteira em cascata.
 */
export function liberados(lista, vencidos) {
  const out = [];
  let podeOProximo = true;
  for (const npc of lista) {
    const aberto = podeOProximo || vencidos.has(npc.id);
    out.push(aberto);
    podeOProximo = aberto && vencidos.has(npc.id);
  }
  return out;
}

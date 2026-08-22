/**
 * **A regra do que está esperando resposta**: desafios para duelar e pedidos de
 * amizade, numa lista só.
 *
 * Sem DOM e sem rede, como `trilhaordem.js` e `drops.js` — porque é ela que
 * erra **calada**. Uma chave repetida faz a mesma notificação aparecer duas
 * vezes e o contador mentir; uma chave que muda a cada consulta faz o cartão
 * aberto se fechar sozinho a cada 15 segundos, na cara de quem estava lendo o
 * convite. Nenhuma das duas dá erro.
 *
 * Quem fala com o banco e com o Realtime é `notificacoesvivo.js`.
 */

/**
 * Junta desafios e pedidos de amizade numa lista ordenada.
 *
 * A **chave** é o que identifica uma notificação entre duas consultas: precisa
 * ser estável e única. Por isso é `<tipo>:<id da origem>`, e nunca a posição na
 * lista nem o instante em que chegou.
 *
 * Ordem: **duelo antes de amizade**, e dentro de cada tipo o mais novo
 * primeiro. Um desafio expira em 10 minutos (`meus_desafios`); um pedido de
 * amizade espera para sempre. O que tem prazo vem primeiro.
 *
 * @param {Array} desafios  o que `meus_desafios()` devolve
 * @param {Array} listaAmigos  o que `meus_amigos()` devolve (a lista inteira)
 * @returns {Array<{chave, tipo, quem, quando, partida}>}
 */
export function montarNotificacoes(desafios, listaAmigos) {
  const out = [];
  const vistos = new Set();
  const por = (lista) => (Array.isArray(lista) ? lista : []);

  for (const d of por(desafios)) {
    if (!d?.partida) continue;
    const chave = `duelo:${d.partida}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({
      chave,
      tipo: 'duelo',
      quem: { id: d.de ?? null, usuario: d.usuario ?? '?', etiqueta: d.etiqueta ?? null },
      quando: d.criado_em ?? null,
      partida: d.partida,
    });
  }

  for (const a of por(listaAmigos)) {
    // Só o que ESPERA resposta minha. 'enviado' é o meu pedido esperando o
    // outro, e notificar-me dele seria me avisar de algo que eu fiz.
    if (a?.direcao !== 'recebido' || !a?.id) continue;
    const chave = `amizade:${a.id}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({
      chave,
      tipo: 'amizade',
      quem: { id: a.id, usuario: a.usuario ?? '?', etiqueta: a.etiqueta ?? null },
      quando: a.desde ?? null,
      partida: null,
    });
  }

  const peso = (n) => (n.tipo === 'duelo' ? 0 : 1);
  const instante = (n) => {
    const t = Date.parse(n.quando ?? '');
    // Sem data válida vai para o fim do seu grupo, e não para o topo: um `NaN`
    // comparado dá false nos dois sentidos, e a ordem viraria a de chegada —
    // instável entre duas consultas da mesma coisa.
    return Number.isFinite(t) ? t : -Infinity;
  };
  return out.sort((a, b) => peso(a) - peso(b) || instante(b) - instante(a));
}

/**
 * Quais chaves são NOVAS em relação à lista anterior.
 *
 * É o que decide se o quadro pisca. Comparar o tamanho não serve: um desafio
 * expirando e outro chegando entre duas consultas deixa a contagem igual, e o
 * novo passaria despercebido.
 */
export function novidades(antes, agora) {
  const tinha = new Set((antes ?? []).map((n) => n.chave));
  return (agora ?? []).filter((n) => !tinha.has(n.chave));
}

/**
 * Voltas para o formato de origem. Usadas quando UMA das duas consultas falha e
 * a outra deu certo: assim a metade que ainda vale é preservada na tela em vez
 * de sumir porque a rede piscou.
 */
export const paraDesafio = (n) => ({
  partida: n.partida, de: n.quem.id, usuario: n.quem.usuario,
  etiqueta: n.quem.etiqueta, criado_em: n.quando,
});

export const paraAmizade = (n) => ({
  id: n.quem.id, usuario: n.quem.usuario, etiqueta: n.quem.etiqueta,
  direcao: 'recebido', desde: n.quando,
});

/**
 * **A fila do que ainda não chegou à nuvem.**
 *
 * Publicar conteúdo é `fire-and-forget`: as telas de admin gravam a cada tecla e
 * não podem esperar a rede. O `projectstore.js` já mostra um aviso quando o
 * banco recusa — mas avisar não é entregar. Havia dois jeitos de uma edição do
 * admin morrer na máquina dele:
 *
 * 1. **O banco recusou** (rede caída, sessão vencida, 403). Aparecia o aviso, e
 *    o texto dizia "salve de novo" — quer dizer, o conserto era manual, e quem
 *    fechasse a aba perdia a edição para todo mundo menos para si mesmo.
 * 2. **A trava `leu*Disco` engoliu a gravação.** Seis pontos (`banlist`,
 *    `boosters`, `cardlists`, `npcs`, `npc-base-meta`, `npc-deck-ativo`) só
 *    publicam depois de terem LIDO a fonte, para uma máquina offline não
 *    sobrescrever o banco com um estado que ela mesma inventou. A trava está
 *    certa; o que estava errado era o que ela fazia com a edição: descartava.
 *    Em quatro dos seis nem um `console.warn` sobrava.
 *
 * Agora nada é descartado: o que não subiu fica AQUI, e o `projectstore` tenta
 * de novo sozinho (no boot de qualquer página, quando a conexão volta e de
 * tempos em tempos) até o banco aceitar.
 *
 * Este módulo é só a fila — sem DOM, sem `fetch`, com o armazenamento injetado.
 * É isso que o torna testável em Node (`node web/js/pendencias.test.mjs`).
 */

export const CHAVE_FILA = 'ygo:conteudo-pendente';

/** Um `localStorage` de mentira, para Node e para quando o navegador barra. */
export function memoriaFalsa(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

function ler(store) {
  try {
    const cru = store?.getItem(CHAVE_FILA);
    if (!cru) return {};
    const o = JSON.parse(cru);
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch {
    // Fila corrompida não pode travar o editor: vale mais recomeçar vazia do
    // que estourar em toda gravação seguinte.
    return {};
  }
}

function gravar(store, fila) {
  // Sem storage não há onde guardar, e dizer `true` seria pior que falhar: quem
  // chama trataria a pendência como salva e pararia de avisar.
  if (!store) return false;
  try {
    if (!Object.keys(fila).length) store.removeItem(CHAVE_FILA);
    else store.setItem(CHAVE_FILA, JSON.stringify(fila));
    return true;
  } catch {
    return false;   // cota estourada / modo privativo
  }
}

/**
 * Guarda (ou substitui) a pendência de uma chave.
 *
 * Uma pendência por chave, sempre a MAIS NOVA: cada envio carrega o documento
 * inteiro, então o último já contém o que os anteriores diriam. Guardar um
 * histórico só criaria a chance de republicar um estado velho por cima do bom.
 */
export function enfileirar(store, name, data, motivo = '') {
  if (!name) return false;
  const fila = ler(store);
  fila[name] = { data, motivo: String(motivo || ''), em: new Date().toISOString() };
  return gravar(store, fila);
}

/** Tira da fila — a chave foi aceita pelo banco. */
export function desenfileirar(store, name) {
  const fila = ler(store);
  if (!(name in fila)) return false;
  delete fila[name];
  return gravar(store, fila);
}

/** `[{ name, data, motivo, em }]`, na ordem em que entraram. */
export function listar(store) {
  return Object.entries(ler(store))
    .map(([name, v]) => ({ name, data: v?.data, motivo: v?.motivo ?? '', em: v?.em ?? null }));
}

export const quantas = (store) => listar(store).length;
export const temPendencia = (store, name) => name in ler(store);

/** Esvazia a fila inteira. Só para o teste e para um botão de "desistir". */
export function limpar(store) {
  return gravar(store, {});
}

/**
 * O texto do aviso, montado aqui para a tela não inventar o seu.
 * `null` quando não há nada pendente — é o sinal de "pode esconder o aviso".
 */
export function resumo(store) {
  const l = listar(store);
  if (!l.length) return null;
  const nomes = l.map((x) => x.name).join(', ');
  return l.length === 1
    ? `1 alteração ainda não publicada (${nomes})`
    : `${l.length} alterações ainda não publicadas (${nomes})`;
}

/**
 * **O formato `.ydk`, e as GAVETAS por raridade de um deck.**
 *
 * Mora fora do `estruturais.js` pelo mesmo motivo do `pacote.js`: aqui não há
 * `supabase.js` nem `localStorage`, então o Node importa e o `ydk.test.mjs`
 * existe. Ler o `.ydk` errado não dá erro nenhum — devolve um deck com menos
 * cartas, e a tela mostra a lista incompleta com a maior naturalidade.
 *
 * O `estruturais.js` reexporta `paraYdk`/`deYdk`, então quem já os importava de
 * lá continua funcionando.
 */

/** Da mais alta para a mais baixa — a ordem importa (define a "maior"). */
export const RARIDADES = ['UR', 'SR', 'R', 'N'];

/** `{ UR: [], SR: [], R: [], N: [] }`. */
export const gavetasVazias = () => ({ UR: [], SR: [], R: [], N: [] });

/** `{ [id]: quantidade }` → texto .ydk (só main; estrutural não usa extra/side hoje). */
export function paraYdk(quantidades, { criadoPor = 'classic duels' } = {}) {
  const linhas = [`#created by ${criadoPor}`, '#main'];
  for (const [id, n] of Object.entries(quantidades))
    for (let i = 0; i < n; i++) linhas.push(String(id));
  linhas.push('#extra', '!side', '');
  return linhas.join('\n');
}

/** O inverso: texto .ydk → `{ [id]: quantidade }` do main. */
export function deYdk(ydk) {
  const out = {};
  let secao = 'main';
  for (const cru of String(ydk ?? '').split(/\r?\n/)) {
    const l = cru.trim();
    if (!l) continue;
    if (/^#extra/i.test(l)) { secao = 'extra'; continue; }
    if (/^!side/i.test(l))  { secao = 'side';  continue; }
    if (/^#main/i.test(l))  { secao = 'main';  continue; }
    if (l.startsWith('#') || l.startsWith('!')) continue;
    if (secao !== 'main' || !/^\d{1,10}$/.test(l)) continue;
    out[l] = (out[l] ?? 0) + 1;
  }
  return out;
}

/**
 * **As gavetas por raridade de um deck** — o que a Loja mostra em "ver as
 * cartas" de um Deck Estrutural.
 *
 * A ordem em que a raridade é procurada é a MESMA do servidor
 * (`raridade_da_carta`, migration 0019): **o booster vence**, o mapa do próprio
 * estrutural entra depois, e o que não está em lugar nenhum é N.
 *
 * Não é detalhe de tela: é essa raridade que define o preço de venda no
 * Inventário (`vender_cartas`). Inverter a ordem faria a mesma carta aparecer
 * UR na Loja e ser vendida como N — e nada acusaria, porque as duas telas
 * estariam "certas" cada uma pela sua conta.
 *
 * `doBooster(id)` devolve a raridade do booster ou `null`; quem chama passa o
 * `rarityOf` de `boosters.js` (que lê o `localStorage` e por isso não pode
 * morar aqui).
 */
export function gavetasDoDeck(quantidades, raridades = {}, doBooster = () => null) {
  const pool = gavetasVazias();
  for (const id of Object.keys(quantidades ?? {})) {
    const r = doBooster(id) ?? raridades?.[String(id)] ?? 'N';
    (pool[r] ?? pool.N).push(Number(id));
  }
  return pool;
}

/**
 * **Mapa `id → raridade` juntando TODOS os Decks Estruturais publicados.**
 *
 * O booster não é a única fonte de raridade: um Deck Estrutural carrega o seu
 * próprio mapa (`decks_estruturais.raridades`), e é ele que dá raridade à carta
 * que nunca entrou em pacote nenhum. Quem lê os dois é o servidor, nesta ordem
 * — booster primeiro, estrutural depois (`raridade_da_carta`, migration 0019).
 *
 * Quando dois estruturais listam a mesma carta em raridades diferentes, vence a
 * **MAIOR**, que é o mesmo critério do `rarityIndex` dos boosters e o do
 * `order by` daquela função. Sem isso a carta valeria uma coisa na tela e outra
 * na venda, cada uma certa pela sua conta.
 *
 * Aqui porque é puro: `estruturais.js` fala com o Supabase e não roda em Node.
 *
 * @param {Array<{raridades?: object}>} estruturais  o que `listarEstruturais()` devolve
 * @returns {Map<number, string>}
 */
export function raridadesDosEstruturais(estruturais) {
  const mapa = new Map();
  for (const deck of Array.isArray(estruturais) ? estruturais : []) {
    for (const [cru, r] of Object.entries(deck?.raridades ?? {})) {
      const id = Number(cru);
      if (!Number.isInteger(id) || id <= 0) continue;
      if (!RARIDADES.includes(r)) continue;
      const atual = mapa.get(id);
      if (!atual || RARIDADES.indexOf(r) < RARIDADES.indexOf(atual)) mapa.set(id, r);
    }
  }
  return mapa;
}

/** Quantas cartas o deck tem no total (contando as cópias). */
export function totalDoDeck(quantidades) {
  return Object.values(quantidades ?? {}).reduce((a, b) => a + b, 0);
}

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

/** Quantas cartas o deck tem no total (contando as cópias). */
export function totalDoDeck(quantidades) {
  return Object.values(quantidades ?? {}).reduce((a, b) => a + b, 0);
}

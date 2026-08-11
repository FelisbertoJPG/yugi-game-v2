/**
 * Decks Estruturais — decks prontos vendidos na Loja.
 *
 * Diferença para o booster: o booster dá cartas soltas e o jogador monta; o
 * estrutural entra direto em `decks_jogador`, montado, pronto para escolher no
 * PvP ou no PvE.
 *
 * O DADO VIVE NO SUPABASE, não em `store/*.json`. É a regra de toda ferramenta
 * nova da Área de Teste: salvo em disco, o que se cria lá nunca chegaria em
 * quem joga — dependeria de publicar um Release. Pelo banco, o admin publica e
 * todo mundo recebe no próximo boot.
 *
 * Quem escreve é só admin (RLS `eh_admin()`); a leitura é aberta, inclusive
 * anônima, porque a vitrine da Loja carrega antes do login.
 */

import { req, sessao } from '/web/js/supabase.js';

/** `[{id, nome, preco, capa, ydk, na_loja, ordem}]`, na ordem da vitrine. */
export async function listarEstruturais({ soLoja = false } = {}) {
  const filtro = soLoja ? '&na_loja=eq.true' : '';
  const r = await req(`decks_estruturais?select=*${filtro}&order=ordem,nome`);
  return r.ok && Array.isArray(r.dados) ? r.dados : [];
}

/** Ids dos estruturais que ESTA conta já comprou (a Loja marca "adquirido"). */
export async function jaComprados() {
  if (!sessao()) return new Set();
  const r = await req('compras_estruturais?select=deck_id');
  return new Set(r.ok && Array.isArray(r.dados) ? r.dados.map((c) => c.deck_id) : []);
}

/**
 * Compra. O servidor cobra o DP, credita as cartas na coleção, grava o deck e
 * registra a compra — tudo na mesma transação.
 *
 * Creditar as cartas não é detalhe: `salvar_deck` confere posse carta a carta,
 * então sem isso o jogador receberia um deck que não consegue reeditar.
 */
export async function comprarEstrutural(id) {
  const r = await req('rpc/comprar_deck_estrutural', {
    method: 'POST',
    body: { p_id: id },
  });
  if (r.ok) return { ok: true, deck: r.dados?.deck, preco: r.dados?.preco };

  const m = r.error ?? '';
  if (/ja tem este deck/i.test(m)) return { ok: false, error: 'você já tem este deck' };
  if (/DP insuficiente/i.test(m)) return { ok: false, error: 'DP insuficiente' };
  if (/sem conexao/i.test(m))     return { ok: false, error: 'sem conexão' };
  return { ok: false, error: m || 'não consegui comprar' };
}

/** Grava (cria ou atualiza) um estrutural. Só admin — a RLS recusa o resto. */
export async function salvarEstrutural(deck) {
  const r = await req('decks_estruturais?on_conflict=id', {
    method: 'POST',
    body: {
      id: deck.id,
      nome: deck.nome,
      preco: Number(deck.preco) || 0,
      capa: deck.capa ? Number(deck.capa) : null,
      ydk: deck.ydk,
      // `{id: 'UR'|...}`. Alimenta o preço de venda, como os boosters: sem isto
      // uma carta que só exista em estrutural venderia como N.
      raridades: deck.raridades ?? {},
      na_loja: deck.na_loja !== false,
      ordem: Number(deck.ordem) || 0,
    },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (r.ok) return { ok: true };
  return {
    ok: false,
    error: /row-level security/i.test(r.error ?? '')
      ? 'só um admin pode publicar deck estrutural'
      : (r.error || 'não consegui salvar'),
  };
}

export async function apagarEstrutural(id) {
  const r = await req(`decks_estruturais?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { ok: r.ok, error: r.error };
}

/**
 * Confere tamanho e cópias PELO SERVIDOR, com a mesma função que a compra usa.
 *
 * Validar só no navegador deixaria o servidor e a tela discordando na hora que
 * mais importa — a publicação. Devolve `{ok, main, extra, side, problemas[]}`.
 */
export async function validarYdk(ydk) {
  const r = await req('rpc/validar_deck_estrutural', {
    method: 'POST',
    body: { p_ydk: ydk },
  });
  return r.ok ? r.dados : { ok: false, problemas: [r.error ?? 'sem conexão'] };
}

/**
 * Em qual raridade a carta JÁ está travada por um booster publicado (ou null).
 *
 * A regra vem do Booster Builder: **a raridade é da carta, não do pacote**. Um
 * reprint entra na raridade que a carta já tem. Sem isto, a mesma carta seria
 * UR num booster e N num estrutural — e o preço de venda dela dependeria de
 * onde o servidor olhasse primeiro.
 */
export function travadaPorBooster(id, boosters) {
  const lista = Array.isArray(boosters) ? boosters : Object.values(boosters ?? {});
  for (const r of ['UR', 'SR', 'R', 'N'])
    for (const b of lista)
      if ((b?.cards?.[r] ?? []).map(Number).includes(Number(id)))
        return { rarity: r, booster: b.name };
  return null;
}

/** `{ [id]: quantidade }` -> texto .ydk (só main; estrutural não usa extra/side hoje). */
export function paraYdk(quantidades, { criadoPor = 'duel academy' } = {}) {
  const linhas = [`#created by ${criadoPor}`, '#main'];
  for (const [id, n] of Object.entries(quantidades))
    for (let i = 0; i < n; i++) linhas.push(String(id));
  linhas.push('#extra', '!side', '');
  return linhas.join('\n');
}

/** O inverso: texto .ydk -> `{ [id]: quantidade }` do main. */
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

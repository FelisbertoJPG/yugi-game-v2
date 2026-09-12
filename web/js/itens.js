/**
 * **Os ITENS** — os cosméticos que não são ícone de perfil.
 *
 * O ícone veio primeiro e ficou com tabela própria (migrations 0035/0036/0039),
 * e continua lá: quem escolhe um é `escolher_icone`, quem valida a posse é o
 * gatilho `perfis_icone_valido`, e a coluna é `perfis.icone_id`. Generalizar
 * aquilo para caber aqui seria trocar um caminho que funciona por um que ainda
 * não existe — então **este módulo não toca no ícone**. Ele é o resto: sleeve,
 * playmat, deckbox e o `generico`, que existe para a próxima ideia não precisar
 * de migration.
 *
 * A tela de criação é UMA (`web/itens.html`) e o tipo é a primeira escolha
 * dela: em `icone` ela manda para o editor de ícones que já existe, em vez de
 * ter uma segunda cópia daquele formulário. Duas telas que gravam a mesma coisa
 * divergem na primeira mudança — este projeto já pagou por isso
 * (`chancesDe` × `chancesDoPacote`).
 *
 * Sem DOM aqui: é o que deixa `itens.test.mjs` rodar em Node.
 */
import { req } from './supabase.js';
import { slug } from './icones.js';

export { slug };

/**
 * Os tipos que o banco aceita (o mesmo CHECK da coluna `itens.tipo`), mais o
 * `icone`, que NÃO é desta tabela e por isso está separado — ele é uma opção
 * da TELA, não um valor gravável aqui.
 */
export const TIPOS = ['generico', 'sleeve', 'playmat', 'deckbox'];
export const TIPO_ICONE = 'icone';

/** O rótulo de cada tipo na tela. */
export const ROTULO_DO_TIPO = {
  generico: 'item genérico',
  sleeve: 'sleeve',
  playmat: 'playmat',
  deckbox: 'deck box',
  [TIPO_ICONE]: 'ícone de perfil',
};

/** As opções do select, na ordem em que aparecem. */
export const OPCOES_DE_TIPO = [...TIPOS, TIPO_ICONE];

/** É o tipo que a tela delega ao editor de ícones? */
export const ehIcone = (tipo) => tipo === TIPO_ICONE;

/** O mesmo formato de `data:` do CHECK da coluna. Um valor torto vira um `src`
 *  que o navegador busca, não acha, e desenha como quadrado vazio — sem erro. */
const IMAGEM = /^data:image\//;

/**
 * Põe um item em forma antes de subir. Devolve `{ok, item, erro}`.
 *
 * A validação mora aqui e não na tela porque ela é a MESMA do banco, e é a
 * única forma de a mensagem chegar em português antes de o Postgres recusar com
 * o nome da constraint. O banco continua sendo a fechadura — isto é a porta.
 */
export function prepararItem(bruto) {
  const b = bruto ?? {};
  const nome = String(b.nome ?? '').trim();
  if (!nome) return { ok: false, erro: 'dê um nome ao item' };

  const id = String(b.id ?? '').trim() || slug(nome);
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
    return { ok: false, erro: 'id inválido (só minúsculas, números e traço)' };
  }

  const tipo = String(b.tipo ?? 'generico');
  if (!TIPOS.includes(tipo)) {
    // O `icone` cai aqui de propósito: ele não é gravável nesta tabela, e um
    // item de tipo `icone` em `itens` seria um cosmético que a tela de perfil
    // nunca oferece — cadastrado, pago, e inútil.
    return { ok: false, erro: `tipo "${tipo}" não é um item desta tabela` };
  }

  let preco = Number(b.preco);
  if (!Number.isFinite(preco) || preco < 0) preco = 0;
  preco = Math.trunc(preco);

  const item = {
    id, tipo, nome, preco,
    na_loja: !!b.na_loja,
    ordem: Number.isFinite(Number(b.ordem)) ? Math.trunc(Number(b.ordem)) : 0,
  };

  // A imagem só entra quando há uma NOVA. Mandar `null` ao editar só o preço
  // apagaria a arte de um item que já está à venda — é a mesma regra do ícone,
  // e ela existe porque o erro é invisível até alguém abrir a Loja.
  if (b.imagem) {
    if (!IMAGEM.test(b.imagem)) return { ok: false, erro: 'isso não é uma imagem' };
    if (b.imagem.length > 512 * 1024) {
      return { ok: false, erro: 'a imagem ficou grande demais (o teto é 512 KB)' };
    }
    item.imagem = b.imagem;
  }

  return { ok: true, item, erro: null };
}

/** O catálogo. `comArte: false` pula a coluna pesada — a lista da tela de
 *  administração precisa da arte, um contador não. */
export async function catalogo({ comArte = true } = {}) {
  const campos = comArte
    ? 'id,tipo,nome,preco,na_loja,ordem,imagem'
    : 'id,tipo,nome,preco,na_loja,ordem';
  const r = await req(`itens?select=${campos}&order=ordem.asc,nome.asc`);
  return r.ok && Array.isArray(r.dados) ? r.dados : [];
}

/**
 * Grava (cria ou edita). A imagem vai no MESMO `upsert` que o resto: separá-la
 * em duas chamadas deixaria a linha existir sem arte no intervalo entre elas —
 * e para sempre, se a segunda falhasse.
 */
export async function salvarItem(bruto) {
  const p = prepararItem(bruto);
  if (!p.ok) return { ok: false, erro: p.erro };

  const r = await req('itens?on_conflict=id', {
    method: 'POST',
    body: p.item,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (r.ok) return { ok: true, erro: null };

  const m = r.error ?? '';
  if (/row-level security/i.test(m)) return { ok: false, erro: 'só um admin pode cadastrar itens' };
  if (/itens_imagem_tamanho/i.test(m)) return { ok: false, erro: 'a imagem ficou grande demais (o teto é 512 KB)' };
  if (/itens_imagem_check/i.test(m)) return { ok: false, erro: 'isso não é uma imagem' };
  if (/itens_id_check/i.test(m)) return { ok: false, erro: 'id inválido (só minúsculas, números e traço)' };
  if (/itens_tipo_check/i.test(m)) return { ok: false, erro: 'tipo desconhecido' };
  return { ok: false, erro: m || 'não consegui salvar' };
}

/**
 * **O que EU tenho** (`meus_itens`, migration 0052). Devolve o catálogo inteiro
 * com um `tenho` — de propósito: assim a MESMA consulta serve ao inventário
 * (que filtra pelos meus) e a uma vitrine (que mostra o que falta).
 */
export async function meusItens() {
  const r = await req('rpc/meus_itens', { method: 'POST', body: {} });
  return r.ok && Array.isArray(r.dados) ? r.dados : [];
}

export async function apagarItem(id) {
  const r = await req(`itens?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { ok: r.ok, erro: r.error };
}

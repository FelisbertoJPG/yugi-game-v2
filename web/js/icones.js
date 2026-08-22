/**
 * **Ícones de perfil** — o catálogo, a posse e a escolha.
 *
 * Três coisas separadas no banco (migration 0035), e a separação é o ponto:
 *
 *     icones             o CATÁLOGO — que ícones existem, quanto custam
 *     icones_do_jogador  a POSSE    — quem tem cada um
 *     perfis.icone_id    a ESCOLHA  — qual está em uso agora
 *
 * **A imagem mora no repositório** (`web/img/icones/<arquivo>`) e viaja no
 * `game.zip`; o banco guarda só o nome do arquivo. É uma escolha com uma
 * consequência que precisa ser dita em voz alta: **um ícone cadastrado cuja
 * imagem não foi publicada aparece quebrado**, e nem o banco nem o navegador
 * sabem disso — o banco não enxerga o disco, e o navegador não lista pastas.
 *
 * Por isso existe o **manifesto** (`web/img/icones/index.json`, gerado por
 * `node tools/icones.mjs`): o painel do admin só oferece arquivos que estão
 * nele, e o `npm run icones:check` cruza o catálogo publicado com ele antes de
 * a falha chegar em quem joga. É a mesma ideia do `boosters:check`.
 *
 * Quem decide o que você pode usar é o SERVIDOR (`escolher_icone` mais o
 * gatilho `perfis_icone_valido`, migration 0036). Esta camada só desenha e
 * pede — uma trava que vive só aqui é uma trava que não existe.
 */
import { req } from './supabase.js';

/** Onde as imagens moram. Um lugar só, e é este. */
export const PASTA = '/web/img/icones';

/**
 * O ícone de quem ainda não escolheu — e o de quem escolheu um que foi apagado
 * do catálogo (`on delete set null`).
 *
 * É o ícone do próprio jogo, que já está no repositório desde sempre: um padrão
 * que depende de conteúdo publicado poderia sumir, e aí a home nasceria com um
 * quadrado vazio no lugar do avatar.
 */
export const PADRAO = '/web/img/icone.png';

/**
 * O caminho da imagem de um ícone. `null`/desconhecido cai no padrão — nunca
 * numa URL quebrada.
 *
 * Aceita tanto a linha do catálogo (`{arquivo}`) quanto só o nome do arquivo,
 * porque os dois formatos circulam: a tela de escolha tem a linha inteira, e a
 * lista de amigos recebe só o `icone_id` e resolve pelo mapa.
 */
export function caminhoDoIcone(icone) {
  const arquivo = typeof icone === 'string' ? icone : icone?.arquivo;
  if (!arquivo || !/^[A-Za-z0-9._-]{1,64}$/.test(arquivo)) return PADRAO;
  return `${PASTA}/${arquivo}`;
}

/**
 * Mapa `id → arquivo` a partir do catálogo.
 *
 * Existe porque `meus_amigos()` devolve o `icone_id` de cada amigo, mas não o
 * arquivo — e não poderia: a policy de `perfis` só deixa cada um ver o próprio
 * registro, então a lateral precisa cruzar o id com o catálogo, que é de
 * leitura aberta.
 */
export function mapaDeArquivos(catalogo) {
  const m = new Map();
  for (const i of Array.isArray(catalogo) ? catalogo : []) {
    if (i?.id && i?.arquivo) m.set(String(i.id), String(i.arquivo));
  }
  return m;
}

/**
 * O id que o admin digitou, em forma de slug — o mesmo formato que o `check` da
 * coluna exige (`^[a-z0-9][a-z0-9-]{0,31}$`).
 *
 * Gerar o slug aqui, e não deixar o admin digitar livre, evita o erro que o
 * Postgres só reporta na hora de salvar, com a mensagem dele: um `check
 * constraint violation` no meio de um cadastro é o tipo de recusa que não
 * explica o que fazer.
 */
export function slug(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira os acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');                                 // o corte pode deixar traço no fim
}

/**
 * Quais ícones do catálogo estão SEM imagem no repositório.
 *
 * A conta que o `icones:check` faz, aqui porque a tela do admin mostra a mesma
 * coisa enquanto ele cadastra — descobrir na publicação o que dava para
 * descobrir na hora de digitar é tarde demais.
 */
export function semImagem(catalogo, arquivosDoRepo) {
  const tem = new Set((arquivosDoRepo ?? []).map(String));
  return (Array.isArray(catalogo) ? catalogo : [])
    .filter((i) => i?.arquivo && !tem.has(String(i.arquivo)));
}

// ------------------------------------------------------------------- rede

/** Chama uma função do banco. Devolve `{ok, dados, erro}`. */
async function rpc(nome, args = {}) {
  const r = await req(`rpc/${nome}`, { method: 'POST', body: args });
  return r.ok
    ? { ok: true, dados: r.dados, erro: null }
    : { ok: false, dados: null, erro: r.error || 'nao consegui falar com o servidor' };
}

/**
 * O catálogo com `tenho` e `em_uso`, na ordem do banco (os seus primeiro).
 * É a lista que a tela de escolha desenha.
 */
export const meusIcones = () => rpc('meus_icones');

/**
 * Troca o ícone em uso. `null` volta ao padrão do jogo.
 *
 * O servidor recusa o que não é seu — não confira aqui antes de pedir: uma
 * segunda checagem no cliente só criaria um lugar a mais para divergir.
 */
export const escolherIcone = (id) => rpc('escolher_icone', { p_id: id ?? null });

/** Dá um ícone a alguém. Só admin (o banco recusa o resto). */
export const darIcone = (usuario, icone) =>
  rpc('dar_icone', { p_usuario: usuario, p_icone: icone });

/** O catálogo cru, sem posse — leitura aberta, serve para a vitrine e o admin. */
export async function catalogo() {
  const r = await req('icones?select=*&order=ordem,nome');
  return r.ok && Array.isArray(r.dados) ? r.dados : [];
}

/**
 * Cadastra ou atualiza um ícone. Só admin — a RLS recusa o resto, e a mensagem
 * dela é repassada porque foi escrita para ser lida.
 */
export async function salvarIcone(icone) {
  const r = await req('icones?on_conflict=id', {
    method: 'POST',
    body: {
      id: icone.id,
      nome: icone.nome,
      arquivo: icone.arquivo,
      preco: Number(icone.preco) || 0,
      raridade: icone.raridade || 'N',
      gratuito: !!icone.gratuito,
      na_loja: !!icone.na_loja,
      ordem: Number(icone.ordem) || 0,
    },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (r.ok) return { ok: true, erro: null };
  return {
    ok: false,
    erro: /row-level security/i.test(r.error ?? '')
      ? 'só um admin pode cadastrar ícones'
      : (r.error || 'não consegui salvar'),
  };
}

/**
 * Apaga do catálogo. Quem estava usando volta ao padrão (`on delete set null`)
 * e quem o tinha perde a posse (`on delete cascade`) — as duas coisas são
 * decisão do schema, e é por isso que não há confirmação extra aqui além da da
 * tela.
 */
export async function apagarIcone(id) {
  const r = await req(`icones?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { ok: r.ok, erro: r.error };
}

/**
 * O que a pasta `web/img/icones/` tem, pelo manifesto.
 *
 * Arquivo estático de propósito: uma rota de listagem custaria implementação
 * nos DOIS back-ends (`tools/serve.mjs` e `StaticServer.cs`), e divergir ali
 * faz a tela funcionar no `npm run dev` e falhar no jogo instalado.
 *
 * Devolve `{ok, arquivos}` — a falha importa: sem o manifesto, o painel do
 * admin não pode dizer "este arquivo não existe", e oferecer um campo livre ali
 * seria convidar o cadastro que quebra em silêncio.
 */
export async function arquivosDoRepo() {
  try {
    const r = await fetch(`${PASTA}/index.json`, { cache: 'no-cache' });
    if (!r.ok) return { ok: false, arquivos: [] };
    const m = await r.json();
    return { ok: true, arquivos: Array.isArray(m?.arquivos) ? m.arquivos : [] };
  } catch {
    return { ok: false, arquivos: [] };
  }
}

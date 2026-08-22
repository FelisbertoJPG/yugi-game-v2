/**
 * **Ícones de perfil** — o catálogo, a posse e a escolha.
 *
 * Três coisas separadas no banco (migration 0035), e a separação é o ponto:
 *
 *     icones             o CATÁLOGO — que ícones existem, quanto custam
 *     icones_do_jogador  a POSSE    — quem tem cada um
 *     perfis.icone_id    a ESCOLHA  — qual está em uso agora
 *
 * **A imagem mora no BANCO**, na coluna `imagem`: uma `data:` URL de um PNG
 * 128×128 (~1 a 40 KB). Ela chega junto com a linha, então funciona no jogo
 * instalado, no `npm run dev` e para todo jogador — sem publicar Release.
 *
 * A versão anterior (0035) guardava só o nome de um arquivo em
 * `web/img/icones/`, que viajava no `game.zip`. A ideia tinha lógica — arte é
 * conteúdo do repositório, como os tabuleiros — e um custo que só apareceu no
 * uso: a rota que grava o PNG só existe no dev-server, porque o jogo instalado
 * serve `%LOCALAPPDATA%`, que nenhum Release lê. Para quem roda o `.exe`, que é
 * como o jogo é usado, subir um ícone virava "mova o arquivo à mão e publique
 * um Release" — **por ícone**. Na prática, era impossível.
 *
 * Quem decide o que você pode usar é o SERVIDOR (`escolher_icone` mais o
 * gatilho `perfis_icone_valido`, 0036). Esta camada só desenha e pede — uma
 * trava que vive só aqui é uma trava que não existe.
 */
import { req } from './supabase.js';

/**
 * O ícone de quem ainda não escolheu — e o de quem escolheu um que foi apagado
 * do catálogo (`on delete set null`).
 *
 * É o ícone do próprio jogo, que está no repositório desde sempre: um padrão
 * que dependesse de conteúdo publicado poderia sumir, e aí a home nasceria com
 * um quadrado vazio no lugar do avatar.
 */
export const PADRAO = '/web/img/icone.png';

/** O formato que a coluna `imagem` aceita — o MESMO `check` da 0039. */
const IMAGEM = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/**
 * O `src` da imagem de um ícone. Sem imagem, ou com lixo no lugar dela, cai no
 * padrão — nunca num `src` que o navegador busca, não acha e desenha como
 * quadrado vazio.
 *
 * Aceita a linha inteira (`{imagem}`) ou a data URL solta, porque os dois
 * formatos circulam: a tela de escolha tem a linha, e a lista de amigos recebe
 * só o `icone_id` e resolve pelo mapa.
 */
export function caminhoDoIcone(icone) {
  const url = typeof icone === 'string' ? icone : icone?.imagem;
  return url && IMAGEM.test(url) ? url : PADRAO;
}

/**
 * Mapa `id → imagem` a partir do catálogo.
 *
 * Existe porque `meus_amigos()` devolve o `icone_id` de cada amigo, mas não a
 * arte — e não poderia: a policy de `perfis` só deixa cada um ver o próprio
 * registro, então a lateral cruza o id com o catálogo, que é de leitura aberta.
 */
export function mapaDeArquivos(catalogo) {
  const m = new Map();
  for (const i of Array.isArray(catalogo) ? catalogo : []) {
    if (i?.id && i?.imagem) m.set(String(i.id), String(i.imagem));
  }
  return m;
}

/**
 * O id que o admin digitou, em forma de slug — o mesmo formato que o `check` da
 * coluna exige (`^[a-z0-9][a-z0-9-]{0,31}$`).
 *
 * Gerar o slug aqui, e não deixar digitar livre, evita o erro que o Postgres só
 * reporta na hora de salvar, com a mensagem dele: um `check constraint
 * violation` no meio de um cadastro é uma recusa que não explica o que fazer.
 */
export function slug(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')     // tira os acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');                                 // o corte pode deixar traço no fim
}

/**
 * Quais ícones do catálogo estão **sem arte**.
 *
 * Com a imagem no banco isso deixou de ser uma divergência entre duas fontes e
 * virou uma linha incompleta — mas continua sendo o mesmo estrago na tela de
 * quem joga (um círculo com o ícone genérico onde deveria haver arte), então
 * continua valendo a pena apontar.
 */
export function semImagem(catalogo) {
  return (Array.isArray(catalogo) ? catalogo : [])
    .filter((i) => i && typeof i === 'object' && !IMAGEM.test(i.imagem ?? ''));
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

/**
 * O catálogo cru, sem posse — leitura aberta, serve para a vitrine e o admin.
 *
 * `comArte: false` deixa a imagem de fora, e não é micro-otimização: a home
 * carrega o catálogo no boot só para cruzar o `icone_id` dos amigos, e trazer
 * 40 KB por ícone para descartar quase todos seria pagar a coleção inteira a
 * cada abertura da tela.
 */
export async function catalogo({ comArte = true } = {}) {
  const campos = comArte ? '*' : 'id,nome,preco,raridade,gratuito,na_loja,ordem';
  const r = await req(`icones?select=${campos}&order=ordem,nome`);
  return r.ok && Array.isArray(r.dados) ? r.dados : [];
}

/**
 * As artes de um punhado de ícones: `Map<id, imagem>`.
 *
 * É o par de `catalogo({comArte:false})` — a home descobre de quais ícones
 * precisa (o seu mais o dos amigos online) e busca só esses.
 */
export async function artesDe(ids) {
  const limpos = [...new Set((ids ?? []).filter(Boolean).map(String))];
  if (!limpos.length) return new Map();
  const lista = limpos.map((i) => `"${i.replace(/"/g, '')}"`).join(',');
  const r = await req(`icones?select=id,imagem&id=in.(${encodeURIComponent(lista)})`);
  return mapaDeArquivos(r.ok && Array.isArray(r.dados) ? r.dados : []);
}

/**
 * Cadastra ou atualiza um ícone, COM a arte. Só admin — a RLS recusa o resto, e
 * a mensagem dela é repassada porque foi escrita para ser lida.
 *
 * A imagem vai no mesmo `upsert` que o resto: separá-la em duas chamadas
 * deixaria a linha existir sem arte no intervalo entre elas, e para sempre se a
 * segunda falhasse.
 */
export async function salvarIcone(icone) {
  const corpo = {
    id: icone.id,
    nome: icone.nome,
    preco: Number(icone.preco) || 0,
    raridade: icone.raridade || 'N',
    gratuito: !!icone.gratuito,
    na_loja: !!icone.na_loja,
    ordem: Number(icone.ordem) || 0,
  };
  // Só manda a imagem quando há uma nova. Mandar `null` ao editar só o preço
  // apagaria a arte de um ícone que já está no perfil de gente.
  if (icone.imagem) corpo.imagem = icone.imagem;

  const r = await req('icones?on_conflict=id', {
    method: 'POST',
    body: corpo,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (r.ok) return { ok: true, erro: null };

  const m = r.error ?? '';
  if (/row-level security/i.test(m)) return { ok: false, erro: 'só um admin pode cadastrar ícones' };
  if (/icones_imagem_tamanho/i.test(m)) return { ok: false, erro: 'a imagem ficou grande demais (o teto é 256 KB)' };
  if (/icones_imagem_e_imagem/i.test(m)) return { ok: false, erro: 'isso não é uma imagem' };
  if (/icones_id_check/i.test(m)) return { ok: false, erro: 'id inválido (só minúsculas, números e traço)' };
  return { ok: false, erro: m || 'não consegui salvar' };
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

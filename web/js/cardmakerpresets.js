/**
 * PRESETS do Card Maker — a carta-modelo que abre pronta no ygocarder.
 *
 * O Card Maker (`web/cardmaker.html`) embute o ygocarder num iframe. O que se
 * desenha lá (moldura, opacidades da full art, fundo, degradê na borda, estilo
 * do nome) não tinha como voltar numa próxima carta, e os dois caminhos que
 * existiam quebravam pelo MESMO motivo — as imagens que se sobe do computador
 * ficam DENTRO da carta, como data URL, e uma full art passa de 2 MB:
 *
 *   • a "última carta" que o ygocarder guarda tem uma reserva no localStorage,
 *     e quando ela estoura a cota ele grava a carta SEM as imagens
 *     (`saveCardLocally`, `use-card.ts`). O relato foi *"ele abre sem a
 *     edição"* — vinha sem a arte, sem o fundo e sem o degradê;
 *   • o "Save preset" dele (Blending) guarda só as partes da moldura, o foil e o
 *     Dye: nem a imagem do degradê, nem o modo da borda, nem a full art.
 *
 * A saída é a mesma que o próprio ygocarder usa para compartilhar uma carta: a
 * URL. Ele lê `?data=<carta>` no boot (`retrieveSavedCard`) e prefere isso ao
 * que tiver guardado. Então um preset é a carta EXPORTADA (o `.json` do formato
 * "Yugioh Carder") com cada imagem embutida trocada por um LINK — a tela sobe a
 * imagem para o bucket público `cardmaker` (migration 0061) —, e abrir é só
 * apontar o iframe para a URL com ela.
 *
 * Sem DOM e sem `fetch` próprio, para o teste rodar em Node: quem fala com a
 * rede recebe o `fetch` de fora.
 */

/** A chave em `conteudo` (e o `store/cardmaker-presets.json`). Ela PRECISA estar
 *  na `conteudo_chave_check` — senão o banco recusa toda gravação e a edição
 *  fica presa na fila de pendências para sempre (foi o que houve com `cena-*`,
 *  migration 0057). O teste lê a migration e cobra. */
export const CHAVE = 'cardmaker-presets';

/** O bucket público das imagens (migration 0061). */
export const BUCKET = 'cardmaker';

/**
 * As imagens que o ygocarder sabe embutir, pelos nomes CURTOS do `.json` que
 * ele exporta (o mapa é `currentCardFieldShortenMap`, em `src/util/codec.ts` do
 * ygocarder). Cada uma tem três campos: o LINK (fonte online), o DADO (a data URL
 * da fonte offline) e a FONTE, que diz qual dos dois vale.
 *
 * Ler só o dado, sem olhar a fonte, erraria calado: a carta exportada guarda os
 * dois, e uma imagem com fonte `online` e um dado velho esquecido seria subida
 * e posta no lugar do link que estava valendo.
 */
export const IMAGENS = [
  { nome: 'arte',     link: 'ar',   dado: 'ad',    fonte: 'as' },
  { nome: 'fundo',    link: 'bg',   dado: 'bgd',   fonte: 'bgs' },
  { nome: 'borda',    link: 'ovg',  dado: 'ovgd',  fonte: 'ovgs' },   // a sobreposição (o degradê)
  { nome: 'icone',    link: 'sivg', dado: 'sivgd', fonte: 'sivgs' },
  { nome: 'atributo', link: 'atg',  dado: 'atgd',  fonte: 'ats' },
];

/**
 * O teto da carta na URL. É o MESMO que o ygocarder usa para decidir se põe a
 * carta na própria URL (`maxDataLength = 8192`, `use-card-export.ts`) — acima
 * disso ele mesmo desiste, então é até onde se sabe que o GitHub Pages serve.
 */
export const LIMITE_URL = 8192;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ehImagemEmbutida = (v) => typeof v === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(v);

/**
 * Lê o `.json` exportado pelo ygocarder.
 *
 * Só o formato "Yugioh Carder" serve. O "YGOPro / DuelingNexus / NeoCardMaker"
 * (`version`, `image`, `layout`…) leva só a arte e os números — nada da
 * moldura —, e aceitá-lo produziria um preset que abre uma carta padrão, sem
 * erro nenhum. A forma compacta é a que `checkCompactYgoCarderCard` reconhece.
 *
 * @returns {{ok: true, carta: object} | {ok: false, erro: string}}
 */
export function lerCartaDoCardmaker(texto) {
  let dado;
  try { dado = JSON.parse(texto); } catch { return { ok: false, erro: 'o arquivo não é um .json válido' }; }
  if (!ehObjeto(dado)) return { ok: false, erro: 'o arquivo não é uma carta do card maker' };
  if ('ife' in dado && 'ta' in dado && 'si' in dado) return { ok: true, carta: dado };
  if ('layout' in dado && 'image' in dado) {
    return {
      ok: false,
      erro: 'esse .json é do formato "YGOPro / DuelingNexus / NeoCardMaker", que não leva a moldura —'
        + ' no card maker, exporte escolhendo "Yugioh Carder"',
    };
  }
  return { ok: false, erro: 'o arquivo não é uma carta exportada pelo card maker (formato "Yugioh Carder")' };
}

/**
 * As imagens embutidas que o preset precisa subir.
 *
 * A ARTE fica de fora por padrão: ela é o que muda de uma carta para outra, e o
 * preset existe para guardar o que NÃO muda. Ela vem quando pedida (`comArte`).
 *
 * @returns {{nome: string, dataUrl: string}[]}
 */
export function imagensEmbutidas(carta, { comArte = false } = {}) {
  const lista = [];
  for (const im of IMAGENS) {
    if (im.nome === 'arte' && !comArte) continue;
    if (carta[im.fonte] !== 'offline') continue;
    if (!ehImagemEmbutida(carta[im.dado])) continue;
    lista.push({ nome: im.nome, dataUrl: carta[im.dado] });
  }
  return lista;
}

/**
 * Monta o preset: a carta com cada imagem embutida trocada pelo link dela.
 *
 * Todo campo de DADO sai vazio, sempre — inclusive o de uma fonte offline que
 * não tinha imagem. Um só que sobrasse cheio levaria megabytes para a URL e o
 * preset simplesmente não abriria. Sem a arte, ela fica vazia e com fonte
 * `online`: com fonte `offline`, o ygocarder completaria com a arte da ÚLTIMA
 * carta guardada no navegador (`retrieveSavedCard`), e o modelo abriria com o
 * monstro de outra carta.
 *
 * Não mexe na carta recebida.
 *
 * @param {Record<string, string>} links `nome da imagem -> URL pública`
 */
export function montarPreset(carta, links = {}, { comArte = false } = {}) {
  const preset = structuredClone(carta);
  for (const im of IMAGENS) {
    if (im.nome === 'arte' && !comArte) {
      preset[im.link] = '';
      preset[im.fonte] = 'online';
    } else if (links[im.nome]) {
      preset[im.link] = links[im.nome];
      preset[im.fonte] = 'online';
    }
    if (im.dado in preset) preset[im.dado] = '';
  }
  return preset;
}

/** `true` se sobrou alguma imagem embutida em qualquer canto do objeto. */
export function temImagemEmbutida(v) {
  if (typeof v === 'string') return v.startsWith('data:');
  if (Array.isArray(v)) return v.some(temImagemEmbutida);
  if (ehObjeto(v)) return Object.values(v).some(temImagemEmbutida);
  return false;
}

/**
 * A URL que abre o ygocarder com o preset carregado.
 *
 * `encodeURIComponent`, e não `URLSearchParams`, porque o lado de lá lê com
 * `URLSearchParams.get('data')`, que transforma `+` em ESPAÇO: um nome de carta
 * com "+" (ou um degradê `#ff0000`, ou um `&` no texto) chegaria trocado.
 *
 * @returns {{ok: true, url: string, tamanho: number} | {ok: false, erro: string, tamanho: number}}
 */
export function urlDoPreset(base, carta) {
  const dado = JSON.stringify(carta);
  if (temImagemEmbutida(carta)) {
    return { ok: false, tamanho: dado.length, erro: 'o preset ainda tem imagem embutida — ela não cabe na URL' };
  }
  if (dado.length > LIMITE_URL) {
    return {
      ok: false,
      tamanho: dado.length,
      erro: `o preset tem ${dado.length} caracteres e o card maker só abre até ${LIMITE_URL} pela URL`,
    };
  }
  const sep = base.includes('?') ? '&' : '?';
  return { ok: true, tamanho: dado.length, url: `${base}${sep}data=${encodeURIComponent(dado)}` };
}

// ------------------------------------------------------------------ a lista

/** Lê o que veio do banco/disco tolerando qualquer forma — nunca lança. */
export function normalizarPresets(dados) {
  const lista = Array.isArray(dados?.presets) ? dados.presets : [];
  return lista.filter((p) => ehObjeto(p)
    && typeof p.id === 'string' && p.id
    && typeof p.nome === 'string' && p.nome.trim()
    && ehObjeto(p.carta));
}

const mesmoNome = (a, b) => a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');

/**
 * Acrescenta o preset — ou SUBSTITUI o que tiver o mesmo nome (sem diferenciar
 * maiúsculas), no mesmo lugar da lista. Salvar de novo com o nome de antes é
 * o jeito de atualizar um modelo; dois "Full Art" quase iguais numa lista
 * seriam o modelo velho esperando ser aberto por engano.
 */
export function comPreset(lista, preset) {
  const i = lista.findIndex((p) => mesmoNome(p.nome, preset.nome));
  if (i < 0) return [...lista, preset];
  const nova = [...lista];
  nova[i] = { ...preset, id: lista[i].id };
  return nova;
}

export const semPreset = (lista, id) => lista.filter((p) => p.id !== id);

// ------------------------------------------------------------------ imagens

/** `data:image/png;base64,...` → `{ mime, bytes }`, ou `null`. */
export function bytesDaImagem(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(dataUrl ?? '');
  if (!m) return null;
  try {
    const bin = atob(m[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1].toLowerCase(), bytes };
  } catch {
    return null;
  }
}

const EXTENSAO = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** SHA-256 em hexadecimal — é o nome do arquivo no bucket. */
export async function hashDosBytes(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sobe UMA imagem para o bucket e devolve o link público dela.
 *
 * O nome é o hash do conteúdo, então subir a mesma imagem de novo é pedir o
 * mesmo objeto: o Storage responde "já existe" (409, ou 400 com "Duplicate" nas
 * versões que embrulham o código), e isso é SUCESSO — o link é o mesmo. Tratar
 * como erro faria o segundo preset com o mesmo degradê nunca salvar.
 *
 * @returns {Promise<{ok: true, url: string} | {ok: false, erro: string}>}
 */
export async function subirImagem(dataUrl, { supabaseUrl, chave, token, fetch: buscar }) {
  const img = bytesDaImagem(dataUrl);
  if (!img) return { ok: false, erro: 'imagem embutida ilegível' };
  const ext = EXTENSAO[img.mime];
  if (!ext) return { ok: false, erro: `tipo de imagem não aceito: ${img.mime}` };
  if (!token) return { ok: false, erro: 'sem sessão — entre de novo para salvar presets' };

  const caminho = `${await hashDosBytes(img.bytes)}.${ext}`;
  const publica = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${caminho}`;
  let r;
  try {
    r = await buscar(`${supabaseUrl}/storage/v1/object/${BUCKET}/${caminho}`, {
      method: 'POST',
      headers: {
        apikey: chave,
        authorization: `Bearer ${token}`,
        'content-type': img.mime,
        'cache-control': '31536000',   // o conteúdo nunca muda: o nome é o hash dele
        'x-upsert': 'false',
      },
      body: img.bytes,
    });
  } catch {
    return { ok: false, erro: 'sem conexão com o Supabase' };
  }
  if (r.ok) return { ok: true, url: publica };

  let texto = '';
  try { texto = await r.text(); } catch { /* corpo ilegível: decide pelo status */ }
  if (r.status === 409 || /duplicate|already exists/i.test(texto)) return { ok: true, url: publica };
  if (/bucket not found/i.test(texto)) {
    return { ok: false, erro: 'o bucket "cardmaker" não existe — falta aplicar a migration 0061 no Supabase' };
  }
  if (r.status === 401 || r.status === 403 || /row-level security|unauthorized/i.test(texto)) {
    return { ok: false, erro: 'o Supabase recusou o upload (só admin sobe imagem de preset)' };
  }
  return { ok: false, erro: `o Supabase recusou o upload (HTTP ${r.status})` };
}

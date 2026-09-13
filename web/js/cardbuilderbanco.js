/**
 * **Onde as cartas do Card Builder moram**: a tabela `cartas_custom`
 * (migrations 0058 e 0059) — leitura aberta, escrita só de admin (`eh_admin()`).
 *
 * Separado de `cardbuilder.js` para aquele continuar sem rede e rodar em Node.
 *
 * O `lua` é gravado JUNTO com os `dados`, na mesma chamada, sempre regenerado
 * por `gerarLua` — nunca aceito de fora. Gravar os dois em chamadas separadas
 * deixaria a linha com o Lua de uma versão e os dados de outra, e quem lê o Lua
 * (o motor) rodaria uma carta que o editor não mostra.
 *
 * Duas imagens, cada uma na sua coluna: `arte` (a ilustração crua, que o layout
 * desenhado e a moldura usam) e `imagem` (a MOLDURA importada, ou a CARTA
 * COMPLETA importada — `dados.visual` diz qual).
 */
import { req } from './supabase.js';
import { ID_MIN, ID_MAX, normalizarCarta, gerarLua, problemasDaCarta } from './cardbuilder.js';

const FORMATO = /^data:image\//;
export const TETO_DA_ARTE = 256 * 1024;
export const TETO_DA_IMAGEM = 384 * 1024;

/** A mesma mensagem que o banco daria, só que em português e dizendo o que fazer. */
function traduzir(m) {
  const t = String(m ?? '');
  if (/row-level security/i.test(t)) return 'só um admin pode salvar cartas';
  if (/cartas_custom_arte_tamanho/i.test(t)) return 'a arte ficou grande demais (o teto é 256 KB)';
  if (/cartas_custom_imagem_tamanho/i.test(t)) return 'a imagem importada ficou grande demais (o teto é 384 KB)';
  if (/cartas_custom_(arte_check|imagem_formato)/i.test(t)) return 'isso não é uma imagem';
  if (/imagem/i.test(t) && /column|coluna|schema cache/i.test(t)) {
    return 'a coluna `imagem` não existe no banco — falta aplicar a migration 0059';
  }
  if (/cartas_custom|relation|schema cache/i.test(t) && /not exist|could not find|não existe/i.test(t)) {
    return 'a tabela cartas_custom não existe no banco — falta aplicar a migration 0058';
  }
  return t || 'não consegui salvar';
}

/** A linha do banco de volta em carta (com o id dela). */
export const cartaDaLinha = (linha) => normalizarCarta({ ...(linha?.dados ?? {}), id: Number(linha?.id) });

/**
 * O que falta de IMAGEM para o visual escolhido. Mora aqui e não no modelo
 * porque a imagem não é parte dos `dados`: quem sabe se ela existe é a tela
 * (a nova, escolhida agora) e o banco (a que já foi salva).
 */
export function problemasDeImagem(bruta, temImagem) {
  const c = normalizarCarta(bruta);
  if (temImagem) return [];
  if (c.visual === 'completa') return ['importe a imagem da carta completa'];
  if (c.visual === 'moldura') return ['importe a moldura'];
  return [];
}

/** As cartas cadastradas. `comArte: false` pula as colunas pesadas. */
export async function listarCartas({ comArte = true } = {}) {
  const campos = comArte ? 'id,nome,dados,arte,imagem,atualizado_em' : 'id,nome,dados,atualizado_em';
  const r = await req(`cartas_custom?select=${campos}&order=id.asc`);
  if (r.ok && Array.isArray(r.dados)) return { ok: true, cartas: r.dados, erro: null };
  return { ok: false, cartas: [], erro: traduzir(r.error) };
}

async function proximoId() {
  const r = await req('cartas_custom?select=id&order=id.desc&limit=1');
  if (!r.ok || !Array.isArray(r.dados)) return null;
  const maior = r.dados.length ? Number(r.dados[0].id) : ID_MIN;
  return maior + 1 <= ID_MAX ? maior + 1 : null;
}

function conferirImagem(src, teto, rotulo) {
  if (!src) return null;
  if (!FORMATO.test(src)) return `${rotulo}: isso não é uma imagem`;
  if (src.length > teto) return `${rotulo} ficou grande demais (o teto é ${Math.round(teto / 1024)} KB)`;
  return null;
}

/**
 * Cria ou atualiza. `arte` e `imagem` só vão quando o admin escolheu um arquivo
 * AGORA — mandar `null` ao corrigir um efeito apagaria a imagem de uma carta que
 * já existe (a mesma regra de `itens.js`). `temImagem` diz se já há uma imagem
 * salva, para o visual `moldura`/`completa` não ser recusado à toa na edição.
 *
 * @returns {Promise<{ok: boolean, id?: number, erro: string|null}>}
 */
export async function salvarCarta(bruta, { arte = null, imagem = null, temImagem = false } = {}) {
  const problemas = [
    ...problemasDaCarta(bruta).map((p) => p.texto),
    ...problemasDeImagem(bruta, temImagem || !!imagem),
  ];
  if (problemas.length) return { ok: false, erro: problemas[0] };

  const erroDeImagem = conferirImagem(arte, TETO_DA_ARTE, 'a arte')
    ?? conferirImagem(imagem, TETO_DA_IMAGEM, 'a imagem importada');
  if (erroDeImagem) return { ok: false, erro: erroDeImagem };

  const carta = normalizarCarta(bruta);
  const dados = { ...carta };
  delete dados.id;                       // o id é a chave da linha, não parte do documento
  const linha = { nome: carta.nome, dados, lua: gerarLua(carta) };
  if (arte) linha.arte = arte;
  if (imagem) linha.imagem = imagem;

  if (carta.id) {
    const r = await req(`cartas_custom?id=eq.${carta.id}`, {
      method: 'PATCH', body: linha, prefer: 'return=representation',
    });
    if (!r.ok) return { ok: false, erro: traduzir(r.error) };
    // A RLS não dá erro para quem não pode: ela filtra, e o PATCH "atualiza"
    // zero linhas. Sem esta conferência a tela diria "salvo".
    if (!Array.isArray(r.dados) || !r.dados.length) {
      return { ok: false, erro: 'nada foi atualizado — a carta foi apagada, ou esta conta não é admin' };
    }
    return { ok: true, id: carta.id, erro: null };
  }

  // Carta NOVA é INSERT puro, nunca upsert: dois admins salvando juntos pegam o
  // mesmo "próximo id", e um upsert faria o segundo sobrescrever a carta do
  // primeiro em silêncio. Com insert, o segundo leva 409 e tenta o seguinte.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const id = await proximoId();
    if (!id) return { ok: false, erro: 'não consegui ler o banco para escolher o id da carta' };
    const r = await req('cartas_custom', { method: 'POST', body: { id, ...linha }, prefer: 'return=minimal' });
    if (r.ok) return { ok: true, id, erro: null };
    if (r.status !== 409) return { ok: false, erro: traduzir(r.error) };
  }
  return { ok: false, erro: 'outro admin está salvando cartas agora — tente de novo' };
}

export async function apagarCarta(id) {
  const r = await req(`cartas_custom?id=eq.${Number(id)}`, { method: 'DELETE', prefer: 'return=representation' });
  if (!r.ok) return { ok: false, erro: traduzir(r.error) };
  if (!Array.isArray(r.dados) || !r.dados.length) return { ok: false, erro: 'nada foi apagado' };
  return { ok: true, erro: null };
}

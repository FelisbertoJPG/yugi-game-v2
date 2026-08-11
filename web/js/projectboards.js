/**
 * Tabuleiros — conteúdo do jogo, não preferência de navegador.
 *
 * Moram em TRÊS lugares, e cada um resolve um problema diferente:
 *
 *   1. **Supabase (`tabuleiros`)** — a verdade viva. É o que faz um tabuleiro
 *      criado no editor chegar em quem joga sem publicar Release nenhum.
 *      Leitura aberta (a tela de duelo carrega antes de qualquer login);
 *      escrita só de admin (RLS `eh_admin()`).
 *   2. **`boards/*.json` no disco** — a cópia versionada no git, e o caminho
 *      OFFLINE. Viaja dentro do `game.zip` desde 11/08/2026; antes disso o
 *      jogo instalado não tinha a pasta e o duelo caía no layout padrão.
 *   3. **download do arquivo** — último recurso, quando não há servidor local
 *      para gravar.
 *
 * A ordem de LEITURA é banco → disco: quem tem o dado mais novo ganha, e sem
 * rede o jogo continua abrindo com o que veio no pacote. A ESCRITA vai nos
 * dois, porque o disco é o que o git versiona e o banco é o que distribui.
 */
import { req, cabecalhoAuth } from './supabase.js';

const API = '/__boards';

/** Nome de arquivo seguro: "Modo Rush!" -> "modo_rush.json" */
export function slugify(name, fallback = 'tabuleiro') {
  const s = String(name ?? '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${s || fallback}.json`;
}

let serverOk = null;

/** O servidor de desenvolvimento está no ar e aceita gravar? */
export async function canWrite() {
  if (serverOk !== null) return serverOk;
  try {
    const r = await fetch(`${API}/list`);
    serverOk = r.ok;
  } catch {
    serverOk = false;
  }
  return serverOk;
}

/**
 * Lê todos os tabuleiros: banco primeiro, disco como queda.
 *
 * Os dois são unidos pelo NOME do arquivo, e o do banco vence — é ele que
 * recebe a edição feita em outra máquina. Um tabuleiro que só existe no disco
 * (criado offline, ou ainda não publicado) continua aparecendo; some da lista
 * seria pior que aparecer duas vezes.
 *
 * @returns {Promise<Array<{path, board, deOnde: 'banco'|'disco'}>>}
 */
export async function listProjectBoards() {
  const porNome = new Map();

  // 1. disco (também é quem define `serverOk`, usado pelo editor)
  try {
    const r = await fetch(`${API}/list`);
    if (!r.ok) throw new Error(String(r.status));
    const { boards = [] } = await r.json();
    serverOk = true;
    for (const { path, content } of boards) {
      try { porNome.set(path, { path, board: JSON.parse(content), deOnde: 'disco' }); }
      catch { /* JSON quebrado no disco: ignora esse, não derruba a lista */ }
    }
  } catch {
    serverOk = false;
  }

  // 2. banco por cima — publicado ganha do que está no disco desta máquina
  const remoto = await req('tabuleiros?select=nome,dados');
  if (remoto.ok && Array.isArray(remoto.dados)) {
    for (const linha of remoto.dados) {
      if (linha?.nome && linha.dados) {
        porNome.set(linha.nome, { path: linha.nome, board: linha.dados, deOnde: 'banco' });
      }
    }
  }

  return [...porNome.values()].filter((b) => b.board);
}

/**
 * Grava um tabuleiro no projeto. Se o servidor não estiver disponível, baixa
 * o arquivo para você colocar em `boards/` na mão.
 * @param {{keepalive?: boolean}} [opts] `keepalive: true` pro flush de saída
 *   da página (`beforeunload`/`visibilitychange`) — sem isso o navegador
 *   cancela o fetch no meio do descarregamento.
 * @returns {Promise<{ok: boolean, path?: string, downloaded?: boolean, error?: string}>}
 */
export async function saveProjectBoard(path, board, opts = {}) {
  const content = JSON.stringify(board, null, 2);

  // 1. BANCO — é o que sai desta máquina. Só passa para admin (a RLS recusa o
  //    resto com 403), e a falha aqui não impede a gravação no disco: editar
  //    tabuleiro sem sessão continua valendo localmente.
  const remoto = await publicarNoBanco(path, board);

  // 2. DISCO — a cópia que o git versiona e que viaja no game.zip.
  try {
    const r = await fetch(`${API}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
      keepalive: !!opts.keepalive,
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
    serverOk = true;
    return { ok: true, path: j.path, publicado: remoto.ok, erroRemoto: remoto.error };
  } catch (e) {
    serverOk = false;
    // Publicou no banco mas não achou o disco: o tabuleiro NÃO está perdido —
    // ele já chega em quem joga. Baixar por cima disso só confundiria.
    if (remoto.ok) return { ok: true, path, publicado: true, semDisco: true };
    download(path, content);
    return { ok: false, downloaded: true, error: String(e.message ?? e) };
  }
}

/** Upsert em `tabuleiros`. Sem sessão de admin devolve `{ok:false}` e segue a vida. */
async function publicarNoBanco(path, board) {
  const cabecalho = await cabecalhoAuth();
  if (!cabecalho.authorization) return { ok: false, error: 'sem sessão' };

  const r = await req('tabuleiros?on_conflict=nome', {
    method: 'POST',
    body: { nome: path, dados: board },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (r.ok) return { ok: true };
  return {
    ok: false,
    error: /row-level security|permission/i.test(r.error ?? '')
      ? 'só um admin publica tabuleiro'
      : (r.error || 'não consegui publicar'),
  };
}

export async function deleteProjectBoard(path) {
  // Apaga nos dois: deixar a linha no banco faria o tabuleiro "ressuscitar" na
  // próxima leitura, já que o banco vence o disco.
  const remoto = await req(`tabuleiros?nome=eq.${encodeURIComponent(path)}`, { method: 'DELETE' });
  try {
    const r = await fetch(`${API}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok, error: j.error, apagadoNoBanco: remoto.ok };
  } catch (e) {
    return { ok: remoto.ok, error: remoto.ok ? null : String(e.message ?? e) };
  }
}

function download(filename, content) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

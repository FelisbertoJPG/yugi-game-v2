/**
 * Tabuleiros guardados NO PROJETO (pasta `boards/`), não no navegador.
 *
 * Mesma razão que `projectdecks.js`: `localStorage` morre com a limpeza de
 * dados do navegador e não acompanha você para outra máquina, e um tabuleiro
 * é conteúdo do jogo — precisa viajar no git junto com o código.
 *
 * Escrever no disco depende do servidor de desenvolvimento (`npm run dev`,
 * que expõe `/__boards/*` só para localhost). Se ele não estiver no ar, a
 * leitura ainda funciona via HTTP estático (fetch direto em `/boards/`, se
 * algum dia servido assim) e a gravação cai para download do arquivo.
 */

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
 * Lê todos os tabuleiros do projeto.
 * @returns {Promise<Array<{path, board}>>}
 */
export async function listProjectBoards() {
  try {
    const r = await fetch(`${API}/list`);
    if (!r.ok) throw new Error(String(r.status));
    const { boards = [] } = await r.json();
    serverOk = true;
    return boards.map(({ path, content }) => {
      try { return { path, board: JSON.parse(content) }; }
      catch { return { path, board: null }; }
    }).filter((b) => b.board);
  } catch {
    serverOk = false;
    return [];
  }
}

/**
 * Grava um tabuleiro no projeto. Se o servidor não estiver disponível, baixa
 * o arquivo para você colocar em `boards/` na mão.
 * @returns {Promise<{ok: boolean, path?: string, downloaded?: boolean, error?: string}>}
 */
export async function saveProjectBoard(path, board) {
  const content = JSON.stringify(board, null, 2);
  try {
    const r = await fetch(`${API}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
    serverOk = true;
    return { ok: true, path: j.path };
  } catch (e) {
    serverOk = false;
    download(path, content);
    return { ok: false, downloaded: true, error: String(e.message ?? e) };
  }
}

export async function deleteProjectBoard(path) {
  try {
    const r = await fetch(`${API}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const j = await r.json();
    return { ok: r.ok && j.ok, error: j.error };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
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

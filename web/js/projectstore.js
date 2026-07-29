/**
 * Ponte para a config versionada no projeto (store/*.json via o dev-server).
 *
 * O localStorage é a cópia de trabalho (rápida, síncrona, funciona offline), mas
 * ele NÃO viaja entre máquinas nem sobrevive a uma limpeza do navegador. Isto
 * espelha os dados em arquivos `store/<name>.json`, que vão no git — do mesmo
 * jeito que os decks vivem em `decks/`. Sem o dev-server no ar, tudo continua
 * funcionando só com o localStorage (o espelhamento é best-effort).
 *
 * Uso: no boot de cada página, `await pullFileEx(nome)` para trazer o arquivo do
 * disco; a cada gravação, `pushFile(nome, v)` para devolver (fire-and-forget).
 *
 * Quem chama deve só espelhar DEPOIS de ter lido — ver a trava em wallet.js e
 * boosters.js. Gravar antes de ler é como um estado vazio sobrescreve dados bons.
 */

/**
 * Lê `store/<name>.json` distinguindo os dois "vazios":
 *   { alcancou: true,  data: {...} }  arquivo existe
 *   { alcancou: true,  data: null  }  servidor respondeu, arquivo ainda não existe
 *   { alcancou: false, data: null }  não deu para falar com o servidor
 *
 * A diferença importa: sem servidor, gravar por cima é arriscado (o disco pode
 * ter dados que não conseguimos ler). Com servidor e sem arquivo, criar é o certo.
 */
export async function pullFileEx(name) {
  try {
    const r = await fetch(`/__store/${name}.json`, { cache: 'no-store' });
    if (r.status === 404) return { alcancou: true, data: null };
    if (!r.ok) return { alcancou: false, data: null };
    return { alcancou: true, data: await r.json() };
  } catch {
    return { alcancou: false, data: null };
  }
}

/** Lê `store/<name>.json`. Devolve o objeto, ou null se não existe / sem server. */
export async function pullFile(name) {
  return (await pullFileEx(name)).data;
}

/** Grava `store/<name>.json` (fire-and-forget: falha silenciosa sem server). */
export function pushFile(name, data) {
  try {
    fetch(`/__store/${name}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {});
  } catch { /* sem servidor: só o localStorage guarda */ }
}

/**
 * Traz o arquivo do disco para uma chave do localStorage (se existir). Chame no
 * boot, ANTES de ler o estado. Não sobrescreve o localStorage quando o arquivo
 * não existe ainda (primeira vez), preservando o que já houver no navegador.
 */
export async function hydrate(name, storageKey) {
  const data = await pullFile(name);
  if (data === null || data === undefined) return false;
  try { localStorage.setItem(storageKey, JSON.stringify(data)); return true; }
  catch { return false; }
}

/**
 * Ponte para a config versionada no projeto (store/*.json via o dev-server).
 *
 * O localStorage é a cópia de trabalho (rápida, síncrona, funciona offline), mas
 * ele NÃO viaja entre máquinas nem sobrevive a uma limpeza do navegador. Isto
 * espelha os dados em arquivos `store/<name>.json`, que vão no git — do mesmo
 * jeito que os decks vivem em `decks/`. Sem o dev-server no ar, tudo continua
 * funcionando só com o localStorage (o espelhamento é best-effort).
 *
 * Uso: no boot de cada página, `await hydrate('boosters', KEY)` para trazer o
 * arquivo do disco para o localStorage; a cada gravação, `mirror('boosters', v)`
 * para devolver ao disco (fire-and-forget).
 */

/** Lê `store/<name>.json`. Devolve o objeto, ou null se não existe / sem server. */
export async function pullFile(name) {
  try {
    const r = await fetch(`/__store/${name}.json`, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
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

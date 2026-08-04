/**
 * Cliente da conta (login/registro/sessão).
 *
 * A sessão é um cookie httpOnly — o servidor manda no login/registro
 * (`Set-Cookie`) e o navegador já anexa sozinho em todo `fetch` same-origin
 * seguinte. Este módulo só fala com `/__auth/*`; ele NÃO sabe nada sobre
 * wallet/decks — essas camadas (`wallet.js`, `storage.js`) continuam iguais,
 * porque o servidor já resolve "de quem é esse arquivo" pela sessão.
 */

const API = '/__auth';

async function post(action, body) {
  try {
    const r = await fetch(`${API}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok, username: j.username, error: j.error };
  } catch (e) {
    return { ok: false, error: 'sem servidor de desenvolvimento no ar' };
  }
}

export const register = (username, password) => post('register', { username, password });
export const login = (username, password) => post('login', { username, password });
export const logout = () => post('logout');

/** Quem está logado agora, ou null. Nunca lança — 401 é resposta normal. */
export async function me() {
  try {
    const r = await fetch(`${API}/me`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j.ok ? j.username : null;
  } catch {
    return null;
  }
}

/**
 * Chame no boot de toda página que mexe em dado de conta (wallet/decks).
 * Sem sessão, manda pro login e devolve null — quem chamou deve parar ali
 * (a página real só continua depois do redirect, então `null` nunca chega a
 * importar de verdade, mas o caller não precisa saber disso).
 *
 * NÃO leva junto de onde veio: entrar sempre termina na home. Voltar pra
 * página de origem soava útil, mas na prática significava cair direto no
 * Treino (`duel.html` sem `?npc=`) só porque foi ali que a sessão faltou —
 * quem acabou de entrar quer o menu, não a tela em que esbarrou no login.
 */
export async function requireLogin() {
  const username = await me();
  if (username) return username;
  location.href = '/web/login.html';
  return null;
}

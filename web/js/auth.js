/**
 * Cliente da conta (login/registro/sessão) — agora sobre o Supabase.
 *
 * A identidade do jogador passou a ser o `auth.users` do Supabase; o login
 * local (PBKDF2 + cookie httpOnly em `/__auth/*`) foi aposentado. Motivo: as
 * policies de RLS são `usuario_id = auth.uid()`, então só uma sessão REAL do
 * jogador destrava a carteira e os decks dele — um servidor intermediário só
 * conseguiria isso com a chave `service_role`, que não pode existir no cliente.
 *
 * A INTERFACE DESTE MÓDULO NÃO MUDOU de propósito (`me`, `requireLogin`,
 * `logout`): `index`, `loja`, `deck`, `inventario`, `adversario` e `duel`
 * chamam `requireLogin()` no boot e não precisam saber que a fundação trocou.
 * O que mudou foi `register`/`login`, que agora pedem e-mail — e o único
 * chamador dos dois é `login.html`.
 *
 * OFFLINE: `me()` responde pela sessão guardada, sem rede. Quem já entrou uma
 * vez continua abrindo o jogo sem internet (ver `supabase.js`).
 */

import {
  cadastrar, entrar, sair, sessao, req,
  recuperarSenha, sessaoDoHash, trocarSenha, contaAtual,
} from '/web/js/supabase.js';

/** Cria a conta. `usuario` é o nome no jogo; o e-mail é a credencial. */
export async function register(email, password, usuario) {
  const r = await cadastrar(email, password, usuario);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.precisaConfirmar) {
    return { ok: true, precisaConfirmar: true, error: null };
  }
  return { ok: true, username: await me() };
}

export async function login(email, password) {
  const r = await entrar(email, password);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, username: await me() };
}

export async function logout() {
  await sair();
  return { ok: true };
}

export { recuperarSenha, sessaoDoHash, trocarSenha, contaAtual };

const PAGINA_RECUPERAR = '/web/recuperar.html';

/**
 * Manda para a tela de recuperação quem chegou com um link de recuperação na
 * mão, seja qual for a página em que caiu.
 *
 * Por que não basta apontar o `redirect_to`: o Supabase só honra endereços que
 * estejam na lista de URLs permitidas do projeto; fora dela, ele ignora o que
 * pedimos e joga na Site URL. Foi o que aconteceu — o `/verify` respondeu 303 e
 * autenticou, mas o navegador foi parar na entrada, e a pessoa ficou olhando um
 * formulário de login com uma senha que não lembra.
 *
 * O fragmento sobrevive a redirect no navegador, então o token chega inteiro
 * onde quer que a Site URL aponte. Chamar isto ANTES de qualquer `requireLogin`
 * é o que importa: o redirect para o login descartaria o hash e o link morreria
 * ali.
 *
 * @returns {boolean} `true` se desviou (quem chamou deve parar).
 */
export function desviarParaRecuperacao() {
  if (location.pathname.endsWith('recuperar.html')) return false;
  if (!/(^|[#&])type=recovery(&|$)/.test(location.hash)) return false;
  location.replace(PAGINA_RECUPERAR + location.hash);
  return true;
}

/**
 * Quem está logado agora, ou null. Nunca lança — sem sessão é resposta normal.
 *
 * O nome no jogo mora em `perfis.usuario` (o trigger `criar_perfil` o cria no
 * cadastro). Guardamos no blob da sessão depois da primeira consulta: é o que
 * faz o boot seguinte não depender de rede, e o que faz toda página que chama
 * `requireLogin()` custar zero requisição.
 */
export async function me() {
  const s = sessao();
  if (!s?.access_token) return null;
  if (s.usuario) return s.usuario;

  const id = s.user?.id;
  if (!id) return null;

  const r = await req(`perfis?select=usuario&id=eq.${encodeURIComponent(id)}`);
  if (!r.ok) {
    // Sem rede logo no primeiro boot depois do cadastro: ainda não sabemos o
    // nome, mas a sessão é válida. Cai no e-mail para a tela ter o que mostrar,
    // sem gravar isso como se fosse o nome definitivo.
    return s.user?.email ?? null;
  }

  const usuario = Array.isArray(r.dados) && r.dados[0]?.usuario;
  if (!usuario) return s.user?.email ?? null;

  try {
    localStorage.setItem('ygo:sb-session', JSON.stringify({ ...s, usuario }));
  } catch { /* sem cache: só custa uma consulta a cada boot */ }
  return usuario;
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

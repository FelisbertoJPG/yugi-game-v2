/**
 * Cliente Supabase mínimo — escrito à mão, sem dependência nenhuma.
 *
 * Por que não o `@supabase/supabase-js`: o front deste projeto tem ZERO
 * dependências e nenhum build step, e o jogo é distribuído como um `.exe` que
 * precisa abrir sem internet. Um `import` de CDN morreria justamente na máquina
 * do jogador empacotado; vendorizar o bundle traria ~50 kB e um segundo
 * mecanismo de atualização para manter. São seis endpoints REST — cabe aqui.
 *
 * O que este módulo faz:
 *   - guarda a sessão (access + refresh token) no localStorage;
 *   - renova o access token sozinho quando ele está por vencer;
 *   - expõe `req()` para falar com o PostgREST já autenticado.
 *
 * OFFLINE: se a renovação falhar por FALTA DE REDE, a sessão é preservada e o
 * jogador continua entrando. Só uma recusa explícita do servidor (400/401 —
 * token revogado, senha trocada) apaga a sessão. A diferença importa: tratar
 * "sem internet" como "sessão inválida" deslogaria todo mundo que abrisse o
 * jogo no avião.
 */

// A chave publishable é PÚBLICA por projeto (ver supabase/README.md): quem
// protege os dados é a RLS, não o segredo da chave. Pode viajar no exe, no
// front e no git. A chave `secret`/`service_role` NUNCA pode aparecer aqui.
export const SUPABASE_URL = 'https://shclhlbfkdnnqxboiuqc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_FxGEPSbXqJEBBUqG9ugJ6w_3z5AaVzC';

const CHAVE_SESSAO = 'ygo:sb-session';

/** Renova quando falta menos que isto para vencer (o token dura ~1h). */
const MARGEM_RENOVACAO_MS = 60_000;

// ---------------------------------------------------------------- sessão

/** `{access_token, refresh_token, expires_at, user, usuario}` ou null. */
export function sessao() {
  try {
    const cru = localStorage.getItem(CHAVE_SESSAO);
    return cru ? JSON.parse(cru) : null;
  } catch {
    return null;
  }
}

function guardar(s) {
  try {
    if (s) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
    else localStorage.removeItem(CHAVE_SESSAO);
  } catch { /* modo privativo/quota — a sessão só não sobrevive ao reload */ }
}

export function limparSessao() { guardar(null); }

/** Normaliza a resposta do GoTrue para o formato que guardamos. */
function daResposta(j, anterior) {
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    // `expires_in` vem em segundos a partir de agora.
    expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    user: j.user ?? anterior?.user ?? null,
    usuario: anterior?.usuario ?? null,
  };
}

// ------------------------------------------------------------------ HTTP

function urlAuth(caminho) { return `${SUPABASE_URL}/auth/v1/${caminho}`; }

/**
 * Erro de REDE (servidor inalcançável) — distinto de erro do servidor.
 * É a diferença entre "estou offline" e "minha sessão morreu".
 */
class SemRede extends Error {}

async function pedir(url, opts) {
  let r;
  try {
    r = await fetch(url, opts);
  } catch {
    throw new SemRede('sem conexao');
  }
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, corpo: j };
}

function mensagemDeErro(corpo, padrao) {
  return corpo?.msg || corpo?.message || corpo?.error_description
      || corpo?.error || corpo?.error_code || padrao;
}

// ------------------------------------------------------------- renovação

let renovando = null;

/**
 * Devolve um access token válido, renovando se preciso. Null se não há sessão.
 * Chamadas concorrentes compartilham a MESMA renovação — sem isso, três `fetch`
 * simultâneos no boot disparariam três refresh, e o GoTrue invalida o refresh
 * token a cada uso: os dois perdedores derrubariam a sessão recém-criada.
 */
export async function tokenValido() {
  const s = sessao();
  if (!s?.access_token) return null;
  if (Date.now() < s.expires_at - MARGEM_RENOVACAO_MS) return s.access_token;
  if (!s.refresh_token) return s.access_token;

  if (!renovando) renovando = renovar(s).finally(() => { renovando = null; });
  return renovando;
}

async function renovar(s) {
  let r;
  try {
    r = await pedir(urlAuth('token?grant_type=refresh_token'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
  } catch (e) {
    // Sem rede: segura a sessão como está. O token pode até estar vencido —
    // quem for usá-lo vai receber 401 do servidor e tratar lá. O que NÃO se faz
    // aqui é apagar a sessão de quem só está sem internet.
    if (e instanceof SemRede) return s.access_token;
    throw e;
  }

  if (!r.ok) {
    // Recusa explícita: o refresh token não vale mais. Aí sim, desloga.
    limparSessao();
    return null;
  }
  const nova = daResposta(r.corpo, s);
  guardar(nova);
  return nova.access_token;
}

// ------------------------------------------------------------------ auth

/**
 * Cria a conta. `usuario` viaja em `data` e o trigger `criar_perfil` (migration
 * 0001) o usa como base do nome no `perfis`, resolvendo colisão sozinho.
 *
 * Com confirmação de e-mail ligada (o padrão do projeto), o GoTrue responde SEM
 * sessão: o jogador precisa clicar no link antes de entrar. Sinalizamos isso em
 * `precisaConfirmar` para a tela poder explicar, em vez de parecer que o
 * cadastro falhou.
 */
export async function cadastrar(email, senha, usuario) {
  const r = await pedir(urlAuth('signup'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({ email, password: senha, data: { usuario } }),
  });

  if (!r.ok) return { ok: false, error: mensagemDeErro(r.corpo, 'nao consegui criar a conta') };

  if (r.corpo.access_token) {
    guardar(daResposta(r.corpo));
    return { ok: true, precisaConfirmar: false };
  }
  return { ok: true, precisaConfirmar: true };
}

export async function entrar(email, senha) {
  const r = await pedir(urlAuth('token?grant_type=password'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({ email, password: senha }),
  });

  if (!r.ok) return { ok: false, error: mensagemDeErro(r.corpo, 'e-mail ou senha invalidos') };
  guardar(daResposta(r.corpo));
  return { ok: true };
}

/**
 * Sai. Avisa o servidor quando dá, mas apaga a sessão local SEMPRE — inclusive
 * offline. "Sair" que não sai porque a rede caiu é pior que inútil num PC
 * compartilhado.
 */
export async function sair() {
  const s = sessao();
  if (s?.access_token) {
    try {
      await pedir(urlAuth('logout'), {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${s.access_token}` },
      });
    } catch { /* offline: some localmente do mesmo jeito */ }
  }
  limparSessao();
}

/**
 * Consome a sessão que o Supabase devolve no FRAGMENTO da URL.
 *
 * O link de confirmação/recuperação volta para o app como
 * `…/login.html#access_token=…&refresh_token=…&type=recovery`. Fragmento não
 * viaja para servidor nenhum (por isso o Supabase usa fragmento e não query),
 * então quem tem de lê-lo é esta página. Sem isto o link "funciona", a página
 * abre — e não acontece nada, que foi exatamente o sintoma.
 *
 * Limpa o hash depois de ler: token de sessão não tem por que ficar na barra de
 * endereço, no histórico do navegador e em todo `Referer` que a página mandar.
 *
 * @returns {'recovery'|'signup'|'sessao'|null} o `type` do link, ou null.
 */
export function sessaoDoHash() {
  const cru = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!cru) return null;

  const p = new URLSearchParams(cru);
  const access_token = p.get('access_token');
  const refresh_token = p.get('refresh_token');
  if (!access_token) return null;

  guardar({
    access_token,
    refresh_token,
    expires_at: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000,
    user: null,
    usuario: null,
  });

  history.replaceState(null, '', location.pathname + location.search);
  return p.get('type') || 'sessao';
}

/**
 * Dados da conta logada, direto do GoTrue. A sessão vinda de um link de
 * recuperação traz só os tokens — nem o e-mail —, então a tela precisa
 * perguntar quem é para poder mostrar.
 */
export async function contaAtual() {
  const token = await tokenValido();
  if (!token) return null;
  const r = await pedir(urlAuth('user'), {
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;

  // Guarda no blob da sessão: o resto do app espera `user` preenchido.
  const s = sessao();
  if (s) guardar({ ...s, user: r.corpo });
  return r.corpo;
}

/**
 * Troca a senha de quem está logado. Serve tanto para o fluxo de recuperação
 * (a sessão veio do link) quanto para "mudar minha senha" com a conta aberta —
 * é o mesmo endpoint, e nenhum dos dois precisa de SMTP.
 */
export async function trocarSenha(nova) {
  const token = await tokenValido();
  if (!token) return { ok: false, error: 'sessão expirada — peça o link de novo' };

  const r = await pedir(urlAuth('user'), {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password: nova }),
  });
  if (!r.ok) return { ok: false, error: mensagemDeErro(r.corpo, 'nao consegui trocar a senha') };
  return { ok: true };
}

/** Manda o e-mail de redefinição de senha. */
export async function recuperarSenha(email, redirect) {
  const r = await pedir(urlAuth('recover'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({ email, ...(redirect ? { redirect_to: redirect } : {}) }),
  });
  return r.ok ? { ok: true } : { ok: false, error: mensagemDeErro(r.corpo, 'nao consegui enviar o e-mail') };
}

// -------------------------------------------------------------- PostgREST

/**
 * Chamada autenticada ao PostgREST. `caminho` é relativo a `/rest/v1/`.
 *
 *   await req('perfis?select=usuario&id=eq.' + id)
 *   await req('carteiras', { method: 'POST', body: {...}, prefer: 'resolution=merge-duplicates' })
 *
 * Devolve `{ok, status, dados, error}` — nunca lança por status HTTP, porque
 * 401 e 406 são respostas normais aqui (sessão vencida, nenhuma linha).
 */
export async function req(caminho, { method = 'GET', body, prefer } = {}) {
  const token = await tokenValido();
  const headers = { apikey: SUPABASE_KEY };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.prefer = prefer;

  try {
    const r = await pedir(`${SUPABASE_URL}/rest/v1/${caminho}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      ok: r.ok,
      status: r.status,
      dados: r.corpo,
      error: r.ok ? null : mensagemDeErro(r.corpo, `HTTP ${r.status}`),
    };
  } catch (e) {
    if (e instanceof SemRede) return { ok: false, status: 0, dados: null, error: 'sem conexao' };
    throw e;
  }
}

/** `true` quando a última falha foi de rede, não de credencial. */
export const ehFalhaDeRede = (erro) => erro === 'sem conexao';

/**
 * O perfil (`{usuario, admin}`) de quem está logado, ou `null`.
 *
 * Filtra pelo PRÓPRIO id porque a policy de `perfis` deixa um admin ver todo
 * mundo — sem o filtro a primeira linha podia ser de outra conta. Isto é só
 * para a TELA saber o que mostrar; quem barra a escrita é a RLS, não isto.
 */
export async function perfilAtual() {
  const conta = await contaAtual();
  if (!conta?.id) return null;
  const r = await req(`perfis?select=usuario,admin&id=eq.${conta.id}`);
  if (!r.ok || !Array.isArray(r.dados) || !r.dados.length) return null;
  return { ...r.dados[0], email: conta.email };
}

/**
 * Cabeçalho de autorização para o SERVIDOR LOCAL (`/__store/*`, `/__decks/*`).
 *
 * O servidor local não tem mais sessão própria: ele valida este mesmo token do
 * Supabase pela chave pública (ES256/JWKS) e usa o `sub` para saber de quem é o
 * arquivo. Antes disto a sessão era um cookie que o `fetch` mandava sozinho —
 * agora precisa ser explícito, porque um Bearer não viaja de graça.
 *
 * Devolve `{}` quando não há sessão: as rotas de conteúdo global (banlist,
 * boosters, npcs) continuam abertas e não devem quebrar por falta de login.
 */
export async function cabecalhoAuth() {
  const t = await tokenValido();
  return t ? { authorization: `Bearer ${t}` } : {};
}

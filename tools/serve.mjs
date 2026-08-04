/**
 * Servidor estático da raiz do projeto — serve `web/` e `ygo-data/` juntos,
 * que é o que o front precisa para enxergar os dados.
 *
 * Zero dependências. Não é parte do produto: é andaime de desenvolvimento,
 * porque `fetch` não funciona em `file://`.
 *
 *   npm run dev     -> http://localhost:8080
 */
import { createServer } from 'node:http';
import { readFile, stat, writeFile, mkdir, readdir, unlink, rename } from 'node:fs/promises';
import { join, extname, normalize, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DECKS = join(ROOT, 'decks');
const STORE = join(ROOT, 'store');
const BOARDS = join(ROOT, 'boards');
const ACCOUNTS = join(STORE, 'accounts');       // store/accounts/<user>.json
const USERS_STORE = join(STORE, 'users');       // store/users/<user>/wallet.json
const USERS_DECKS = join(DECKS, 'users');       // decks/users/<user>/player/*.ydk
const SESSIONS_FILE = join(STORE, 'sessions.json');
// Backup dos decks/player/*.ydk de antes do login existir — não é conteúdo
// de jogo nem dado de conta em uso, só precisa ficar FORA da listagem.
const LEGACY_BACKUP_DECKS = join(DECKS, 'legacy-backup-player');
const PORT = Number(process.env.PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.lua': 'text/plain; charset=utf-8',
  '.ydk': 'text/plain; charset=utf-8',
  '.cdb': 'application/vnd.sqlite3',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let rel = decodeURIComponent(url.pathname);

    // Encerramento limpo, pedido pelo launcher. Só aceita da própria máquina —
    // é servidor de desenvolvimento, mas derrubar processo é coisa que não se
    // deixa aberta para a rede.
    if (rel === '/__shutdown') {
      if (!isLocal(req)) return void res.writeHead(403).end('403');
      res.writeHead(200, { 'content-type': 'text/plain' }).end('bye');
      console.log('  encerrando a pedido do launcher...');
      server.close(() => process.exit(0));
      // Rede de segurança: se alguma conexão ficar pendurada, sai mesmo assim.
      setTimeout(() => process.exit(0), 1500).unref();
      return;
    }

    // Decks versionados no projeto (decks/). Só de localhost: isto escreve no
    // disco, então não é coisa para ficar exposta.
    if (rel.startsWith('/__decks/')) {
      if (!isLocal(req)) return void res.writeHead(403).end('403');
      return void await handleDecks(rel.slice('/__decks/'.length), req, res);
    }

    // Config versionada no projeto (store/*.json): boosters, carteira, etc. — para
    // sobreviverem a commit/transferência em vez de morrerem no localStorage.
    if (rel.startsWith('/__store/')) {
      if (!isLocal(req)) return void res.writeHead(403).end('403');
      return void await handleStore(rel.slice('/__store/'.length), req, res);
    }

    // Tabuleiros (boards/*.json) versionados no projeto — layouts de campo
    // desenhados no editor de campo. Mesma regra: só localhost, porque grava
    // no disco.
    if (rel.startsWith('/__boards/')) {
      if (!isLocal(req)) return void res.writeHead(403).end('403');
      return void await handleBoards(rel.slice('/__boards/'.length), req, res);
    }

    // Login/registro/sessão — conta de verdade, não perfil de brinquedo.
    // Só localhost, mesma regra das outras rotas de escrita/leitura de disco.
    if (rel.startsWith('/__auth/')) {
      if (!isLocal(req)) return void res.writeHead(403).end('403');
      return void await handleAuth(rel.slice('/__auth/'.length), req, res);
    }

    // Redireciona de verdade em vez de servir o arquivo em '/': se o documento
    // ficasse na raiz, os caminhos relativos dele resolveriam contra '/' e
    // quebrariam (./js/x.js viraria /js/x.js).
    if (rel === '/' || rel === '/web' || rel === '/web/') {
      return void res.writeHead(302, { location: '/web/index.html' }).end();
    }

    const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!path.startsWith(ROOT)) return void res.writeHead(403).end('403');

    const info = await stat(path);
    if (info.isDirectory()) return void res.writeHead(403).end('403');

    res.writeHead(200, {
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(await readFile(path));
  } catch {
    res.writeHead(404).end('404');
  }
});

// Também responde a um Ctrl+C / término pedido pelo terminal.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

// ---------------------------------------------------------------------------
// decks/ — armazenamento dos decks NO PROJETO, para eles viajarem no git em vez
// de morrerem no localStorage de um navegador.
// ---------------------------------------------------------------------------

function isLocal(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1']
    .includes(req.socket.remoteAddress);
}

const json = (res, obj, code = 200) => res
  .writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  .end(JSON.stringify(obj));

const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

// ---------------------------------------------------------------------------
// Contas — login/registro de verdade, não perfil local sem senha. Hash com
// PBKDF2-HMAC-SHA256 (nativo do Node, zero dependência nova) e sessão por
// cookie httpOnly: como o front já fala com este servidor no MESMO origin,
// `fetch` manda o cookie sozinho — nenhuma chamada existente em
// projectstore.js/projectdecks.js precisa mudar.
// ---------------------------------------------------------------------------

const PBKDF2_ITER = 210_000;   // piso recomendado (OWASP 2023) pra PBKDF2-SHA256
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

/** username -> {passwordHash,...} vive em disco; sessão só em memória +
 *  store/sessions.json (sobrevive a reiniciar o servidor de dev). */
const sessions = new Map();

async function loadSessions() {
  try {
    const raw = JSON.parse(await readFile(SESSIONS_FILE, 'utf8'));
    for (const [token, s] of Object.entries(raw)) sessions.set(token, s);
    console.log(`  ${sessions.size} sessão(ões) restaurada(s) de sessions.json`);
  } catch { /* primeira vez, ou arquivo corrompido — começa vazio */ }
}

function persistSessions() {
  gravarSerializado(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2))
    .catch(() => {});
}

/** Só letras/números/_, 3-20 caracteres. Rejeita fora disso — não sanitiza,
 *  mesmo espírito de safeDeckPath/safeBoardPath: falhar alto é melhor que
 *  "consertar" em silêncio. */
function safeUsername(s) {
  return typeof s === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(s) ? s : null;
}

function accountPath(username) {
  return join(ACCOUNTS, `${username}.json`);
}

/** `pbkdf2$<iter>$<saltBase64>$<hashBase64>` — formato autodescritivo, dá pra
 *  subir o número de iterações no futuro sem invalidar hashes antigos. */
function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITER, 32, 'sha256');
  return `pbkdf2$${PBKDF2_ITER}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Comparação em TEMPO CONSTANTE (timingSafeEqual) — comparar string por
 *  string vazaria, por timing, quantos bytes iniciais bateram. */
function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = Number(parts[1]);
  if (!Number.isFinite(iter) || iter <= 0) return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = pbkdf2Sync(password, salt, iter, expected.length, 'sha256');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

/** `{token, username}` de quem está logado nesta requisição, ou null. */
function sessionFor(req) {
  const { session } = parseCookies(req);
  if (!session) return null;
  const s = sessions.get(session);
  return s ? { token: session, username: s.username } : null;
}

async function handleAuth(action, req, res) {
  if (action === 'register' && req.method === 'POST') {
    const { username, password } = await readBody(req);
    const u = safeUsername(username);
    if (!u) return json(res, { ok: false, error: 'usuário inválido (3-20 letras/números/_)' }, 400);
    if (typeof password !== 'string' || password.length < 8) {
      return json(res, { ok: false, error: 'senha precisa de pelo menos 8 caracteres' }, 400);
    }
    try {
      await readFile(accountPath(u), 'utf8');
      return json(res, { ok: false, error: 'esse usuário já existe' }, 409);
    } catch { /* não existe — segue o registro */ }

    await mkdir(ACCOUNTS, { recursive: true });
    const account = { username: u, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
    await gravarSerializado(accountPath(u), JSON.stringify(account, null, 2));
    console.log(`  conta criada: ${u}`);

    const token = randomBytes(32).toString('hex');
    sessions.set(token, { username: u, createdAt: new Date().toISOString() });
    persistSessions();
    setSessionCookie(res, token);
    return json(res, { ok: true, username: u });
  }

  if (action === 'login' && req.method === 'POST') {
    const { username, password } = await readBody(req);
    const u = safeUsername(username);
    // Mensagem genérica nos dois casos (usuário inexistente OU senha errada)
    // — dizer "esse usuário não existe" deixaria alguém varrer nomes válidos.
    const falha = () => json(res, { ok: false, error: 'usuário ou senha incorretos' }, 401);
    if (!u) return falha();

    let account;
    try { account = JSON.parse(await readFile(accountPath(u), 'utf8')); }
    catch { return falha(); }
    if (typeof password !== 'string' || !verifyPassword(password, account.passwordHash)) return falha();

    const token = randomBytes(32).toString('hex');
    sessions.set(token, { username: u, createdAt: new Date().toISOString() });
    persistSessions();
    setSessionCookie(res, token);
    return json(res, { ok: true, username: u });
  }

  if (action === 'logout' && req.method === 'POST') {
    const { session } = parseCookies(req);
    if (session) { sessions.delete(session); persistSessions(); }
    clearSessionCookie(res);
    return json(res, { ok: true });
  }

  if (action === 'me') {
    const s = sessionFor(req);
    if (!s) return json(res, { ok: false, error: 'não logado' }, 401);
    return json(res, { ok: true, username: s.username });
  }

  return json(res, { ok: false, error: 'ação desconhecida' }, 404);
}

/**
 * Resolve um caminho pedido pelo cliente para dentro de `base`.
 *
 * RECUSA o caminho suspeito em vez de "consertar" — sanitizar em silêncio faz
 * `../../evil.ydk` virar `decks/evil.ydk` e o arquivo aparece onde ninguém
 * pediu, com o cliente achando que deu tudo certo. Melhor falhar alto.
 */
function safeDeckPath(rel, base) {
  if (typeof rel !== 'string' || !rel.trim()) return null;

  // absolutos (unix, windows e UNC) não têm o que fazer aqui
  if (/^([a-zA-Z]:|[/\\])/.test(rel)) return null;

  const parts = rel.split(/[/\\]+/);
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  if (extname(rel).toLowerCase() !== '.ydk') return null;

  const full = join(base, ...parts);
  // cinto e suspensório: mesmo com tudo acima, confirma a contenção
  if (!full.startsWith(base + sep)) return null;
  return full;
}

/**
 * Onde um path de deck pedido pelo cliente REALMENTE mora: `player/*`
 * pertence a quem está logado (`decks/users/<usuário>/player/*`, exige
 * sessão); `npc/*` (e qualquer outra coisa) continua em `decks/`, global,
 * igual sempre foi — deck de NPC não é progresso de ninguém.
 *
 * O cliente nunca vê essa distinção: o `path` que ele manda/recebe continua
 * `player/x.ydk`, só o lugar físico no disco muda por baixo.
 */
function resolveDeckPath(rel, req) {
  if (typeof rel === 'string' && (rel === 'player' || rel.startsWith('player/') || rel.startsWith('player\\'))) {
    const s = sessionFor(req);
    if (!s) return { error: 'não logado', status: 401 };
    const full = safeDeckPath(rel, join(USERS_DECKS, s.username));
    if (!full) return { error: 'caminho inválido (precisa ser .ydk dentro de decks/)', status: 400 };
    return { full };
  }
  const full = safeDeckPath(rel, DECKS);
  if (!full) return { error: 'caminho inválido (precisa ser .ydk dentro de decks/)', status: 400 };
  return { full };
}

async function listYdk(dir) {
  const out = [];
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...await listYdk(full));
    else if (e.name.toLowerCase().endsWith('.ydk')) out.push(full);
  }
  return out;
}

/** Lê os `#chave valor` do topo do .ydk sem precisar do parser completo. */
function peekMeta(text) {
  const meta = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#main')) break;
    const m = /^#([a-z][\w-]*)\s+(.+)$/i.exec(line);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  }
  return meta;
}

async function handleDecks(action, req, res) {
  // GET /__decks/list — varre decks/ (npc/*, sempre) + decks/users/<u>/
  // (player/*, só de quem está logado) e devolve tudo já com conteúdo. O
  // `path` que volta é sempre `npc/...`/`player/...`, igual sempre foi — o
  // cliente não sabe (nem precisa saber) que existe uma pasta por usuário.
  if (action === 'list') {
    const items = [];
    for (const f of await listYdk(DECKS)) {
      // não desce em decks/users/ aqui — senão um deck de outro usuário
      // vazaria pra lista de quem não é dono dele. Nem no backup legado —
      // não é conteúdo de jogo, só histórico de antes do login existir.
      if (f.startsWith(USERS_DECKS + sep) || f.startsWith(LEGACY_BACKUP_DECKS + sep)) continue;
      try {
        const content = await readFile(f, 'utf8');
        items.push({ path: relative(DECKS, f).split(sep).join('/'), meta: peekMeta(content), content });
      } catch { /* arquivo sumiu no meio da varredura: ignora */ }
    }
    const s = sessionFor(req);
    if (s) {
      const meuDir = join(USERS_DECKS, s.username);
      for (const f of await listYdk(meuDir)) {
        try {
          const content = await readFile(f, 'utf8');
          items.push({ path: relative(meuDir, f).split(sep).join('/'), meta: peekMeta(content), content });
        } catch { /* idem */ }
      }
    }
    return json(res, { ok: true, decks: items });
  }

  if (action === 'save' && req.method === 'POST') {
    const { path: rel, content } = await readBody(req);
    const { full, error, status } = resolveDeckPath(rel, req);
    if (!full) return json(res, { ok: false, error }, status);
    if (typeof content !== 'string' || !content.trim()) {
      return json(res, { ok: false, error: 'conteúdo vazio' }, 400);
    }
    await mkdir(dirname(full), { recursive: true });
    await gravarSerializado(full, content);   // mesma proteção da store/
    console.log(`  deck salvo: ${relative(ROOT, full)}`);
    // O `rel` já validou como seguro (sem `..`, com extensão .ydk) — é o
    // MESMO path público que o cliente mandou, só normalizado.
    return json(res, { ok: true, path: String(rel).trim().split(/[/\\]+/).join('/') });
  }

  if (action === 'delete' && req.method === 'POST') {
    const { path: rel } = await readBody(req);
    const { full, error, status } = resolveDeckPath(rel, req);
    if (!full) return json(res, { ok: false, error }, status);
    try { await unlink(full); console.log(`  deck removido: ${relative(ROOT, full)}`); }
    catch (e) { return json(res, { ok: false, error: e.code === 'ENOENT' ? 'não existe' : e.message }, 404); }
    return json(res, { ok: true });
  }

  return json(res, { ok: false, error: 'ação desconhecida' }, 404);
}

// ---------------------------------------------------------------------------
// boards/ — layouts de campo desenhados no editor (web/campo.html), versionados
// no projeto pelo mesmo motivo que decks/: sobreviver a commit/transferência.
// Um arquivo .json por tabuleiro, sem subpastas (ao contrário de decks/, que
// separa npc/player) — não há essa distinção aqui.
// ---------------------------------------------------------------------------

/** Só um nome de arquivo .json simples dentro de boards/ (sem subpastas). */
function safeBoardPath(rel) {
  if (typeof rel !== 'string' || !rel.trim()) return null;
  if (/^([a-zA-Z]:|[/\\])/.test(rel)) return null;
  const parts = rel.split(/[/\\]+/);
  if (parts.length !== 1 || parts[0] === '.' || parts[0] === '..') return null;
  if (extname(rel).toLowerCase() !== '.json') return null;
  const full = join(BOARDS, parts[0]);
  if (!full.startsWith(BOARDS + sep)) return null;
  return full;
}

async function handleBoards(action, req, res) {
  // GET /__boards/list — varre boards/ e devolve tudo com conteúdo, igual
  // /__decks/list (poucos KB cada, evita 1 requisição por tabuleiro).
  if (action === 'list') {
    let files = [];
    try { files = (await readdir(BOARDS)).filter((f) => f.toLowerCase().endsWith('.json')); }
    catch { /* boards/ ainda não existe: lista vazia */ }
    const items = [];
    for (const f of files) {
      try { items.push({ path: f, content: await readFile(join(BOARDS, f), 'utf8') }); }
      catch { /* arquivo sumiu no meio da varredura: ignora */ }
    }
    return json(res, { ok: true, boards: items });
  }

  if (action === 'save' && req.method === 'POST') {
    const { path: rel, content } = await readBody(req);
    const full = safeBoardPath(rel);
    if (!full) return json(res, { ok: false, error: 'caminho inválido (precisa ser .json dentro de boards/)' }, 400);
    if (typeof content !== 'string' || !content.trim()) {
      return json(res, { ok: false, error: 'conteúdo vazio' }, 400);
    }
    try { JSON.parse(content); } catch { return json(res, { ok: false, error: 'conteúdo não é JSON válido' }, 400); }
    await mkdir(dirname(full), { recursive: true });
    await gravarSerializado(full, content);   // mesma proteção atômica da store/
    console.log(`  tabuleiro salvo: ${relative(ROOT, full)}`);
    return json(res, { ok: true, path: relative(BOARDS, full).split(sep).join('/') });
  }

  if (action === 'delete' && req.method === 'POST') {
    const { path: rel } = await readBody(req);
    const full = safeBoardPath(rel);
    if (!full) return json(res, { ok: false, error: 'caminho inválido' }, 400);
    try { await unlink(full); console.log(`  tabuleiro removido: ${relative(ROOT, full)}`); }
    catch (e) { return json(res, { ok: false, error: e.code === 'ENOENT' ? 'não existe' : e.message }, 404); }
    return json(res, { ok: true });
  }

  return json(res, { ok: false, error: 'ação desconhecida' }, 404);
}

// ---------------------------------------------------------------------------
// store/ — config do jogo em JSON versionado (boosters, carteira do jogador…),
// para viajar no git como os decks. GET lê, POST grava. Um arquivo por "name".
// ---------------------------------------------------------------------------

/** Só um nome simples de arquivo .json dentro de store/ (sem subpastas). */
function safeStorePath(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+\.json$/.test(name)) return null;
  const full = join(STORE, name);
  if (!full.startsWith(STORE + sep)) return null;
  return full;
}

/**
 * Grava de forma ATÔMICA e sem concorrência.
 *
 * Dois `writeFile` simultâneos no mesmo caminho não são atômicos: o mais lento
 * continua escrevendo no offset dele DEPOIS de o outro já ter truncado, e o que
 * sobra no disco é um JSON válido seguido do rabo do arquivo anterior. Foi
 * exatamente assim que uma carteira apareceu com `} Fusão": 118 } }` no fim.
 *
 * O gatilho é trivial de disparar: abrir um pacote grava DP, coleção, pity e o
 * contador da UR em sequência, e cada gravação espelha o arquivo inteiro.
 *
 * Duas defesas: uma FILA por caminho (nunca duas gravações do mesmo arquivo ao
 * mesmo tempo) e escrita em arquivo temporário seguida de `rename`, que é
 * atômico no mesmo volume — quem estiver lendo vê a versão velha ou a nova,
 * nunca metade das duas.
 */
const filaDeEscrita = new Map();

function gravarSerializado(full, texto) {
  const anterior = filaDeEscrita.get(full) ?? Promise.resolve();
  const atual = anterior
    .catch(() => {})            // falha de uma não pode travar a fila
    .then(async () => {
      const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, texto, 'utf8');
      await rename(tmp, full);
    });
  filaDeEscrita.set(full, atual);
  // Não deixa o Map crescer para sempre: quem terminou por último se remove.
  atual.finally(() => { if (filaDeEscrita.get(full) === atual) filaDeEscrita.delete(full); });
  return atual;
}

async function handleStore(name, req, res) {
  // wallet.json é dado de CONTA (DP/coleção/pity), não config do jogo —
  // pertence a quem está logado. Todo outro nome (banlist/boosters/npcs)
  // continua exatamente como sempre foi: global, sem sessão nenhuma.
  let full;
  if (name === 'wallet.json') {
    const s = sessionFor(req);
    if (!s) return json(res, { ok: false, error: 'não logado' }, 401);
    full = join(USERS_STORE, s.username, 'wallet.json');
  } else {
    full = safeStorePath(name);
    if (!full) return json(res, { ok: false, error: 'nome inválido (use <nome>.json)' }, 400);
  }

  if (req.method === 'POST') {
    const data = await readBody(req);
    await mkdir(dirname(full), { recursive: true });
    await gravarSerializado(full, JSON.stringify(data, null, 2));
    console.log(`  store salvo: ${relative(ROOT, full)}`);
    return json(res, { ok: true });
  }
  // GET: devolve o JSON cru (ou 404 se ainda não existe)
  try {
    const text = await readFile(full, 'utf8');
    return res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(text);
  } catch {
    return json(res, { ok: false, error: 'não existe' }, 404);
  }
}

// Só agora — DEPOIS que toda função/const acima já foi declarada de verdade
// (não só hoisted) — é seguro chamar `loadSessions()` (usa `sessions`, um
// `const`) e abrir a porta. Fazer isso mais acima no arquivo, antes da
// declaração de `sessions` executar, dispara `ReferenceError` (temporal dead
// zone) — e como `loadSessions` engole erro em `catch{}`, o sintoma era só
// "sessão nunca sobrevive a reiniciar o servidor", sem nenhuma mensagem.
await loadSessions();
server.listen(PORT, () => {
  console.log(`\n  yugi-game-v2 em http://localhost:${PORT}\n`);
});

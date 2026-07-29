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
import { readFile, stat, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, extname, normalize, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DECKS = join(ROOT, 'decks');
const STORE = join(ROOT, 'store');
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

server.listen(PORT, () => {
  console.log(`\n  yugi-game-v2 em http://localhost:${PORT}\n`);
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

/**
 * Resolve um caminho pedido pelo cliente para dentro de decks/.
 *
 * RECUSA o caminho suspeito em vez de "consertar" — sanitizar em silêncio faz
 * `../../evil.ydk` virar `decks/evil.ydk` e o arquivo aparece onde ninguém
 * pediu, com o cliente achando que deu tudo certo. Melhor falhar alto.
 */
function safeDeckPath(rel) {
  if (typeof rel !== 'string' || !rel.trim()) return null;

  // absolutos (unix, windows e UNC) não têm o que fazer aqui
  if (/^([a-zA-Z]:|[/\\])/.test(rel)) return null;

  const parts = rel.split(/[/\\]+/);
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  if (extname(rel).toLowerCase() !== '.ydk') return null;

  const full = join(DECKS, ...parts);
  // cinto e suspensório: mesmo com tudo acima, confirma a contenção
  if (!full.startsWith(DECKS + sep)) return null;
  return full;
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
  // GET /__decks/list — varre decks/ e devolve tudo já com conteúdo, que é
  // pequeno (alguns KB) e evita uma requisição por deck.
  if (action === 'list') {
    const files = await listYdk(DECKS);
    const items = [];
    for (const f of files) {
      try {
        const content = await readFile(f, 'utf8');
        items.push({
          path: relative(DECKS, f).split(sep).join('/'),
          meta: peekMeta(content),
          content,
        });
      } catch { /* arquivo sumiu no meio da varredura: ignora */ }
    }
    return json(res, { ok: true, decks: items });
  }

  if (action === 'save' && req.method === 'POST') {
    const { path: rel, content } = await readBody(req);
    const full = safeDeckPath(rel);
    if (!full) return json(res, { ok: false, error: 'caminho inválido (precisa ser .ydk dentro de decks/)' }, 400);
    if (typeof content !== 'string' || !content.trim()) {
      return json(res, { ok: false, error: 'conteúdo vazio' }, 400);
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
    console.log(`  deck salvo: ${relative(ROOT, full)}`);
    return json(res, { ok: true, path: relative(DECKS, full).split(sep).join('/') });
  }

  if (action === 'delete' && req.method === 'POST') {
    const { path: rel } = await readBody(req);
    const full = safeDeckPath(rel);
    if (!full) return json(res, { ok: false, error: 'caminho inválido' }, 400);
    try { await unlink(full); console.log(`  deck removido: ${relative(ROOT, full)}`); }
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

async function handleStore(name, req, res) {
  const full = safeStorePath(name);
  if (!full) return json(res, { ok: false, error: 'nome inválido (use <nome>.json)' }, 400);

  if (req.method === 'POST') {
    const data = await readBody(req);
    await mkdir(STORE, { recursive: true });
    await writeFile(full, JSON.stringify(data, null, 2), 'utf8');
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

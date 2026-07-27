/**
 * Servidor estático mínimo, sem dependências — só para abrir o demo web,
 * já que `fetch` não funciona em file://.
 *
 *   npm run serve        -> http://localhost:8080/examples/web-demo.html
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const PORT = Number(process.env.PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.lua': 'text/plain; charset=utf-8',
  '.cdb': 'application/vnd.sqlite3',
  '.css': 'text/css; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/examples/web-demo.html';

    // impede escapar da raiz do projeto
    const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!path.startsWith(ROOT)) {
      res.writeHead(403).end('403');
      return;
    }

    const info = await stat(path);
    if (info.isDirectory()) {
      res.writeHead(403).end('403');
      return;
    }

    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(body);
  } catch {
    res.writeHead(404).end('404');
  }
}).listen(PORT, () => {
  console.log(`\n  banco local servindo em http://localhost:${PORT}`);
  console.log(`  demo: http://localhost:${PORT}/examples/web-demo.html\n`);
});

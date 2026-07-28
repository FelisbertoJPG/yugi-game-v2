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
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1']
        .includes(req.socket.remoteAddress);
      if (!local) return void res.writeHead(403).end('403');
      res.writeHead(200, { 'content-type': 'text/plain' }).end('bye');
      console.log('  encerrando a pedido do launcher...');
      server.close(() => process.exit(0));
      // Rede de segurança: se alguma conexão ficar pendurada, sai mesmo assim.
      setTimeout(() => process.exit(0), 1500).unref();
      return;
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

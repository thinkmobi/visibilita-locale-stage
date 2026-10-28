'use strict';
/* Server statico minimo per servire l'app dalla radice del repo (il service worker vuole http, non file://). */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RADICE = path.resolve(__dirname, '..');
const TIPI = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };

function avvia() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname).replace(/^\/[\w.-]*-stage\//, '/'); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(RADICE, p);
    if (!f.startsWith(RADICE) || f.startsWith(path.join(RADICE, 'test')) || f.includes(`${path.sep}.git${path.sep}`) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('non trovato'); }
    res.writeHead(200, { 'content-type': TIPI[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://127.0.0.1:${srv.address().port}/`, chiudi: () => new Promise((r) => srv.close(r)) })));
}

module.exports = { avvia, RADICE };

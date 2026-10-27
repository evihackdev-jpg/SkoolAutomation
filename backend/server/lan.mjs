import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { subnetAllows } from './network.mjs';
import { requestAllowed } from './http.mjs';

export async function createLanServer({ host, port, cidr, certPath, keyPath, staticDir = 'public', api, config }) {
  if (!subnetAllows(host, cidr)) throw new Error('LAN_HOST must be inside LAN_CIDR.');
  const cert = await readFile(certPath);
  const key = await readFile(keyPath);
  const root = resolve(staticDir);
  await readFile(resolve(root, 'index.html'));
  return createServer({ cert, key, minVersion: 'TLSv1.2' }, async (req, res) => {
    if (!subnetAllows(req.socket.remoteAddress, cidr) || !requestAllowed(req, config)) {
      res.writeHead(403); res.end('This service is limited to the configured subnet.'); return;
    }
    if (req.url.startsWith('/api/')) { await api(req, res); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, `https://${host}:${port}`).pathname);
      const target = resolve(root, '.' + pathname);
      if (!target.startsWith(root + sep) && target !== root) { res.writeHead(403); res.end(); return; }
      const file = extname(target) ? target : resolve(root, 'index.html');
      const data = await readFile(file);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Referrer-Policy': 'same-origin' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}

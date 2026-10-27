import { isIP } from 'node:net';

function origin(value, name, production) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must contain a valid origin, such as https://app.example.com.`); }
  if (!['http:','https:'].includes(url.protocol) || url.hostname.includes('*') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (production && url.protocol !== 'https:')) throw new Error(`${name} must be an ${production ? 'HTTPS' : 'HTTP(S)'} origin without a path, credentials or wildcard.`);
  return url.origin;
}

export function runtimeConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.API_PORT || env.PORT || 3002);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('API_PORT must be between 1024 and 65535.');
  const host = env.API_HOST || '127.0.0.1';
  if (!isIP(host)) throw new Error('API_HOST must be a bind IP address.');
  const localOwner = !production && env.LOCAL_OWNER_ENABLED === 'true';
  if (env.LOCAL_OWNER_ENABLED === 'true' && (production || !['127.0.0.1','::1'].includes(host))) throw new Error('LOCAL_OWNER_ENABLED must be false in production and on public bind addresses.');
  if (production && env.LAN_HOST) throw new Error('Clear LAN_HOST for VPS deployment; terminate HTTPS at the reverse proxy.');
  if (production && (!env.API_PUBLIC_ORIGIN || !env.FRONTEND_ORIGINS)) throw new Error('Production requires API_PUBLIC_ORIGIN and FRONTEND_ORIGINS.');
  const apiOrigin = env.API_PUBLIC_ORIGIN ? origin(env.API_PUBLIC_ORIGIN, 'API_PUBLIC_ORIGIN', production) : null;
  const frontends = (env.FRONTEND_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).map(s => origin(s, 'FRONTEND_ORIGINS', production));
  if (production && !frontends.length) throw new Error('Production requires at least one frontend origin.');
  const localOrigins = production ? [] : ['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4173','http://localhost:4173',`http://127.0.0.1:${port}`,`http://localhost:${port}`];
  return { host, port, localOwner, production, config: {
    port,
    hosts: [...new Set([`127.0.0.1:${port}`,`localhost:${port}`, ...(apiOrigin ? [new URL(apiOrigin).host] : [])])],
    origins: [...new Set([...localOrigins, ...frontends, ...(apiOrigin ? [apiOrigin] : [])])],
    secureCookies: production,
    requireOrigin: production,
    trustProxy: env.TRUST_PROXY === 'true',
  } };
}

export function clientAddress(req, config) {
  const peer = req.socket.remoteAddress;
  if (config.trustProxy && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)) {
    const forwarded = req.headers['x-real-ip'];
    if (typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  }
  return peer;
}

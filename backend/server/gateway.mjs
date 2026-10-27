import { createHandler, requestAllowed } from './http.mjs';
import { AuthError, sessionCookie } from './identity.mjs';
import { InputError } from './cookies.mjs';
import { storageErrorMessage } from './storage.mjs';
import { clientAddress } from './config.mjs';

export function createGateway({ identity, initialize, services, config, localOwner = false }) {
  return async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (!requestAllowed(req, config)) { reply(403, { error: 'Request origin is not allowed.' }); return; }
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/api/health' && req.method === 'GET') { reply(200, { status: 'ok' }); return; }
      await initialize();
      if (req.method === 'POST' && ['/api/auth/login', '/api/auth/register', '/api/auth/logout'].includes(path)) {
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') { reply(415, { error: 'Use application/json.' }); return; }
        let text = '';
        for await (const chunk of req) { text += chunk.toString('utf8'); if (Buffer.byteLength(text) > 4096) throw new InputError('Sign-in request is too large.'); }
        if (path.endsWith('/logout')) {
          await identity.logout(req);
          res.setHeader('Set-Cookie', sessionCookie('', config.secureCookies || Boolean(req.socket.encrypted), true));
          reply(200, { ok: true }); return;
        }
        let body;
        try { body = JSON.parse(text); } catch { throw new InputError('Invalid JSON.'); }
        const result = await identity.authenticate(body, path.endsWith('/register'), clientAddress(req, config));
        res.setHeader('Set-Cookie', sessionCookie(result.token, config.secureCookies || Boolean(req.socket.encrypted)));
        reply(200, { user: result.user }); return;
      }
      const user = await identity.user(req, localOwner && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress));
      if (path === '/api/auth/me' && req.method === 'GET') { reply(200, { user }); return; }
      const { accounts, discovery, join, bulkJoin, randomAccount, membershipCheck, memberships, automation, publishedPosts, profileSettings } = services(user.id);
      await createHandler(accounts, { ...config, discovery, join, bulkJoin, randomAccount, membershipCheck, memberships, automation, publishedPosts, profileSettings })(req, res);
    } catch (error) {
      if (error instanceof AuthError) reply(error.status, { error: error.message });
      else if (error instanceof InputError) reply(400, { error: error.message });
      else reply(503, { error: storageErrorMessage(error) });
    }
  };
}

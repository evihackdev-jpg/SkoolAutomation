import { InputError } from './cookies.mjs';
import { storageErrorMessage } from './storage.mjs';
import { SessionError } from './skool.mjs';

export function requestAllowed(req, { port, origins, requireOrigin = false, hosts = [`127.0.0.1:${port}`, `localhost:${port}`] }) {
  return hosts.includes(req.headers.host) && (!requireOrigin || !['POST','PUT','PATCH','DELETE'].includes(req.method) || Boolean(req.headers.origin)) && (!req.headers.origin || origins.includes(req.headers.origin)) && req.headers['sec-fetch-site'] !== 'cross-site';
}

export function createHandler(accounts, config) {
  const { port, discovery, join, bulkJoin, randomAccount, membershipCheck, memberships, automation, publishedPosts, profileSettings } = config;
  return async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(data));
    };
    // Local single-user API: reject DNS rebinding and cross-site browser requests.
    if (!requestAllowed(req, config)) {
      reply(403, { error: 'Request origin is not allowed.' }); return;
    }
    try {
      const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
      if (publishedPosts && path === '/api/published-posts' && req.method === 'GET') { reply(200, await publishedPosts(new URL(req.url, 'http://localhost').searchParams)); return; }
      if(bulkJoin && path==='/api/communities/bulk-join' && req.method==='GET'){reply(200,await bulkJoin.list());return;}
      const bulkStop=/^\/api\/communities\/bulk-join\/([a-f0-9-]{36})\/stop$/.exec(path);
      if(bulkJoin && req.method==='POST' && (path==='/api/communities/bulk-join'||bulkStop)){
        if(req.headers['content-type']?.split(';')[0].trim()!=='application/json'){reply(415,{error:'Use application/json.'});return;}
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096){reply(413,{error:'Bulk join request is too large.'});return;}chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new InputError('Invalid JSON.');}
        reply(bulkStop?200:202,bulkStop?await bulkJoin.stop(bulkStop[1]):await bulkJoin.start(body));return;
      }
      if (membershipCheck && path === '/api/communities/membership' && req.method === 'GET') { reply(200,await membershipCheck(new URL(req.url,'http://localhost').searchParams));return; }
      if (profileSettings && path === '/api/settings' && req.method === 'GET') { reply(200, await profileSettings.get()); return; }
      if (profileSettings && path === '/api/settings' && req.method === 'PUT') {
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') { reply(415, { error: 'Use application/json.' }); return; }
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 65536) { reply(413, { error: 'Profile information is too large.' }); return; } chunks.push(chunk); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('Invalid JSON.'); }
        reply(200, await profileSettings.save(body)); return;
      }
      if (automation && path === '/api/automation' && req.method === 'GET') { reply(200, await automation.list()); return; }
      if (automation && path === '/api/automation/history' && req.method === 'DELETE') { reply(200, await automation.clearHistory()); return; }
      const stopMatch = /^\/api\/automation\/([a-f0-9-]{36})\/stop$/.exec(path);
      if (automation && ((path === '/api/automation' && req.method === 'POST') || (path === '/api/automation/settings' && req.method === 'PUT') || (stopMatch && req.method === 'POST'))) {
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') { reply(415, { error: 'Use application/json.' }); return; }
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > (path === '/api/automation' ? 65536 : 32768)) { reply(413, { error: 'Auto Mode request is too large.' }); return; } chunks.push(chunk); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('Invalid JSON.'); }
        reply(stopMatch ? 200 : req.method === 'PUT' ? 200 : 202, stopMatch ? await automation.stop(stopMatch[1]) : req.method === 'PUT' ? await automation.saveFacts(body) : await automation.start(body)); return;
      }
      if (path === '/api/communities/joined' && req.method === 'GET' && memberships) {
        reply(200, await memberships(new URL(req.url, 'http://localhost').searchParams)); return;
      }
      const joinAction = path === '/api/communities/join' ? join : path === '/api/communities/random-account' ? randomAccount : null;
      if (joinAction && req.method === 'POST') {
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') { reply(415, { error: 'Use application/json.' }); return; }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4096) { reply(413, { error: 'Join request is too large.' }); return; }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('Invalid JSON.'); }
        reply(200, await joinAction(body)); return;
      }
      if (path === '/api/discover' && req.method === 'GET' && discovery) {
        reply(200, await discovery(new URL(req.url, 'http://localhost').searchParams)); return;
      }
      const accountMatch = /^\/api\/accounts\/([a-f0-9-]{36})$/.exec(path);
      const verifyMatch = /^\/api\/accounts\/([a-f0-9-]{36})\/verify$/.exec(path);
      if (verifyMatch && req.method === 'POST') {
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') { reply(415, { error: 'Use application/json.' }); return; }
        const account = await accounts.verify(verifyMatch[1]);
        reply(account ? 200 : 404, account ? { account } : { error: 'Account not found.' }); return;
      }
      if (path === '/api/accounts' && req.method === 'GET') { reply(200, { accounts: await accounts.list() }); return; }
      if ((path === '/api/accounts' && req.method === 'POST') || (accountMatch && req.method === 'PUT')) {
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') { reply(415, { error: 'Use application/json.' }); return; }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 256 * 1024) { reply(413, { error: 'Account data exceeds 256 KB.' }); return; }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new InputError('Invalid JSON.'); }
        if (req.method === 'PUT') {
          const account = await accounts.update(accountMatch[1], body);
          reply(account ? 200 : 404, account ? { account } : { error: 'Account not found.' }); return;
        }
        reply(201, { account: await accounts.create(body) }); return;
      }
      const match = /^\/api\/accounts\/([a-f0-9-]{36})$/.exec(path);
      if (match && req.method === 'DELETE') {
        const removed = await accounts.remove(match[1]);
        reply(removed ? 200 : 404, removed ? { deleted: true } : { error: 'Account not found.' }); return;
      }
      reply(404, { error: 'Endpoint not found.' });
    } catch (error) {
      if (error instanceof InputError) reply(400, { error: error.message });
      else if (error instanceof SessionError) reply(error.status, { error: error.message });
      else if (error?.code === 11000) reply(409, { error: 'This Skool account is already imported. Use Update Cookies on its existing row.' });
      else reply(503, { error: storageErrorMessage(error) });
    }
  };
}

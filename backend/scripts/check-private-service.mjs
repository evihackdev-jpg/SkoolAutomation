import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import assert from 'node:assert/strict';
const ca = await readFile(process.env.LAN_TLS_CERT);
const base = `https://${process.env.LAN_HOST}:${process.env.LAN_PORT}`;
function call(path, { method = 'GET', cookie, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(base + path, { ca, method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => {
        let data; try { data = JSON.parse(text); } catch { data = null; }
        resolve({ status: res.statusCode, data, cookie: res.headers['set-cookie']?.[0] });
      });
    });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('Timed out')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const client = new MongoClient(process.env.MONGODB_URI);
const emails = []; const userIds = [];
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);
  assert.equal((await call('/dashboard')).status, 200);
  assert.equal((await call('/api/accounts')).status, 401);
  assert.equal((await call('/api/accounts', { headers: { 'X-Forwarded-For': '127.0.0.1' } })).status, 401);
  const users = [];
  for (let i = 0; i < 2; i++) {
    const email = `temporary-isolation-${randomUUID()}@example.invalid`; emails.push(email);
    const registered = await call('/api/auth/register', { method: 'POST', body: { email, password: randomBytes(24).toString('hex') } });
    assert.equal(registered.status, 200); assert.match(registered.cookie, /Secure/);
    const id = registered.data.user.id; userIds.push(id);
    users.push({ id, cookie: registered.cookie.split(';')[0] });
    assert.deepEqual((await call('/api/accounts', { cookie: users[i].cookie })).data.accounts, []);
  }
  const accountId = randomUUID();
  await db.collection('accounts').insertOne({ _id: accountId, ownerId: users[0].id, identifierKey: `test:${accountId}`, displayName: 'Disposable isolation test', identifier: '', status: 'unverified', cookieCount: 0, notes: '', createdAt: new Date().toISOString() });
  assert.equal((await call('/api/accounts', { cookie: users[0].cookie })).data.accounts.length, 1);
  assert.deepEqual((await call('/api/accounts', { cookie: users[1].cookie })).data.accounts, []);
  for (const [method, suffix] of [['DELETE', ''], ['PUT', ''], ['POST', '/verify']]) {
    const result = await call('/api/accounts/' + accountId + suffix, { cookie: users[1].cookie, method, body: method === 'DELETE' ? undefined : { cookieData: 'locale=test' } });
    assert.equal(result.status, 404);
  }
  assert.equal((await call(`/api/discover?accountId=${accountId}`, { cookie: users[1].cookie })).status, 422);
  await call('/api/auth/logout', { cookie: users[0].cookie, method: 'POST', body: {} });
  assert.equal((await call('/api/accounts', { cookie: users[0].cookie })).status, 401);
  console.log('PASS: HTTPS certificate verification, sign-up, secure cookies, private account lists, cross-user update/delete/verification/discovery denial, and logout.');
} catch (error) { console.log('Private-service check failed: ' + error.name); process.exitCode = 1; }
finally {
  const db = client.db(process.env.MONGODB_DB);
  const created = await db.collection('users').find({ email: { $in: emails } }).toArray();
  const ids = [...new Set([...userIds, ...created.map(user => user._id)])];
  await db.collection('sessions').deleteMany({ userId: { $in: ids } });
  await db.collection('accounts').deleteMany({ ownerId: { $in: ids } });
  await db.collection('users').deleteMany({ _id: { $in: ids }, email: { $in: emails } });
  await client.close(); console.log('Temporary test users, sessions, and accounts removed.');
}

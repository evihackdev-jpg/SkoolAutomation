import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { parseCookies } from './cookies.mjs';
import { createAccountsService, decryptCookies, encryptCookies, encryptionKey } from './accounts.mjs';
import { createHandler } from './http.mjs';
import { SessionError } from './skool.mjs';

const input = { displayName: 'Test account', identifier: 'test@example.invalid', notes: 'Test only', cookieData: 'session=synthetic-test-value==' };
const mockVerify = async (cookies) => ({ skoolUserId: cookies[0].value, displayName: 'Verified Test User', identifier: '@test-user', verifiedAt: '2026-10-26T00:00:00.000Z' });

function collectionStub() {
  const records = new Map();
  return {
    records,
    find() { return { sort() { return { toArray: async () => [...records.values()] }; } }; },
    async findOne({ _id }) { return records.get(_id) ?? null; },
    async updateOne({ _id }, { $set }) {
      if (!records.has(_id)) return { matchedCount: 0 };
      if ($set.identifierKey && [...records.values()].some((item) => item._id !== _id && item.identifierKey === $set.identifierKey)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      records.set(_id, { ...records.get(_id), ...$set });
      return { matchedCount: 1 };
    },
    async insertOne(record) {
      if ([...records.values()].some((item) => item.identifierKey === record.identifierKey)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      records.set(record._id, record);
    },
    async deleteOne({ _id }) { return { deletedCount: Number(records.delete(_id)) }; },
  };
}

test('Cookie header preserves equals signs inside values', () => {
  assert.equal(parseCookies('Cookie: session=abc==; other=xyz')[0].value, 'abc==');
});

test('collector heading and repeated identical raw cookies are accepted without modifying values', () => {
  const raw = 'locale=en; client_id=synthetic; AWSALB=abc+/==';
  const parsed = parseCookies(`Collected (non-HttpOnly) cookies:\r\n ${raw}; ${raw}\r\n\r\n`);
  assert.deepEqual(parsed.map(({ name, value }) => [name, value]), [['locale', 'en'], ['client_id', 'synthetic'], ['AWSALB', 'abc+/==']]);
  assert.throws(() => parseCookies('client_id=first; client_id=second'), /conflicting/);
});

test('non-HttpOnly collector output reports the missing login cookie without creating a record', async () => {
  const collection = collectionStub();
  const service = createAccountsService(collection, randomBytes(32));
  await assert.rejects(service.create({ cookieData: 'Collected (non-HttpOnly) cookies:\nlocale=en; client_id=synthetic; locale=en; client_id=synthetic' }), /Missing auth_token/);
  assert.equal(collection.records.size, 0);
});

test('JSON imports preserve domain, path, flags and expiration', () => {
  const cookie = { name: 'session', value: 'synthetic', domain: '.skool.com', path: '/test', httpOnly: true, secure: true, sameSite: 'lax', expirationDate: 2000 };
  const parsed = parseCookies(JSON.stringify({ cookies: [cookie] }), 1000)[0];
  assert.equal(parsed.expires, 2000);
  assert.equal(parsed.httpOnly, true);
  assert.equal(parsed.path, '/test');
});

test('rejects invalid, expired, unrelated and oversized cookie data without echoing values', () => {
  for (const value of ['', 'bad', '{bad', '[]', 'session=a\r\ninjection', 'session=a; session=b',
    JSON.stringify([{ name: 'session', value: 'synthetic', domain: 'skool.com.evil.example' }]),
    JSON.stringify([{ name: 'session', value: 'synthetic', expires: 10 }]),
    JSON.stringify([{ name: 'session', value: 'synthetic', sameSite: {} }]),
    'session=' + 'x'.repeat(131072)]) {
    assert.throws(() => parseCookies(value), (error) => !error.message.includes('synthetic'));
  }
});

test('encryption round-trips and rejects tampering or moving ciphertext to another account', () => {
  const key = randomBytes(32);
  const cookies = parseCookies(input.cookieData);
  const encrypted = encryptCookies(cookies, key, 'account-one');
  assert.deepEqual(decryptCookies(encrypted, key, 'account-one'), cookies);
  assert.ok(!JSON.stringify(encrypted).includes('synthetic-test-value'));
  assert.throws(() => decryptCookies(encrypted, key, 'account-two'));
  assert.throws(() => decryptCookies({ ...encrypted, tag: randomBytes(16).toString('base64') }, key, 'account-one'));
  assert.throws(() => encryptionKey('short'));
});

test('account service stores encrypted cookies and exposes only metadata across reloads', async () => {
  const collection = collectionStub();
  const key = randomBytes(32);
  const service = createAccountsService(collection, key, mockVerify);
  const account = await service.create(input);
  assert.equal(account.status, 'active');
  assert.equal(account.cookieCount, 1);
  assert.ok(!JSON.stringify(account).includes('synthetic-test-value'));
  const saved = collection.records.get(account.id);
  assert.deepEqual(decryptCookies(saved.encryptedCookies, key, account.id), parseCookies(input.cookieData));
  assert.deepEqual(await createAccountsService(collection, key, mockVerify).list(), [account]);
  await assert.rejects(service.create({ ...input, identifier: input.identifier.toUpperCase() }), { code: 11000 });
  assert.equal(await service.remove(account.id), true);
  assert.deepEqual(await service.list(), []);
});

test('cookie-only imports use verified profile identity and preserve encrypted credentials', async () => {
  const collection = collectionStub();
  const key = randomBytes(32);
  const service = createAccountsService(collection, key, mockVerify);
  const first = await service.create({ cookieData: 'session=synthetic-first' });
  const second = await service.create({ cookieData: 'session=synthetic-second' });
  assert.equal(first.displayName, 'Verified Test User');
  assert.notEqual(first.id, second.id);
  assert.equal(first.identifier, '@test-user');
  assert.notEqual(collection.records.get(first.id).identifierKey, collection.records.get(second.id).identifierKey);
  assert.equal(decryptCookies(collection.records.get(first.id).encryptedCookies, key, first.id)[0].value, 'synthetic-first');
  await assert.rejects(service.create({ cookieData: '' }));
});

test('HTTP create/list/delete, validation, duplicate and origin protection', async (t) => {
  const collection = collectionStub();
  const config = { port: 0, origins: ['http://127.0.0.1:5173'] };
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  server.on('request', createHandler(createAccountsService(collection, randomBytes(32), mockVerify), config));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${config.port}/api/accounts`;
  const post = (body, headers = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const created = await post(input);
  assert.equal(created.status, 201);
  const { account } = await created.json();
  const listed = await fetch(base);
  assert.equal(listed.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await listed.json()).accounts, [account]);
  assert.equal((await post(input)).status, 409);
  assert.equal((await post({ ...input, cookieData: 'bad' })).status, 400);
  assert.equal((await post(input, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(input, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const reboundStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(base, { headers: { Host: 'evil.example' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(reboundStatus, 403);
  assert.equal((await post(input, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({ ...input, notes: 'x'.repeat(270000) })).status, 413);
  const verified = await fetch(`${base}/${account.id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(verified.status, 200);
  const replaced = await fetch(`${base}/${account.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookieData: 'session=refreshed-test' }) });
  assert.equal(replaced.status, 200);
  assert.equal((await replaced.json()).account.id, account.id);
  assert.equal((await fetch(`${base}/${account.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${base}/${account.id}`, { method: 'DELETE' })).status, 404);
});

test('incomplete cookies cannot create an account and legacy imports can be repaired', async () => {
  const collection = collectionStub();
  const key = randomBytes(32);
  const liveService = createAccountsService(collection, key);
  await assert.rejects(liveService.create({ cookieData: 'locale=en; client_id=synthetic' }), /Missing auth_token/);
  assert.equal(collection.records.size, 0);
  const legacy = await createAccountsService(collection, key, mockVerify).create(input);
  await assert.rejects(liveService.verify(legacy.id), /Missing auth_token/);
  assert.equal(collection.records.get(legacy.id).status, 'inactive');
  const before = collection.records.get(legacy.id).encryptedCookies;
  await assert.rejects(liveService.update(legacy.id, { cookieData: 'locale=en' }), /Missing auth_token/);
  assert.deepEqual(collection.records.get(legacy.id).encryptedCookies, before);
  const repaired = await createAccountsService(collection, key, mockVerify).update(legacy.id, { cookieData: 'session=repaired-synthetic' });
  assert.equal(repaired.id, legacy.id);
  assert.equal(repaired.status, 'active');
  assert.equal(repaired.verificationError, null);
  assert.equal(collection.records.size, 1);
});

test('temporary verification failures do not invalidate a previously connected account', async () => {
  const collection = collectionStub();
  const key = randomBytes(32);
  const account = await createAccountsService(collection, key, mockVerify).create(input);
  const failing = createAccountsService(collection, key, async () => { throw new SessionError('Temporary Skool outage', 502, false); });
  await assert.rejects(failing.verify(account.id));
  assert.equal(collection.records.get(account.id).status, 'active');
});

test('database failures do not expose connection details', async (t) => {
  const config = { port: 0, origins: [] };
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  server.on('request', createHandler({ list: async () => { throw new Error('mongodb://user:secret@private-host'); } }, config));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${config.port}/api/accounts`);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('secret'));
});

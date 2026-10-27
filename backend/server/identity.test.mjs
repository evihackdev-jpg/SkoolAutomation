import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createIdentity, ownerCollection, sessionCookie } from './identity.mjs';
import { createGateway } from './gateway.mjs';
import { runtimeConfig } from './config.mjs';

const registrationCode = 'synthetic-registration-code';

function memoryDB() {
  const tables = new Map();
  const matches = (item, query) => Object.entries(query).every(([key, value]) => value?.$gt ? item[key] > value.$gt : item[key] === value);
  return { tables, collection(name) {
    if (!tables.has(name)) tables.set(name, []);
    const rows = tables.get(name);
    return {
      createIndex: async () => {},
      find: (query = {}) => ({ toArray: async () => rows.filter(row => matches(row, query)) }),
      findOne: async query => rows.find(row => matches(row, query)) || null,
      insertOne: async row => { if (rows.some(item => item._id === row._id || (name === 'users' && item.email === row.email))) throw Object.assign(new Error(), { code: 11000 }); rows.push(row); },
      updateOne: async (query, update) => { const row = rows.find(row => matches(row, query)); if (row) Object.assign(row, update.$set); return { matchedCount: Number(Boolean(row)) }; },
      deleteOne: async query => { const index = rows.findIndex(row => matches(row, query)); if (index >= 0) rows.splice(index, 1); return { deletedCount: Number(index >= 0) }; },
    };
  } };
}

test('ownership scopes every storage operation, even when another owner is supplied', async () => {
  const collection = memoryDB().collection('accounts');
  await collection.insertOne({ _id: 'secret', ownerId: 'owner-a' });
  const scoped = ownerCollection(collection, 'owner-b');
  assert.deepEqual(await scoped.find({ ownerId: 'owner-a' }).toArray(), []);
  assert.equal(await scoped.findOne({ _id: 'secret', ownerId: 'owner-a' }), null);
  assert.equal((await scoped.updateOne({ _id: 'secret' }, { $set: { changed: true } })).matchedCount, 0);
  assert.equal((await scoped.deleteOne({ _id: 'secret' })).deletedCount, 0);
  await scoped.insertOne({ _id: 'new', ownerId: 'owner-a' });
  assert.equal((await collection.findOne({ _id: 'new' })).ownerId, 'owner-b');
});

test('private login uses password hashes, expiring opaque sessions, and logout revocation', async () => {
  const db = memoryDB();
  const identity = createIdentity(db, { registrationCode });
  await identity.initialize();
  const body = { email: 'test@example.invalid', password: 'synthetic-test-password', registrationCode };
  const registered = await identity.authenticate(body, true, '192.168.138.10');
  assert.ok(!JSON.stringify(db.tables.get('users')).includes(body.password));
  assert.ok(!JSON.stringify(db.tables.get('sessions')).includes(registered.token));
  assert.ok(!JSON.stringify([...db.tables]).includes(registrationCode));
  const login = await identity.authenticate({ email: body.email, password: body.password }, false, '192.168.138.10');
  assert.equal(login.user.id, registered.user.id);
  const req = { headers: { cookie: `skool_service_session=${registered.token}` } };
  assert.equal((await identity.user(req)).id, registered.user.id);
  await assert.rejects(identity.authenticate({ ...body, password: 'incorrect' }, false, '192.168.138.10'), /incorrect/);
  await identity.logout(req);
  await assert.rejects(identity.user(req), /expired/);
  await assert.rejects(identity.user({ headers: {} }), /Sign in/);
  assert.equal((await identity.user({ headers: {} }, true)).id, 'local-owner');
  assert.match(sessionCookie('token', true), /HttpOnly; SameSite=Strict.*Secure/);
});

test('registration rejects missing, incorrect, differently cased or malformed codes before storing anything', async () => {
  const db = memoryDB(), identity = createIdentity(db, { registrationCode });
  const body = { email: 'restricted@example.invalid', password: 'synthetic-test-password' };
  for (const code of [undefined, '', 'incorrect', registrationCode.toUpperCase(), ` ${registrationCode}`, `${registrationCode} `, 123, {}, 'x'.repeat(129)]) {
    await assert.rejects(identity.authenticate({ ...body, registrationCode: code }, true, '192.0.2.1'), error => error.status === 403 && /Registration code is incorrect/.test(error.message));
    assert.equal(db.tables.get('users').length, 0);
    assert.equal(db.tables.get('sessions').length, 0);
  }
  const result = await identity.authenticate({ ...body, registrationCode }, true, '192.0.2.1');
  assert.equal(result.user.email, body.email);
  assert.equal(db.tables.get('users').length, 1);
});

test('an unset registration code disables signups while existing users can still sign in', async () => {
  const db = memoryDB();
  const body = { email: 'existing@example.invalid', password: 'synthetic-test-password' };
  await createIdentity(db, { registrationCode }).authenticate({ ...body, registrationCode }, true, '192.0.2.2');
  const restricted = createIdentity(db, { registrationCode: '' });
  await assert.rejects(restricted.authenticate({ ...body, email: 'new@example.invalid', registrationCode }, true, '192.0.2.2'), error => error.status === 503);
  assert.equal(db.tables.get('users').length, 1);
  assert.equal((await restricted.authenticate(body, false, '192.0.2.2')).user.email, body.email);
});

test('LAN gateway never grants local-owner access and separates two users over HTTP', async t => {
  const db = memoryDB();
  const identity = createIdentity(db, { registrationCode });
  const config = { port: 0, origins: [] };
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  config.port = server.address().port;
  server.on('request', createGateway({ identity, initialize: async () => {}, localOwner: false, config,
    services: userId => ({ accounts: { list: async () => [{ ownerId: userId }] } }) }));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${config.port}`;
  assert.equal((await fetch(base + '/api/accounts')).status, 401);
  assert.equal((await fetch(base + '/api/accounts', { headers: { 'X-Forwarded-For': '127.0.0.1' } })).status, 401);
  const signup = async email => {
    const response = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'synthetic-test-password', registrationCode }) });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], user: (await response.json()).user };
  };
  const a = await signup('first@example.invalid'); const b = await signup('second@example.invalid');
  assert.notEqual(a.user.id, b.user.id);
  for (const user of [a, b]) {
    const response = await fetch(base + '/api/accounts', { headers: { Cookie: user.cookie } });
    assert.deepEqual((await response.json()).accounts, [{ ownerId: user.user.id }]);
  }
  const rejected = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(rejected.status, 403);
});

test('VPS proxy login keeps Secure host-only cookies, requires approved write origins and never grants local-owner access',async t=>{
  const db=memoryDB(),identity=createIdentity(db,{registrationCode});
  const {config,localOwner}=runtimeConfig({NODE_ENV:'production',API_PUBLIC_ORIGIN:'https://api.example.com',FRONTEND_ORIGINS:'https://app.vercel.app',TRUST_PROXY:'true'});
  let initialized=0;
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  config.port=server.address().port;config.hosts.push(`127.0.0.1:${config.port}`);
  server.on('request',createGateway({identity,initialize:async()=>{initialized++;},config,localOwner,services:ownerId=>({accounts:{list:async()=>[{ownerId}]}})}));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${config.port}`;
  assert.deepEqual(await (await fetch(base+'/api/health')).json(),{status:'ok'});assert.equal(initialized,0);
  assert.equal((await fetch(base+'/api/accounts',{headers:{'x-forwarded-for':'127.0.0.1','x-forwarded-proto':'https'}})).status,401);
  const json={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'vps@example.invalid',password:'synthetic-test-password',registrationCode})};
  assert.equal((await fetch(base+'/api/auth/register',json)).status,403);
  assert.equal((await fetch(base+'/api/auth/register',{...json,headers:{...json.headers,Origin:'https://evil.example'}})).status,403);
  for (const suppliedCode of [undefined, 'incorrect']) {
    const rejected = await fetch(base+'/api/auth/register', {...json, headers:{...json.headers,Origin:'https://app.vercel.app'},body:JSON.stringify({email:'blocked@example.invalid',password:'synthetic-test-password',registrationCode:suppliedCode})});
    assert.equal(rejected.status,403);
    assert.equal(rejected.headers.get('set-cookie'),null);
    assert.match((await rejected.json()).error,/Registration code is incorrect/);
    assert.equal(db.tables.get('users').length,0);
    assert.equal(db.tables.get('sessions').length,0);
  }
  const registered=await fetch(base+'/api/auth/register',{...json,headers:{...json.headers,Origin:'https://app.vercel.app','Sec-Fetch-Site':'same-origin','X-Real-IP':'192.0.2.5'}});
  assert.equal(registered.status,200);
  const cookie=registered.headers.get('set-cookie');assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.match(cookie,/; Secure/);assert.doesNotMatch(cookie,/Domain=/);
  const {user}=await registered.json();const headers={Cookie:cookie.split(';')[0],Origin:'https://app.vercel.app','Sec-Fetch-Site':'same-origin'};
  assert.deepEqual((await (await fetch(base+'/api/accounts',{headers})).json()).accounts,[{ownerId:user.id}]);
  const logout=await fetch(base+'/api/auth/logout',{...json,headers:{...headers,'Content-Type':'application/json'}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0; Secure/);
  assert.equal((await fetch(base+'/api/accounts',{headers})).status,401);
});

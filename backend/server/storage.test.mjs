import test from 'node:test';
import assert from 'node:assert/strict';
import { withStorageReady, storageErrorMessage, storageErrorCodes } from './storage.mjs';

test('failed initialization can recover on the next request without restarting', async () => {
  let attempts = 0;
  let writes = 0;
  const accounts = withStorageReady({
    list: async () => [],
    create: async (input) => { writes++; return input; },
    remove: async () => true,
  }, async () => {
    attempts++;
    if (attempts === 1) throw new Error('temporarily unavailable');
  });
  await assert.rejects(accounts.create({ id: 'test' }));
  assert.equal(writes, 0);
  assert.deepEqual(await accounts.create({ id: 'test' }), { id: 'test' });
  assert.equal(writes, 1);
  await accounts.list();
  assert.equal(attempts, 2);
});

test('concurrent requests share one connection initialization', async () => {
  let attempts = 0;
  let finish;
  const initialized = new Promise((resolve) => { finish = resolve; });
  const accounts = withStorageReady({ list: async () => [] }, async () => { attempts++; await initialized; });
  const requests = [accounts.list(), accounts.list(), accounts.list()];
  finish();
  await Promise.all(requests);
  assert.equal(attempts, 1);
});

test('TLS and authentication failures have actionable, secret-free messages', () => {
  const error = { message: 'mongodb://user:secret@example', reason: { servers: new Map([
    ['server', { error: { cause: { code: 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR' } } }],
  ]) } };
  assert.match(storageErrorMessage(error), /Network Access/);
  assert.ok(!storageErrorMessage(error).includes('secret'));
  assert.match(storageErrorMessage({ code: 18 }), /authentication failed/);
});

test('nested connection codes are bounded, cycle-safe and never expose messages or connection details',()=>{
  const error={message:'mongodb://user:PRIVATE_PASSWORD@host',code:'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR'};
  error.cause=error;
  const outer={cause:{reason:{servers:new Map([['PRIVATE_HOST',{error}]])}},code:'mongodb://user:PRIVATE_PASSWORD@host'};
  assert.deepEqual(storageErrorCodes(outer),['ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR']);
  assert.doesNotMatch(storageErrorMessage(outer),/PRIVATE_|mongodb:\/\//);
  assert.match(storageErrorMessage(outer),/db:check/);
});

test('DNS, certificate trust, authentication and database permissions have distinct messages',()=>{
  assert.match(storageErrorMessage({cause:{code:'ENOTFOUND'}}),/DNS lookup failed/);
  assert.match(storageErrorMessage({cause:{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}}),/certificate trust/);
  assert.match(storageErrorMessage({code:13}),/lacks permission/);
  assert.match(storageErrorMessage({code:18,cause:{code:'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR'}}),/authentication failed/);
});

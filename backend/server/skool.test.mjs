import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies } from './cookies.mjs';
import { verifySkoolSession, sessionHeader, SessionError } from './skool.mjs';

const cookies = parseCookies('auth_token=synthetic-login; client_id=synthetic-client; tracking=do-not-send');
test('missing login cookies are rejected before any network request', async () => {
  await assert.rejects(verifySkoolSession(parseCookies('locale=en; client_id=test'), () => { throw new Error('Must not fetch'); }), /Missing auth_token/);
  await assert.rejects(verifySkoolSession(parseCookies('auth_token=test'), () => { throw new Error('Must not fetch'); }), /Missing client_id/);
});
test('only login cookies go to Skool and identity comes from its profile response', async () => {
  const profile = await verifySkoolSession(cookies, async (url, options) => {
    assert.equal(url, 'https://api2.skool.com/self');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Cookie, 'auth_token=synthetic-login; client_id=synthetic-client');
    return Response.json({ id: 'user-id', first_name: 'Test', last_name: 'Person', name: 'test-person', metadata: { secret: 'not-returned' } });
  });
  assert.equal(profile.displayName, 'Test Person');
  assert.equal(profile.identifier, '@test-person');
  assert.equal(profile.skoolUserId, 'user-id');
  assert.ok(!JSON.stringify(profile).includes('not-returned'));
});
test('rejects expired and conflicting login cookies', () => {
  assert.throws(() => sessionHeader(cookies.map(c => ({ ...c, expires: 1 }))), /expired/);
  assert.throws(() => sessionHeader([...cookies, { ...cookies[0], domain: '.skool.com', value: 'another-session' }]), /conflicting/);
});
test('rejected sessions, challenges, outages and malformed responses never become connected', async () => {
  for (const [status, invalidSession] of [[401, true], [403, false], [202, false], [429, false], [500, false], [302, true]]) {
    await assert.rejects(verifySkoolSession(cookies, async () => new Response('', { status })), (e) => e instanceof SessionError && e.invalidSession === invalidSession);
  }
  await assert.rejects(verifySkoolSession(cookies, async () => Response.json({})), /signed-in profile/);
  await assert.rejects(verifySkoolSession(cookies, async () => new Response('<html>challenge</html>')), /unexpected/);
  await assert.rejects(verifySkoolSession(cookies, async () => { throw new Error('private token must not leak'); }), (e) => !e.message.includes('private token'));
});

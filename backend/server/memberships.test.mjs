import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createMemberships, membershipPage } from './memberships.mjs';
import { encryptCookies } from './accounts.mjs';
import { ownerCollection } from './identity.mjs';

const group = (id, name = id) => ({ id, name, metadata: { display_name: `Community ${id}`, description: 'Description', total_members: 42, cover_small_url: 'https://assets.skool.com/cover.jpg', membership_model: 1, member: 'private survey data', owner: 'private owner data' } });
const payload = { groups: [group('joined'), group('pending'), group('admin')], members: [
  { group_id: 'joined', role: 'member', approved_at: '2026-10-20T00:00:00Z', metadata: { survey: 'private answers' } },
  { group_id: 'pending', role: 'pending' }, { group_id: 'admin', role: 'group-admin' },
], has_more: true };

test('memberships include pending requests with accurate status and expose only display data', () => {
  const result = membershipPage(payload, 100);
  assert.deepEqual(result.communities.map(c => c.id), ['joined', 'pending', 'admin']);
  assert.equal(result.communities[0].role, 'member');
  assert.equal(result.communities[0].membershipStatus, 'joined');
  assert.equal(result.communities[1].membershipStatus, 'pending');
  assert.equal(result.communities[0].coverUrl, 'https://assets.skool.com/cover.jpg');
  assert.equal(result.communities[0].price, 'Free');
  assert.equal(result.communities[0].joinedAt, '2026-10-20T00:00:00Z');
  assert.equal(result.hasMore, true);
  assert.equal(result.nextOffset, 103);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('metadata'), false);
});

test('pagination follows source rows even when all memberships are pending', () => {
  const result = membershipPage({ groups: [group('pending')], members: [{ group_id: 'pending', role: 'pending' }], has_more: true }, 5);
  assert.equal(result.communities.length, 1);
  assert.equal(result.communities[0].membershipStatus, 'pending');
  assert.equal(result.nextOffset, 6);
  assert.throws(() => membershipPage({ groups: [], members: [], has_more: true }, 0), /pagination/);
  assert.throws(() => membershipPage({ groups: [], has_more: false }, 0), /unexpected/);
  assert.deepEqual(membershipPage({ groups: [], members: [], has_more: false }, 0).communities, []);
});

test('membership reads enforce ownership and forward only approved cookies to Skool', async () => {
  const key = randomBytes(32), own = randomUUID(), foreign = randomUUID();
  const cookies = ['auth_token', 'client_id', 'aws-waf-token'].map(name => ({ name, value: 'synthetic', domain: '.skool.com', path: '/' }));
  const records = [{ _id: own, ownerId: 'alice', status: 'active', encryptedCookies: encryptCookies(cookies, key, own) }, { _id: foreign, ownerId: 'bob', status: 'active' }];
  const scoped = ownerCollection({ findOne: async query => records.find(row => row._id === query._id && row.ownerId === query.ownerId) }, 'alice');
  let calls = 0;
  const read = createMemberships(scoped, key, async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://api2.skool.com');
    assert.equal(url.pathname, '/self/groups');
    assert.equal(url.searchParams.get('offset'), '100');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(options.headers.Cookie, 'auth_token=synthetic; client_id=synthetic');
    assert.equal(options.redirect, 'manual');
    return Response.json(payload);
  });
  await assert.rejects(read(new URLSearchParams({ accountId: foreign })), /not found/);
  await assert.rejects(read(new URLSearchParams({ accountId: own, offset: '-1' })), /Invalid/);
  assert.equal(calls, 0);
  assert.equal((await read(new URLSearchParams({ accountId: own, offset: '100' }))).communities.length, 3);
  assert.equal(calls, 1);
});

test('read-only sync tries valid stored sessions even when their saved status is stale', async () => {
  const key = randomBytes(32), id = randomUUID();
  const encryptedCookies = encryptCookies(['auth_token', 'client_id'].map(name => ({ name, value: 'synthetic', domain: '.skool.com', path: '/' })), key, id);
  const read = createMemberships({ findOne: async () => ({ _id: id, status: 'unverified', encryptedCookies }) }, key, async () => Response.json(payload));
  assert.equal((await read(new URLSearchParams({ accountId: id }))).communities.length, 3);
  assert.deepEqual(membershipPage({ groups: [group('banned')], members: [{ group_id: 'banned', role: 'banned' }], has_more: false }, 0).communities, []);
});

test('expired sessions, redirects and rate limits are not treated as an empty membership list', async () => {
  const key = randomBytes(32), id = randomUUID();
  const encryptedCookies = encryptCookies(['auth_token', 'client_id'].map(name => ({ name, value: 'synthetic', domain: '.skool.com', path: '/' })), key, id);
  for (const status of [202, 302, 401, 403, 429]) {
    const read = createMemberships({ findOne: async () => ({ _id: id, status: 'active', encryptedCookies }) }, key, async () => new Response('', { status }));
    await assert.rejects(read(new URLSearchParams({ accountId: id })));
  }
});

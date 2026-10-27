import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscovery, discoveryQuery, createDiscovery } from './discovery.mjs';
import { encryptCookies } from './accounts.mjs';
import { randomBytes } from 'node:crypto';
const payload = { props: { pageProps: { renderData: { total: 31, categories: [{ id: 'a'.repeat(32), name: 'Tech' }], groups: Array.from({ length: 30 }, (_, i) => ({ group: { id: String(i), name: `group-${i}`, metadata: { displayName: `Group ${i}`, description: 'Real description', totalMembers: '42' } } })) } } } };
const html = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(payload) + '</script>';
test('discovery maps real community records and pagination without invented scores', () => {
  const result = parseDiscovery(html, 1);
  assert.equal(result.communities.length, 30);
  assert.equal(result.communities[0].members, 42);
  assert.equal(result.communities[0].url, 'https://www.skool.com/group-0');
  assert.equal(result.communities[0].matchScore, undefined);
  assert.equal(result.hasMore, true);
  assert.equal(parseDiscovery(html, 2).hasMore, false);
  assert.throws(() => parseDiscovery('<html>challenge</html>', 1), /unexpected/);
});
test('discovery queries cannot change the destination or request unbounded pages', () => {
  const { url } = discoveryQuery(new URLSearchParams({ q: 'https://evil.example/', category: 'a'.repeat(32), page: '2' }));
  assert.equal(url.origin, 'https://www.skool.com');
  assert.equal(url.searchParams.get('p'), '2');
  assert.throws(() => discoveryQuery(new URLSearchParams({ page: '101' })));
  assert.throws(() => discoveryQuery(new URLSearchParams({ category: '../self' })));
});

test('discovery forwards real price, privacy, sort and language parameters', () => {
  const { url } = discoveryQuery(new URLSearchParams({ price: 'free-trial', type: 'private', sort: 'top', language: 'english', page: '3' }));
  assert.equal(url.searchParams.get('pr'), 'free-trial');
  assert.equal(url.searchParams.get('ty'), 'private');
  assert.equal(url.searchParams.get('srt'), 'top-v2');
  assert.equal(url.searchParams.get('lang'), 'english');
  assert.equal(url.searchParams.get('p'), '3');
  assert.equal(discoveryQuery(new URLSearchParams({ q: 'AI', sort: 'top' })).url.searchParams.has('srt'), false);
  for (const params of [{ price: 'discount' }, { type: 'all-users' }, { sort: 'random' }, { language: 'english&pr=paid' }]) assert.throws(() => discoveryQuery(new URLSearchParams(params)), /filters/);
});

test('language options come from Skool discovery metadata', () => {
  const source = structuredClone(payload);
  source.props.pageProps.renderData.languages = [{ name: 'english', displayName: 'English' }, { name: 'japanese', displayName: 'Japanese' }, { name: '../invalid', displayName: 'Invalid' }];
  const result = parseDiscovery(`<script id="__NEXT_DATA__">${JSON.stringify(source)}</script>`, 1);
  assert.deepEqual(result.languages, [{ id: 'english', name: 'English' }, { id: 'japanese', name: 'Japanese' }]);
});

test('community cards map Skool images, review counts and minor-unit subscription pricing', () => {
  const source = structuredClone(payload);
  const meta = source.props.pageProps.renderData.groups[0].group.metadata;
  Object.assign(meta, { coverSmallUrl: 'https://assets.skool.com/cover.jpg', logoUrl: 'https://assets.skool.com/logo.jpg',
    reviewAverageRating: '5.0', reviewCount: 73, displayPrice: JSON.stringify({ currency: 'usd', amount: 24900, recurring_interval: 'month' }) });
  const parse = () => parseDiscovery(`<script id="__NEXT_DATA__">${JSON.stringify(source)}</script>`, 1).communities[0];
  assert.equal(parse().coverUrl, meta.coverSmallUrl);
  assert.equal(parse().logoUrl, meta.logoUrl);
  assert.equal(parse().rating, 5);
  assert.equal(parse().reviewCount, 73);
  assert.equal(parse().price, '$249/month');
  meta.displayPrice = JSON.stringify({ currency: 'usd', amount: 9950, recurring_interval: 'year' });
  assert.equal(parse().price, '$99.50/year');
  meta.displayPrice = JSON.stringify({ currency: 'usd', amount: 0 });
  assert.equal(parse().price, 'Free');
  Object.assign(meta, { coverSmallUrl: 'https://evil.example/cover.jpg', logoUrl: 'javascript:alert(1)', reviewAverageRating: '9', reviewCount: -1, totalMembers: null, displayPrice: '{invalid' });
  const invalid = parse();
  assert.equal(invalid.coverUrl, null);
  assert.equal(invalid.logoUrl, null);
  assert.equal(invalid.rating, null);
  assert.equal(invalid.reviewCount, null);
  assert.equal(invalid.members, null);
  assert.equal(invalid.price, null);
});
test('discovery uses only scoped account credentials and sends only approved login cookies', async () => {
  const key = randomBytes(32);
  const cookie = (name, value) => ({ name, value, domain: '.skool.com', path: '/' });
  const account = { _id: 'own-account', encryptedCookies: encryptCookies([cookie('auth_token', 'test-login'), cookie('client_id', 'test-client'), cookie('aws-waf-token', 'do-not-send')], key, 'own-account') };
  const discovery = createDiscovery({ findOne: async query => query._id === account._id ? account : null }, key, async (url, options) => {
    assert.equal(url.origin, 'https://www.skool.com');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Cookie, 'auth_token=test-login; client_id=test-client');
    return new Response(html);
  });
  await assert.rejects(discovery(new URLSearchParams({ accountId: 'another-users-account' })), /Connect a Skool account/);
  assert.equal((await discovery(new URLSearchParams({ accountId: 'own-account' }))).communities.length, 30);
});

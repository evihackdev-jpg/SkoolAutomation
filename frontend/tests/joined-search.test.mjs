import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesJoinedCommunity } from '../src/utils/joinedCommunitySearch.mjs';

const community = { name: 'The -999 Club Academy', url: 'https://www.skool.com/the-999clubacademy', description: 'Build your agency', memberships: [{ displayName: 'Adrian Knox', identifier: '@adrian-knox-1234' }] };

test('joined community search matches Skool slugs, URLs and account names regardless of spacing', () => {
  for (const query of ['the-999clubacademy', 'The -999 Club Academy', '999club', community.url, 'adrianknox', 'Adrian Knox', '@adrian-knox-1234', 'agency', '']) {
    assert.equal(matchesJoinedCommunity(community, query), true, query);
  }
  assert.equal(matchesJoinedCommunity(community, 'another-community'), false);
  assert.equal(matchesJoinedCommunity(community, 'Michael Line'), false);
});

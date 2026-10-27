import { decryptCookies } from './accounts.mjs';
import { InputError } from './cookies.mjs';
import { communityRecord } from './discovery.mjs';
import { SessionError, sessionHeader } from './skool.mjs';

export function membershipPage(data, offset) {
  if (!Array.isArray(data?.groups) || !Array.isArray(data?.members) || typeof data.has_more !== 'boolean') throw new SessionError('Skool returned an unexpected membership list.', 502, false);
  const active = new Map(data.members.filter(member => ['member', 'group-admin', 'group-moderator', 'pending'].includes(member.role)).map(member => [member.group_id, member]));
  const communities = data.groups.flatMap(group => {
    const member = active.get(group.id);
    const community = communityRecord(group);
    if (!member || !community) return [];
    return [{ ...community, role: member.role, membershipStatus: member.role === 'pending' ? 'pending' : 'joined', joinedAt: typeof member.approved_at === 'string' && Number.isFinite(Date.parse(member.approved_at)) ? member.approved_at : null }];
  });
  if (data.has_more && !data.groups.length) throw new SessionError('Skool returned incomplete membership pagination. Please retry.', 502, false);
  return { communities, hasMore: data.has_more, nextOffset: offset + data.groups.length };
}

export function createMemberships(collection, key, fetcher = fetch) {
  return async params => {
    const accountId = params.get('accountId');
    const offset = Number(params.get('offset') || 0);
    if (!/^[a-f0-9-]{36}$/i.test(accountId || '') || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new InputError('Invalid membership account or page.');
    const account = await collection.findOne({ _id: accountId });
    if (!account) throw new SessionError('Account not found.', 404, false);
    const approved = decryptCookies(account.encryptedCookies, key, account._id).filter(cookie => ['auth_token', 'client_id'].includes(cookie.name));
    const url = new URL('https://api2.skool.com/self/groups');
    url.search = new URLSearchParams({ offset: String(offset), limit: '100', members: 'true' }).toString();
    let response;
    try { response = await fetcher(url, { headers: { Cookie: sessionHeader(approved), Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
    catch(error) { if (error instanceof SessionError) throw error; throw new SessionError('Could not load memberships from Skool. Please retry.', 502, false); }
    if (response.status === 429) throw new SessionError('Skool is rate-limiting membership requests. Try again shortly.', 429, false);
    if (!response.ok || response.status === 202) throw new SessionError('Skool could not load memberships. Check this account’s login cookies and any browser checks.', 502, false);
    let data;
    try { data = await response.json(); } catch { throw new SessionError('Skool returned an unreadable membership list.', 502, false); }
    return membershipPage(data, offset);
  };
}

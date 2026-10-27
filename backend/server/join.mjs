import { decryptCookies } from './accounts.mjs';
import { InputError } from './cookies.mjs';
import { sessionHeader, SessionError } from './skool.mjs';
import { randomInt } from 'node:crypto';

const inFlight = new Map();
const fail = (message, status = 502) => new SessionError(message, status, false);

export function createRandomAccount(collection, choose = randomInt) {
  return async body => {
    if (typeof body?.groupName !== 'string' || !/^[a-z0-9_-]{1,150}$/i.test(body.groupName)) throw new InputError('Select a valid community.');
    const accounts = await collection.find({ status: 'active' }, { projection: { _id: 1, displayName: 1 } }).toArray();
    if (!accounts.length) throw fail('Connect a Skool account before joining.', 422);
    const selected = accounts[choose(accounts.length)];
    const account = { id: selected._id, displayName: selected.displayName };
    // Selection is separate from joining. The client learns the account before
    // any membership mutation, including when the later request times out.
    return { account };
  };
}

export function parseJoinPage(html, groupName) {
  let props;
  try { props = JSON.parse(html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)?.[1]).props.pageProps; } catch { /* validated below */ }
  if (props?.currentGroup?.name !== groupName || !props.currentGroup.metadata || !props.self?.id) {
    throw fail('Could not verify this community and your signed-in membership. Open it on Skool or refresh your account cookies.');
  }
  return { group: props.currentGroup, member: props.self.member, self: props.self };
}

function membershipResult(member, url) {
  if (['member', 'group-admin', 'group-moderator'].includes(member?.role)) return { status: 'joined', message: 'You are a member of this community.', url };
  if (member?.role === 'pending') return { status: 'pending', message: 'Your membership request is awaiting approval.', url };
  if (member?.role) return { status: 'action_required', message: 'This membership needs attention on Skool.', url };
  return null;
}

export function createMembershipCheck(collection, key, fetcher = fetch) {
  return async params => {
    const accountId = params.get('accountId'), groupName = params.get('groupName');
    if (!/^[a-f0-9-]{36}$/i.test(accountId || '') || !/^[a-z0-9_-]{1,150}$/i.test(groupName || '')) throw new InputError('Select an account and valid community.');
    const account = await collection.findOne({_id:accountId});
    if (!account) throw fail('Account not found.',404);
    const cookies = decryptCookies(account.encryptedCookies,key,account._id).filter(c=>['auth_token','client_id'].includes(c.name));
    const url = `https://www.skool.com/${groupName}/about`;
    let response;
    try { response = await fetcher(url,{headers:{Cookie:sessionHeader(cookies)},redirect:'manual',signal:AbortSignal.timeout(10000)}); }
    catch { throw fail('Could not check the current membership. Automatic checking will continue.'); }
    if (response.status === 429) throw fail('Skool is rate-limiting membership checks.',429);
    if (!response.ok || response.status === 202) throw fail('Could not verify the current membership.');
    const {member} = parseJoinPage(await response.text(),groupName);
    return membershipResult(member,url) || {status:'unconfirmed',message:'Membership is not yet confirmed.',url};
  };
}

export function automaticJoinPlan(meta) {
  if (meta.lockdown) return { allowed: false, reason: 'This community is closed to new members. An invitation or owner action is required.' };
  if (meta.membershipModel === 1) return { allowed: true, name: 'Free' };
  if (meta.membershipModel === 3) return { allowed: true, name: 'Standard (free)' };
  // Skool's legacy groups predate membershipModel. Its own client treats them
  // as free only when there are no current monthly, annual or one-time products.
  if ((meta.membershipModel === undefined || meta.membershipModel === null || meta.membershipModel === 0) && !meta.currentMBp && !meta.currentABp && !meta.currentOtBp) return { allowed: true, name: 'Free' };
  if ([2, 4, 5].includes(meta.membershipModel) || meta.currentMBp || meta.currentABp || meta.currentOtBp) return { allowed: false, reason: 'This community has no automatic free join option. A paid plan or trial requires checkout on Skool.' };
  return { allowed: false, reason: 'Skool returned an unrecognized membership type. Open the community to review its join options.' };
}

export function createJoin(collection, key, fetcher = fetch, answerSurvey, { wait = ms => new Promise(resolve => setTimeout(resolve,ms)) } = {}) {
  return async body => {
    if (!body || typeof body.accountId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.accountId) || typeof body.groupName !== 'string' || !/^[a-z0-9_-]{1,150}$/i.test(body.groupName)) throw new InputError('Select an account and a valid community.');
    const account = await collection.findOne({ _id: body.accountId });
    if (!account) throw fail('Account not found.', 404);
    if (account.status !== 'active') throw fail('Verify your Skool account in Accounts before joining.', 422);
    const lock = `${account._id}:${body.groupName}`;
    if (inFlight.has(lock)) return inFlight.get(lock);
    const operation = (async () => {
      const approvedCookies = decryptCookies(account.encryptedCookies, key, account._id).filter(cookie => ['auth_token', 'client_id'].includes(cookie.name));
      const headers = { Cookie: sessionHeader(approvedCookies) };
      const url = `https://www.skool.com/${body.groupName}/about`;
      const readPage = async () => {
        let response;
        try { response = await fetcher(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(7000) }); }
        catch { throw fail('Could not check your membership. Open the community on Skool before trying again.'); }
        if (!response.ok || response.status === 202) throw fail('Skool could not check your membership. Open Skool to complete any login or browser check.', response.status === 429 ? 429 : 502);
        return parseJoinPage(await response.text(), body.groupName);
      };
      const verify = async (answered = false, plan) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await wait(attempt * 500);
          try {
            const after = await readPage();
            const membership = membershipResult(after.member, url);
            if (membership?.status === 'joined') return { ...membership, message: `${answered ? 'Membership questions answered. ' : ''}Joined automatically on the ${plan?.name || 'free'} plan.`, ...(plan ? {plan:plan.name} : {}) };
            if (membership?.status === 'pending') {
              const enabled = [true,1,'1','true'].includes(after.group.metadata.surveyEnabled);
              if (!enabled || after.member?.metadata?.survey || answered) return { ...membership, message: `${answered ? 'Membership questions answered. ' : ''}Your request is awaiting the community owner’s approval.` };
            } else if (membership) return membership;
          } catch (error) { if (error.status === 429) throw error; }
        }
        return { status:'unconfirmed', message:'Your membership request is being checked. Automatic retries will verify its status.', url };
      };
      const before = await readPage();
      const existing = membershipResult(before.member, url);
      const surveyEnabled = [true,1,'1','true'].includes(before.group.metadata.surveyEnabled);
      const unfinishedSurvey = before.member?.role === 'pending' && surveyEnabled && !before.member?.metadata?.survey;
      if (existing && !unfinishedSurvey) return existing;
      const meta = before.group.metadata;
      const plan = automaticJoinPlan(meta);
      if (!plan.allowed) return { status: 'action_required', code: 'free_join_unavailable', message: plan.reason, url };
      // Skool's Join Standard button for Freemium calls the same free join
      // action, with no billing product or payment endpoint.
      const sendJoin = async () => {
        return fetcher(`https://api2.skool.com/groups/${body.groupName}/join-group`, {
          method: 'POST', headers: { ...headers, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(7000),
        });
      };
      let response;
      try { response = await sendJoin();
      } catch { return verify(false, plan); }
      if (response.status === 429) throw fail('Skool is rate-limiting join requests. Wait before trying again.', 429);
      if (response.status === 202 || (!response.ok && response.status !== 409)) throw fail('Skool could not complete the join request. Open the community to check any login, questions, or restrictions.');
      let result;
      try { result = await response.json(); } catch { /* Verify the membership independently below. */ }
      let answered = false;
      if (result?.needs_survey || result?.needsSurvey || unfinishedSurvey || (surveyEnabled && !before.member?.metadata?.survey)) {
        if (!answerSurvey) return { status: 'action_required', message: 'AI membership answers are not configured on the backend.', url };
        const answers = await answerSurvey({ group: before.group, self: before.self, facts: body.facts });
        if (answers.missing.length) return { status: 'action_required', message: `Profile details needed: ${answers.missing.join(' ')}`, missingQuestions: answers.missing, url };
        if (!/^[a-f0-9]{32}$/i.test(before.group.id)) throw fail('Skool returned an invalid community ID.');
        let submitted;
        try {
          submitted = await fetcher(`https://api2.skool.com/groups/${before.group.id}/submit-survey-answers`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ survey: answers.survey }), redirect: 'manual', signal: AbortSignal.timeout(7000),
          });
        } catch { return verify(false, plan); }
        if (!submitted.ok || submitted.status === 202) throw fail('Skool did not accept the membership answers. Review this community’s requirements.', submitted.status === 429 ? 429 : 502);
        answered = true;
        try {
          const followup = await sendJoin();
          if (followup.status === 429) throw fail('Skool is rate-limiting join requests. Automatic retries will wait for the cooldown.',429);
          // A rejected or lost follow-up is not proof that membership failed.
          // Read the actual member role before deciding the outcome.
        } catch (error) { if (error.status === 429) throw error; }
      }
      return verify(answered, plan);
    })();
    inFlight.set(lock, operation);
    try { return await operation; } finally { inFlight.delete(lock); }
  };
}

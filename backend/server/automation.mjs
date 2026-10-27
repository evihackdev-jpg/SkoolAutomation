import { randomInt, randomUUID, createHash } from 'node:crypto';
import { InputError } from './cookies.mjs';
import { SessionError } from './skool.mjs';
import { objectSchema, stringSchema } from './ai.mjs';
import { goalValidationMessage } from './goal-validation.mjs';
import { membershipFacts } from './profile-settings.mjs';
import { defaultPostCategory } from './post-category.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const errorMessage = error => error instanceof SessionError || error instanceof InputError ? error.message : 'This step failed. Check the backend connection before starting another run.';
const slug = community => {
  const url = new URL(community.url);
  const name = url.pathname.split('/')[1];
  if (url.protocol !== 'https:' || url.hostname !== 'www.skool.com' || !/^[a-z0-9_-]{1,150}$/i.test(name)) throw new InputError('Invalid community URL.');
  return name;
};
export function validateRun(body) {
  if (!body || typeof body !== 'object') throw new InputError('Enter your post.');
  if (typeof body.discover !== 'boolean' || typeof body.existing !== 'boolean' || (!body.discover && !body.existing)) throw new InputError('Choose new communities, joined communities, or both.');
  const postingMode = body.postingMode ?? 'count';
  if (!['count','interval'].includes(postingMode)) throw new InputError('Choose a post count or timed interval.');
  if (postingMode === 'count' && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 20)) throw new InputError('Choose between 1 and 20 posts per run.');
  if (postingMode === 'interval' && (!Number.isInteger(body.intervalMinutes) || body.intervalMinutes < 1 || body.intervalMinutes > 1440)) throw new InputError('Choose a posting interval of 1–1,440 whole minutes.');
  let post = null;
  if (body.post !== undefined && body.post !== null) {
    const draft = body.post;
    if (typeof draft !== 'object' || Array.isArray(draft) || typeof draft.refineWithAI !== 'boolean') throw new InputError('Choose whether AI should refine your post.');
    if (typeof draft.title !== 'string' || !draft.title.trim() || draft.title.length > 150 || /[\x00-\x1f]/.test(draft.title)) throw new InputError('Enter a post title of 1–150 characters without line breaks.');
    if (typeof draft.content !== 'string' || !draft.content.trim() || draft.content.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(draft.content)) throw new InputError('Enter post content of 1–10,000 characters.');
    if (/(?:obj:\/\/|@everyone\b|@all\b|<script\b)/i.test(draft.title + '\n' + draft.content)) throw new InputError('Post text cannot contain scripts, mass mentions, or internal attachment URLs.');
    post = { title: draft.title, content: draft.content, refineWithAI: draft.refineWithAI };
  }
  const postOnly = body.goal === undefined;
  let goal;
  if (postOnly) {
    if (!post) throw new InputError('Enter both a title and content for your post.');
    goal = `${post.title}\n${post.content}`.slice(0,2000);
  } else {
    if (typeof body.goal !== 'string' || body.goal.trim().length < 10 || body.goal.length > 2000) throw new InputError('Describe your goal in 10–2,000 characters.');
    const goalError = goalValidationMessage(body.goal);
    if (goalError) throw new InputError(goalError);
    goal = body.goal.trim();
  }
  return { goal, discover: body.discover, existing: body.existing, postingMode, limit: postingMode === 'count' ? body.limit : null, intervalMinutes: postingMode === 'interval' ? body.intervalMinutes : null, post, postOnly };
}
export function validateFacts(facts, accountIds) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw new InputError('Invalid account details.');
  const result = {};
  for (const [id, data] of Object.entries(facts)) {
    if (!accountIds.includes(id)) throw new InputError('Account not found in this workspace.');
    if (!data || typeof data !== 'object' || typeof data.city !== 'string' || data.city.length > 200 || !['','Beginner','Intermediate','Advanced','Professional'].includes(data.skill)) throw new InputError('Choose a valid skating level and city.');
    result[id] = { ...(data.city.trim() ? { city: data.city.trim() } : {}), ...(data.skill ? { skill: data.skill } : {}) };
  }
  return result;
}
const publicRun = run => {
  if (!run) return null;
  const { ownerId, active, goalHash, ...data } = run;
  return { ...data, id: run._id };
};

export function createAutomation({ runs, publications, settings, ownerId, accounts, discovery, memberships, join, publishing, ai, configured = true, choose = randomInt, schedule = task => setImmediate(task), defer = (task, ms) => { const timer = setTimeout(task, ms); timer.unref?.(); return timer; }, retryDelayMs = 60000, cooldownMs = 900000, now = () => Date.now() }) {
  const queued = new Set(), executing = new Set();
  const enqueue = (run, delay = 0) => {
    if (queued.has(run._id)) return;
    queued.add(run._id);
    const task = async () => {
      queued.delete(run._id);
      if (executing.has(run._id)) return;
      executing.add(run._id);
      try {
        const saved = await runs.findOne({ _id: run._id, ownerId });
        if (saved?.active) await execute(saved);
      } catch { enqueue(run, cooldownMs); }
      finally { executing.delete(run._id); }
    };
    if (delay) defer(task, delay); else schedule(task);
  };
  const owned = () => accounts.find({}).toArray();
  const runQuery = id => ({ _id: id, ownerId });
  const cancelled = async id => {
    const run = await runs.findOne(runQuery(id));
    return !run || run.cancelRequested === true;
  };
  const update = async (run, values) => {
    await runs.updateOne(runQuery(run._id), { $set: { ...values, updatedAt: new Date() } });
    Object.assign(run, values);
  };
  const execute = async run => {
    const timed = run.postingMode === 'interval';
    const target = timed ? Infinity : run.limit;
    const log = async (message, extra = {}) => {
      run.events.push({ at: new Date(), message, ...extra });
      await update(run, { events: run.events.slice(-150) });
    };
    const stop = async () => {
      if (!(await cancelled(run._id))) return false;
      await update(run, { status: 'stopped', active: false, stage: 'Stopped', finishedAt: new Date() });
      return true;
    };
    const askAI = async (stage, task, data, schema, maxTokens) => {
      await update(run, { stage });
      await log(stage);
      return ai(task, data, schema, { maxTokens, shouldRetry: async () => !(await cancelled(run._id)),
        onRetry: async ({ reason, attempt, maxAttempts = 3 }) => { await log(`${stage}: ${reason} Retrying AI (attempt ${attempt} of ${maxAttempts}) using compatible JSON mode.`); },
      });
    };
    const waitForRetry = async (reason, delay = retryDelayMs) => {
      if (await stop()) return;
      const published = run.results.filter(r => r.status === 'published').length;
      const stage = `${timed ? `Published ${published}.` : `Published ${published} of ${run.limit}.`} ${reason}`;
      await log(stage);
      await update(run, { status: 'waiting', active: true, waitReason: 'retry', stage, nextAttemptAt: new Date(now() + delay), round: (run.round || 0) + 1 });
      enqueue(run, delay);
    };
    const waitForNextPost = async () => {
      if (await stop()) return;
      const next = new Date(run.nextPostAt);
      await update(run, { status: 'waiting', active: true, waitReason: 'interval', stage: `Published ${run.results.filter(r => r.status === 'published').length}. Next post scheduled; continues until you stop it.`, nextAttemptAt: next });
      enqueue(run, Math.max(0, next.getTime() - now()));
    };
    try {
      if (await stop()) return;
      await update(run, { status: 'running', nextAttemptAt: null, waitReason: null, failedStage: null, stage: 'Checking publication progress' });
      // Receipts are authoritative after a restart or failed result persistence.
      const receipts = await publications.find({ ownerId, runId: run._id }).toArray();
      for (const receipt of receipts) {
        if (await stop()) return;
        let result = receipt;
        if (['sending','unconfirmed'].includes(receipt.status) && publishing.reconcile) {
          result = await publishing.reconcile(receipt);
          if (result.status === 'published') await publications.updateOne({ _id: receipt._id, ownerId }, { $set: { ...result, publishedAt: new Date(), updatedAt: new Date() } });
        }
        const item = run.results.find(r => r.groupName === receipt.groupName);
        if (item && result.status === 'published') {
          if (item.status !== 'published') await log(`${item.name}: Publication verified.`, { outcome: 'success', groupName: item.groupName });
          Object.assign(item, { status: 'published', message: result.message || 'Publication verified.', ...(result.url ? {url:result.url} : {}), ...(result.postId ? {postId:result.postId} : {}) });
        } else if (item && receipt.status === 'blocked') {
          Object.assign(item, { status: 'blocked', publicationAttempted: false, rateLimited: Boolean(receipt.rateLimited), message: receipt.message || 'Post rejected by Skool.' });
        } else if (item && ['sending','unconfirmed'].includes(receipt.status)) {
          Object.assign(item, { status: 'unconfirmed', publicationAttempted: true, message: 'Checking whether Skool accepted this post. It will not be resent.' });
        }
      }
      await update(run, { results: run.results });
      let publicationSlots = run.results.filter(r => r.status === 'published' || (r.status === 'unconfirmed' && (r.publicationAttempted || r.article))).length;
      if (timed) {
        // Recover the cadence from durable receipts even if the worker stopped
        // between the external request and saving the run's result.
        const latestAttempt = receipts.reduce((latest, r) => ['sending','unconfirmed','published'].includes(r.status) && Number.isFinite(new Date(r.createdAt).getTime()) ? Math.max(latest, new Date(r.createdAt).getTime()) : latest, 0);
        if (latestAttempt) await update(run, { nextPostAt: new Date(Math.max(new Date(run.nextPostAt || 0).getTime(), latestAttempt + run.intervalMinutes * 60000)) });
        if (publicationSlots > run.results.filter(r => r.status === 'published').length) { await waitForRetry('Waiting to verify the last post before sending another.', cooldownMs); return; }
        if (new Date(run.nextPostAt || 0).getTime() > now()) { await waitForNextPost(); return; }
      }
      if (run.results.filter(r => r.status === 'published').length === target) {
        await update(run, { status: 'completed', active: false, stage: `Published ${run.limit} of ${run.limit}. Target reached.`, nextAttemptAt: null, finishedAt: new Date() }); return;
      }
      if (publicationSlots >= target) { await waitForRetry('Waiting to verify unconfirmed posts before sending any more.', cooldownMs); return; }
      const all = await owned();
      const active = all.filter(a => a.status === 'active');
      if (!active.length) throw new InputError('Connect and verify a Skool account first.');
      const candidates = new Map();
      const add = (community, account) => {
        const name = slug(community);
        const prior = candidates.get(name) || { ...community, groupName: name, accounts: [] };
        if (account && !prior.accounts.some(a => a.id === account._id)) prior.accounts.push({ id: account._id, displayName: account.displayName });
        candidates.set(name, prior);
      };
      // Always read current memberships: discovery must not choose a different
      // account for a community already joined in this private workspace.
      await update(run, { stage: 'Syncing your accounts' });
      for (const account of all) {
        if (await stop()) return;
        let offset = 0;
        try {
          for (let page = 0; ; page++) {
            if (await stop()) return;
            const result = await memberships(new URLSearchParams({ accountId: account._id, offset: String(offset) }));
            for (const community of result.communities) if (community.membershipStatus === 'joined') add(community, account);
            if (!result.hasMore) break;
            if (page >= 99 || result.nextOffset <= offset) throw new InputError('Membership sync exceeded its page limit.');
            offset = result.nextOffset;
          }
        } catch (error) { if (error.status === 429) throw error; await log(`${account.displayName}: ${errorMessage(error)}`); }
      }
      // The user explicitly replaced the prior skip-prohibited-destinations
      // requirement and approved removing BOTH relevance and community-rule
      // filters on 2026-10-27. Destination eligibility is now limited to the
      // selected sources, confirmed membership, and actual Skool permissions.
      if (run.discover) {
        if (await stop()) return;
        const queries = [''];
        await update(run, { queries, stage: 'Finding suitable communities' });
        for (const q of queries) {
          if (await stop()) return;
          try {
            const cursor = run.searchPages?.[hash(q)] || 1;
            for (let page = cursor; page <= Math.min(cursor + 1, 100); page++) {
              const result = await discovery(new URLSearchParams({ q, page: String(page), price: 'free', language: 'all' }));
              result.communities.forEach(c => add(c));
              await update(run, { searchPages: { ...run.searchPages, [hash(q)]: result.hasMore && page < 100 ? page + 1 : 1 } });
              if (!result.hasMore || await cancelled(run._id)) break;
            }
          } catch (error) { if (error.status === 429) throw error; await log(`Search “${q}”: ${errorMessage(error)}`); }
        }
      }
      if (await stop()) return;
      const eligible = [...candidates.values()].filter(c => {
        if (!(c.accounts.length ? run.existing : run.discover)) return false;
        const prior = run.results.find(r => r.groupName === c.groupName);
        if (!prior) return true;
        if (prior.rateLimited) return !prior.nextCheckAt || new Date(prior.nextCheckAt).getTime() <= Date.now();
        if (prior.status === 'skipped' && !prior.publicationAttempted && prior.selectionVersion !== 2) return true;
        if (['published','blocked','skipped'].includes(prior.status) || prior.publicationAttempted || (prior.status === 'unconfirmed' && prior.article)) return false;
        return !prior.nextCheckAt || new Date(prior.nextCheckAt).getTime() <= Date.now();
      });
      await log(`Queued ${eligible.length} communities without relevance or content-rule filtering.`);
      await update(run, { stage: 'Preparing selected communities', matching: null, selectionMode: 'all', selectionCount: eligible.length });
      if (await stop()) return;
      const selected = eligible.sort((a,b) => Number(b.accounts.length > 0) - Number(a.accounts.length > 0));
      let rateLimited = false;
      await log(timed ? `Trying ${selected.length} communities for the next scheduled post.` : `Trying ${selected.length} communities until ${run.limit} posts are confirmed.`);
      for (const community of selected) {
        if (await stop()) return;
        if (publicationSlots >= target) break;
        const pool = community.accounts.length ? community.accounts : active.map(a => ({ id: a._id, displayName: a.displayName }));
        const previousAccount = run.results.find(r => r.groupName === community.groupName)?.account;
        const account = pool.find(a => a.id === previousAccount?.id) || pool[choose(pool.length)];
        const item = { groupName: community.groupName, name: community.name, url: community.url, selectionVersion: 2, reason: 'Selected without relevance filtering.', account, source: community.accounts.length ? 'joined' : 'discovered', status: 'preparing', message: 'Checking membership' };
        const previous = run.results.findIndex(r => r.groupName === community.groupName);
        if (previous >= 0) run.results[previous] = item; else run.results.push(item);
        const save = async () => update(run, { results: run.results });
        const moveOn = async () => { item.nextCheckAt = new Date(Date.now() + cooldownMs); await save(); await log(`${community.name}: ${item.message} Continuing to the next relevant community, if available.`); };
        await save();
        const publicationKey = hash(`${ownerId}\n${community.groupName}\n${run.goalHash}`);
        let publicationStarted = false;
        try {
          let previousReceipt = await publications.findOne({ _id: publicationKey, ownerId });
          // A confirmed HTTP 429 rejection has no post to duplicate. Retry only
          // after the run's cooldown, never by switching accounts mid-request.
          if (previousReceipt?.runId === run._id && previousReceipt.status === 'blocked' && previousReceipt.rateLimited) {
            await publications.deleteOne({ _id: publicationKey, ownerId, status: 'blocked', rateLimited: true });
            previousReceipt = null;
          }
          if (previousReceipt) {
            Object.assign(item, { status: 'skipped', message: 'This goal already has a publication attempt in this community. It will not be posted twice.' }); await moveOn(); continue;
          }
          if (!community.accounts.length) {
            await update(run, { stage: `Joining ${community.name}` });
            const membership = await join({ accountId: account.id, groupName: community.groupName, facts: membershipFacts(await settings.findOne({ _id: ownerId }), account.id) });
            if (membership.status !== 'joined') { Object.assign(item, { status: membership.status, message: membership.message }); await moveOn(); continue; }
          }
          if (await stop()) return;
          const asIs = run.post?.refineWithAI === false;
          await update(run, { stage: `${asIs ? 'Checking your post for' : 'Writing for'} ${community.name}` });
          const context = await publishing.prepare({ accountId: account.id, groupName: community.groupName });
          if (await stop()) return;
          const category = defaultPostCategory(context.labels);
          if (!category) throw new InputError('No member-writable posting category is available.');
          let article;
          if (asIs) {
            article = { labelId: category.id, title: run.post.title, content: run.post.content };
          } else {
            const writingTask = run.post
              ? 'Refine the supplied title and content for clarity and fit with this community. Preserve the user’s intent, facts, numbers, compensation, links, and contact details. Do not invent details or turn a hiring request into a job application. Keep the title within 150 characters and content within 10,000 characters. Use plain text without HTML or mass mentions. '
              : 'Write an original, useful 200–400 word article for the user’s goal. Use plain text with short paragraphs, no Markdown or HTML, no links or mentions, and no invented personal experiences or claims. ';
            article = await askAI(`${run.post ? 'Refining your post' : 'Writing'} for ${community.name}`, writingTask + 'The destination and posting category are already selected by the user. Only return the title and content; do not evaluate relevance, select a category, or return a suitability decision.',
              { goal: run.goal, ...(run.post ? { draft: { title: run.post.title, content: run.post.content } } : {}), community: { name: context.name, category: { name: category.name } } },
              objectSchema({ title: stringSchema, content: stringSchema }), run.post ? 4000 : 2000);
          }
          article.labelId = category.id;
          if (typeof article.title !== 'string' || article.title.length > 150 || !article.title.trim() || typeof article.content !== 'string' || !article.content.trim() || article.content.length < (run.post ? 1 : 80) || article.content.length > 10000 || !context.labels.some(l => l.id === article.labelId) || /(?:obj:\/\/|@everyone\b|@all\b|<script\b)/i.test(article.title + '\n' + article.content) || (!run.post && /https?:\/\//i.test(article.content))) throw new InputError('The post or category is invalid. Nothing was published.');
          Object.assign(item, { article: { title: article.title, content: article.content }, categoryId: category.id, categoryName: category.name, postMode: asIs ? 'as_is' : run.post ? 'refined' : 'generated', status: 'ready', message: `Article ready for ${category.name}` });
          await save();
          if (await stop()) return;
          // Persist before the side effect. Uncertain outcomes and restarts never
          // cause a retry that could duplicate a real external post.
          try { await publications.insertOne({ _id: publicationKey, ownerId, runId: run._id, accountId: account.id, accountName: account.displayName, groupName: community.groupName, communityName: community.name, categoryName: category.name, postMode: item.postMode, context: { groupId: context.groupId, groupName: context.groupName, authorId: context.authorId }, article: { title: article.title, content: article.content }, status: 'sending', createdAt: new Date(now()) }); }
          catch (error) { if (error.code !== 11000) throw error; Object.assign(item, { status: 'skipped', message: 'A publication for this goal already exists.' }); await save(); continue; }
          if (await cancelled(run._id)) { await publications.deleteOne({ _id: publicationKey, ownerId, status: 'sending' }); await stop(); return; }
          await update(run, { stage: `Publishing in ${community.name}`, ...(timed ? { nextPostAt: new Date(now() + run.intervalMinutes * 60000) } : {}) });
          publicationStarted = true;
          item.publicationAttempted = true;
          // Reserve a slot before sending: a lost response may still mean a post exists.
          publicationSlots++;
          const result = await publishing.publish({ accountId: account.id, context, article });
          await publications.updateOne({ _id: publicationKey, ownerId }, { $set: { ...result, ...(result.status === 'published' ? { publishedAt: new Date() } : {}), updatedAt: new Date() } });
          Object.assign(item, result); await save();
          await log(`${community.name}: ${result.message}`, { outcome: result.status === 'published' ? 'success' : 'unsuccessful', groupName: community.groupName });
          if (result.status === 'blocked') publicationSlots--;
          if (timed && result.status === 'blocked') await update(run, { nextPostAt: null });
          if (result.rateLimited) { rateLimited = true; item.nextCheckAt = new Date(Date.now() + cooldownMs); await save(); break; }
          if (timed && result.status === 'published') { await waitForNextPost(); return; }
          if (timed && result.status !== 'blocked') break;
          if (result.status === 'blocked') await log('Trying the next relevant community after the rejected post.');
        } catch (error) {
          Object.assign(item, { status: publicationStarted ? 'unconfirmed' : 'error', failedStage: run.stage, message: publicationStarted ? 'Publication could not be confirmed. A post slot is reserved; this article will not be resent automatically.' : errorMessage(error) });
          if (error.status === 429) { rateLimited = true; await save(); break; }
          await moveOn();
          if (timed && publicationStarted) break;
        }
      }
      if (await stop()) return;
      const published = run.results.filter(r => r.status === 'published').length;
      if (published === target) {
        const stage = `Published ${published} of ${run.limit}. Target reached.`;
        await log(stage);
        await update(run, { status: 'completed', active: false, stage, nextAttemptAt: null, finishedAt: new Date() });
      } else {
        const uncertain = timed ? publicationSlots > published : publicationSlots >= target;
        const reason = rateLimited ? 'Skool is rate-limiting requests; cooling down before retrying.' : uncertain ? 'Waiting to verify unconfirmed posts before sending any more.' : timed ? 'Searching again for the next scheduled post.' : 'Searching again for the remaining posts.';
        await waitForRetry(reason, rateLimited || uncertain ? cooldownMs : Math.min(cooldownMs, retryDelayMs * 2 ** Math.min(run.round || 0, 4)));
      }
    } catch (error) {
      if (await stop()) return;
      const failedStage = run.stage;
      await log(`${failedStage}: ${errorMessage(error)}`);
      await update(run, { failedStage });
      await waitForRetry(`${errorMessage(error)} Retrying automatically.`, error.status === 429 || error.retryable === false ? cooldownMs : retryDelayMs);
    }
  };
  return {
    async resume(run) {
      if (run.ownerId !== ownerId || !run.active) return;
      enqueue(run, Math.max(0, new Date(run.nextAttemptAt || 0).getTime() - now()));
    },
    async list() {
      return { runs: (await runs.find({ ownerId }).sort({ createdAt: -1 }).limit(20).toArray()).map(publicRun), configured };
    },
    async clearHistory() {
      // Keep the publication journal: clearing history must never enable duplicate posts.
      const result = await runs.deleteMany({ ownerId, active: false });
      return { cleared: result.deletedCount };
    },
    async saveFacts(body) {
      const facts = validateFacts(body?.facts, (await owned()).map(a => a._id));
      await settings.updateOne({ _id: ownerId }, { $set: { facts, updatedAt: new Date() } }, { upsert: true });
      return { facts };
    },
    async start(body) {
      if (!configured) throw new InputError('Configure OPENROUTER_API_KEY on the backend first.');
      const input = validateRun(body);
      if (!(await owned()).some(a => a.status === 'active')) throw new InputError('Connect and verify a Skool account first.');
      const run = { _id: randomUUID(), ownerId, ...input, goalHash: hash(input.postOnly ? JSON.stringify([input.post.title,input.post.content]) : input.goal.toLowerCase().replace(/\s+/g,' ')), active: true, status: 'queued', stage: 'Waiting to start', cancelRequested: false, results: [], events: [], createdAt: new Date(), updatedAt: new Date() };
      try { await runs.insertOne(run); } catch (error) { if (error.code === 11000) throw new InputError('A run is already active in this workspace. Stop it or wait for it to finish.'); throw error; }
      enqueue(run);
      return { run: publicRun(run) };
    },
    async stop(id) {
      const waiting = await runs.updateOne({ ...runQuery(id), active: true, status: 'waiting' }, { $set: { cancelRequested: true, active: false, status: 'stopped', stage: 'Stopped by you.', nextAttemptAt: null, finishedAt: new Date() } });
      if (waiting.matchedCount) return { stopped: true };
      const result = await runs.updateOne({ ...runQuery(id), active: true }, { $set: { cancelRequested: true, updatedAt: new Date() } });
      if (!result.matchedCount && !(await runs.findOne(runQuery(id)))) throw new InputError('Run not found in this workspace.');
      return { stopped: true };
    },
  };
}

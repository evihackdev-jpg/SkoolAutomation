import { InputError } from './cookies.mjs';

const pageSize = 30;
const validSlug = value => typeof value === 'string' && /^[a-z0-9_-]{1,150}$/i.test(value);
const cursorFor = receipt => Buffer.from(JSON.stringify({ at: new Date(receipt.createdAt).toISOString(), id: receipt._id })).toString('base64url');

export function createPublishedPosts({ publications, accounts, runs, ownerId }) {
  return async (params = new URLSearchParams()) => {
    const query = { ownerId, status: 'published' };
    const cursor = params.get('cursor');
    if (cursor) {
      let decoded;
      try {
        if (cursor.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(cursor)) throw new Error();
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!/^[a-f0-9]{64}$/.test(decoded?.id) || typeof decoded.at !== 'string' || !Number.isFinite(Date.parse(decoded.at))) throw new Error();
      } catch { throw new InputError('Invalid posts page. Refresh to load your published posts.'); }
      const createdAt = new Date(decoded.at);
      query.$or = [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: decoded.id } }];
    }
    const rows = await publications.find(query).sort({ createdAt: -1, _id: -1 }).limit(pageSize + 1).toArray();
    const page = rows.slice(0, pageSize);
    const ownedAccounts = await accounts.find({}).toArray();
    const runIds = [...new Set(page.filter(row => !row.communityName || !row.accountName || !row.categoryName).map(row => row.runId).filter(Boolean))];
    const runRows = await Promise.all(runIds.map(_id => runs.findOne({ _id, ownerId })));
    const runMap = new Map(runRows.filter(Boolean).map(run => [run._id, run]));
    const posts = page.map(receipt => {
      const result = runMap.get(receipt.runId)?.results?.find(item => item.groupName === receipt.groupName && item.status === 'published');
      const groupName = validSlug(receipt.groupName) ? receipt.groupName : '';
      const communityUrl = groupName ? `https://www.skool.com/${groupName}` : null;
      let url = communityUrl;
      try {
        const candidate = new URL(receipt.url);
        if (candidate.origin === 'https://www.skool.com' && !candidate.username && !candidate.password && candidate.pathname.split('/')[1] === groupName) url = candidate.href;
      } catch { /* Older receipts may have only a community name. */ }
      return {
        id: receipt._id,
        title: receipt.article?.title || result?.article?.title || 'Untitled post',
        content: receipt.article?.content || result?.article?.content || '',
        communityName: receipt.communityName || result?.name || groupName || 'Community',
        communityUrl, url,
        accountName: receipt.accountName || result?.account?.displayName || ownedAccounts.find(account => account._id === receipt.accountId)?.displayName || 'Removed account',
        categoryName: receipt.categoryName || result?.categoryName || null,
        postMode: receipt.postMode || result?.postMode || null,
        publishedAt: receipt.publishedAt || receipt.updatedAt || receipt.createdAt,
      };
    });
    return { posts, nextCursor: rows.length > pageSize ? cursorFor(page[page.length - 1]) : null };
  };
}

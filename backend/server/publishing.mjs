import { decryptCookies } from './accounts.mjs';
import { sessionHeader, SessionError } from './skool.mjs';
import { parseJoinPage } from './join.mjs';
import { generalCategory } from './post-category.mjs';

const fail = message => new SessionError(message, 502, false);
const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value);
export function createPublishing(collection, key, fetcher = fetch) {
  const session = async accountId => {
    const account = await collection.findOne({ _id: accountId });
    if (!account) throw fail('Account not found in this workspace.');
    const cookies = decryptCookies(account.encryptedCookies, key, account._id).filter(c => ['auth_token', 'client_id'].includes(c.name));
    return { Cookie: sessionHeader(cookies), Accept: 'application/json' };
  };
  const read = async (url, headers) => {
    let response;
    try { response = await fetcher(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
    catch { throw fail('Could not check this community’s posting requirements.'); }
    if (response.status === 429) throw new SessionError('Skool is rate-limiting requests. Publication stopped.', 429, false);
    if (!response.ok || response.status === 202) throw fail('Skool did not allow reading this community’s posting requirements.');
    return response;
  };
  return {
    async prepare({ accountId, groupName }) {
      if (!/^[a-z0-9_-]{1,150}$/i.test(groupName)) throw fail('Invalid community.');
      const headers = await session(accountId);
      const page = parseJoinPage(await (await read(`https://www.skool.com/${groupName}/about`, headers)).text(), groupName);
      const { group, member, self } = page;
      if (!validId(group.id) || !['member','group-admin','group-moderator'].includes(member?.role)) throw fail('Posting requires confirmed membership. This account may still be awaiting approval.');
      let level = 0;
      try { level = JSON.parse(self.metadata?.spData || '{}').lv || 0; } catch { /* fail closed for level-gated posts */ }
      // The labels API is admin-only; the signed-in community page supplies
      // categories visible to ordinary members, including their permissions.
      if (!Array.isArray(group.labels)) throw fail('Skool returned an unsupported category format.');
      const labels = group.labels.filter(l => validId(l.id) && [undefined, 4, '4'].includes(l.metadata?.post_write_role ?? l.metadata?.postWriteRole))
        .map(l => ({ id: l.id, name: String(l.metadata?.display_name || l.metadata?.displayName || '').slice(0,200) }));
      if (!labels.length) throw fail('No category allows regular member posts in this community.');
      // Category permissions are checked above; Skool enforces level and other
      // posting restrictions on the real request. A local threshold estimate
      // must not prevent attempting an available General category.
      return { groupId: group.id, groupName, authorId: self.id, name: group.metadata.displayName || group.name, description: String(group.metadata.description || '').slice(0,3000), labels, memberLevel: level, minimumPostLevel: Number(group.metadata.minPostLevel || 0) };
    },
    async reconcile(receipt) {
      const unknown = { status: 'unconfirmed', message: 'Still checking whether Skool accepted the post. No duplicate will be sent.' };
      const { context, article, accountId, createdAt } = receipt;
      if (!context || !validId(context.groupId) || !context.authorId || !/^[a-z0-9_-]{1,150}$/i.test(context.groupName) || !article || !Number.isFinite(new Date(createdAt).getTime())) return unknown;
      const headers = await session(accountId);
      const html = await (await read(`https://www.skool.com/${context.groupName}`, headers)).text();
      const page = parseJoinPage(html, context.groupName);
      if (page.group.id !== context.groupId || page.self.id !== context.authorId) return unknown;
      let props;
      try { props = JSON.parse(html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)?.[1]).props.pageProps; } catch { return unknown; }
      if (!Array.isArray(props.postTrees)) return unknown;
      const matches = props.postTrees.map(tree => tree?.post).filter(post => validId(post?.id)
        && post.groupId === context.groupId && post.userId === context.authorId
        && post.metadata?.title === article.title && post.metadata?.content === article.content
        && new Date(post.createdAt).getTime() >= new Date(createdAt).getTime() - 1000);
      // Absence from the feed does not prove a timed-out request failed.
      if (matches.length !== 1) return unknown;
      const post = matches[0];
      const url = typeof post.name === 'string' && /^[a-z0-9_-]+$/i.test(post.name) ? `https://www.skool.com/${context.groupName}/${post.name}` : `https://www.skool.com/${context.groupName}`;
      return { status: 'published', postId: post.id, url, message: 'Publication verified on Skool.' };
    },
    async publish({ accountId, context, article }) {
      const general = generalCategory(context.labels);
      if (general) article = { ...article, labelId: general.id };
      if (!validId(context.groupId) || !context.labels.some(l => l.id === article.labelId)
        || typeof article.title !== 'string' || !article.title.trim() || article.title.length > 150
        || typeof article.content !== 'string' || !article.content.trim() || article.content.length > 10000) throw fail('The article or posting category is invalid.');
      const headers = await session(accountId);
      let response;
      try {
        response = await fetcher('https://api2.skool.com/posts', {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_type: 'generic', group_id: context.groupId, metadata: { title: article.title, content: article.content, labels: article.labelId, action: 0 } }),
        });
      } catch { return { status: 'unconfirmed', message: 'Skool did not confirm publication. This article will not be resent automatically.' }; }
      if (response.status === 429) return { status: 'blocked', rateLimited: true, message: 'Skool is rate-limiting posts. Publication stopped.' };
      if (!response.ok || response.status === 202) return { status: response.status >= 500 || response.status === 202 ? 'unconfirmed' : 'blocked', message: `Skool did not confirm this post in ${context.labels.find(l=>l.id===article.labelId)?.name || 'the selected category'}. Check posting permissions and moderation requirements.`, categoryId: article.labelId, categoryName: context.labels.find(l=>l.id===article.labelId)?.name || '' };
      let post;
      try { post = await response.json(); } catch { /* cannot safely resend */ }
      if (!validId(post?.id) || post.group_id !== context.groupId) return { status: 'unconfirmed', message: 'Skool returned an unexpected publication response. Check the community; this article will not be resent automatically.' };
      const url = typeof post.name === 'string' && /^[a-z0-9_-]+$/i.test(post.name) ? `https://www.skool.com/${context.groupName}/${post.name}` : `https://www.skool.com/${context.groupName}`;
      return { status: 'published', postId: post.id, url, categoryId: article.labelId, categoryName: context.labels.find(l=>l.id===article.labelId)?.name || '', message: `Article published in ${context.labels.find(l=>l.id===article.labelId)?.name || 'the selected category'}.` };
    },
  };
}

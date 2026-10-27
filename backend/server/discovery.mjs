import { decryptCookies } from './accounts.mjs';
import { sessionHeader, SessionError } from './skool.mjs';
import { InputError } from './cookies.mjs';
let categoryCache = { items: [], expires: 0 };
let languageCache = { items: [], expires: 0 };

function imageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'assets.skool.com' && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

function nonnegativeNumber(value) {
  if (value === null || value === undefined || value === '' || !['number', 'string'].includes(typeof value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function displayPrice(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let price;
  try { price = JSON.parse(value); }
  catch { return value.trim().startsWith('{') ? null : value.slice(0, 100); }
  if (!price || typeof price !== 'object') return null;
  const amount = nonnegativeNumber(price.amount);
  if (amount === null || typeof price.currency !== 'string' || !/^[a-z]{3}$/i.test(price.currency)) return null;
  if (amount === 0) return 'Free';
  try {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency.toUpperCase() });
    const digits = formatter.resolvedOptions().maximumFractionDigits;
    const formatted = formatter.format(amount / 10 ** digits).replace(/\.00$/, '');
    const interval = ['day', 'week', 'month', 'year'].includes(price.recurring_interval) ? `/${price.recurring_interval}` : '';
    return formatted + interval;
  } catch { return null; }
}

export function communityRecord(group) {
  const raw = group?.metadata;
  if (!raw || typeof group.id !== 'string' || typeof group.name !== 'string' || !/^[a-z0-9_-]+$/i.test(group.name)) return null;
  const name = raw.displayName ?? raw.display_name;
  if (typeof name !== 'string') return null;
  const rating = nonnegativeNumber(raw.reviewAverageRating ?? raw.review_average_rating);
  const reviews = nonnegativeNumber(raw.reviewCount ?? raw.review_count);
  const model = raw.membershipModel ?? raw.membership_model;
  return { id: group.id, name: name.slice(0, 300), description: typeof raw.description === 'string' ? raw.description.slice(0, 4000) : '',
    members: nonnegativeNumber(raw.totalMembers ?? raw.total_members), coverUrl: imageUrl(raw.coverSmallUrl ?? raw.cover_small_url), logoUrl: imageUrl(raw.logoUrl ?? raw.logo_url),
    rating: rating !== null && rating <= 5 && reviews !== 0 ? rating : null,
    reviewCount: reviews !== null && Number.isInteger(reviews) ? reviews : null,
    url: `https://www.skool.com/${group.name}`, price: model === 1 || model === 3 ? 'Free' : displayPrice(raw.displayPrice ?? raw.display_price) };
}

export function discoveryQuery(params) {
  const query = (params.get('q') || '').trim();
  const page = Number(params.get('page') || 1);
  const category = params.get('category') || '';
  const price = params.get('price') || '';
  const type = params.get('type') || '';
  const sort = params.get('sort') || 'trending';
  const language = params.get('language') || 'all';
  if (!['', 'free', 'paid', 'free-trial'].includes(price) || !['', 'private', 'public'].includes(type) || !['trending', 'top'].includes(sort) || !/^[a-z-]{2,40}$/.test(language)) throw new InputError('Invalid discovery filters.');
  if (query.length > 200 || !Number.isInteger(page) || page < 1 || page > 100 || (category && !/^[a-f0-9]{32}$/.test(category))) throw new InputError('Invalid discovery search or page.');
  const url = new URL('https://www.skool.com/discovery');
  if (query) url.searchParams.set('q', query);
  if (category) url.searchParams.set('c', category);
  if (price) url.searchParams.set('pr', price);
  if (type) url.searchParams.set('ty', type);
  if (!query) url.searchParams.set('srt', sort === 'top' ? 'top-v2' : 'trending');
  url.searchParams.set('lang', language);
  url.searchParams.set('p', String(page));
  return { url, page };
}

export function parseDiscovery(html, page) {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  let props;
  try { props = JSON.parse(match?.[1]).props?.pageProps; } catch { /* handled below */ }
  const data = props?.renderData;
  if (!Array.isArray(data?.groups)) throw new SessionError('Skool returned an unexpected discovery page. Please try again later.', 502, false);
  const communities = data.groups.map(entry => communityRecord(entry.group)).filter(Boolean);
  const rawCategories = data.categories || props.categories || [];
  const categories = Array.isArray(rawCategories) ? rawCategories.filter(c => typeof c.id === 'string' && /^[a-f0-9]{32}$/.test(c.id) && typeof c.name === 'string').map(c => ({ id: c.id, name: c.name })) : [];
  const rawLanguages = data.languages || props.languages || [];
  const languages = Array.isArray(rawLanguages) ? rawLanguages.filter(item => typeof item.name === 'string' && /^[a-z-]{2,40}$/.test(item.name) && typeof item.displayName === 'string').map(item => ({ id: item.name, name: item.displayName.slice(0, 100) })) : [];
  const total = Number(data.total);
  return { communities, categories, languages, page, total: Number.isFinite(total) && total >= 0 ? total : null,
    hasMore: communities.length === 30 && (!Number.isFinite(total) || page * 30 < total) };
}

export function createDiscovery(collection, key, fetcher = fetch) {
  return async (params) => {
    const { url, page } = discoveryQuery(params);
    const accountId = params.get('accountId');
    const account = await collection.findOne(accountId ? { _id: accountId } : { status: 'active' });
    if (!account) throw new SessionError('Connect a Skool account in Accounts before searching communities.', 422, false);
    const cookies = decryptCookies(account.encryptedCookies, key, account._id);
    let response;
    const headers = { Cookie: sessionHeader(cookies), Accept: 'text/html' };
    try { response = await fetcher(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) }); }
    catch (error) { if (error instanceof SessionError) throw error; throw new SessionError('Could not reach Skool discovery. Please retry.', 502, false); }
    if ([401, 302, 303, 307, 308].includes(response.status)) throw new SessionError('Your Skool session needs to be refreshed. Update Cookies in Accounts.');
    if ([202, 403].includes(response.status)) throw new SessionError('Skool requires a browser check. Open Skool in your browser and refresh your login cookies, then retry.', 502, false);
    if (response.status === 429) throw new SessionError('Skool is rate-limiting discovery. Wait a moment and retry.', 429, false);
    if (!response.ok) throw new SessionError('Skool discovery is temporarily unavailable.', 502, false);
    const result = parseDiscovery(await response.text(), page);
    if (result.languages.length) languageCache = { items: result.languages, expires: Date.now() + 3600_000 };
    if (result.categories.length) categoryCache = { items: result.categories, expires: Date.now() + 3600_000 };
    else {
      if (categoryCache.expires < Date.now()) {
        // Search responses omit category options. Retrieve the public category list
        // from the base discovery page with the same approved two login cookies.
        try {
          const categoryResponse = await fetcher(new URL('https://www.skool.com/discovery'), { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
          if (categoryResponse.ok && categoryResponse.status !== 202) {
            const options = parseDiscovery(await categoryResponse.text(), 1);
            if (options.categories.length) categoryCache = { items: options.categories, expires: Date.now() + 3600_000 };
            if (options.languages.length) languageCache = { items: options.languages, expires: Date.now() + 3600_000 };
          }
        } catch { /* Keep usable search results even if category options fail. */ }
      }
      result.categories = categoryCache.expires > Date.now() ? categoryCache.items : [];
    }
    if (!result.languages.length && languageCache.expires > Date.now()) result.languages = languageCache.items;
    return result;
  };
}

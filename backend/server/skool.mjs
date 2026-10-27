// Skool's own signed-in profile endpoint. Never follow redirects with credentials.
const PROFILE_URL = 'https://api2.skool.com/self';

export class SessionError extends Error {
  constructor(message, status = 422, invalidSession = true) {
    super(message);
    this.status = status;
    this.invalidSession = invalidSession;
  }
}

export function sessionHeader(cookies, now = Date.now() / 1000) {
  return ['auth_token', 'client_id'].map((name) => {
    const candidates = cookies.filter((cookie) => cookie.name === name &&
      ['skool.com', 'www.skool.com', 'api2.skool.com'].includes(cookie.domain.replace(/^\./, '')) && cookie.path === '/');
    if (!candidates.some((cookie) => cookie.value)) {
      throw new SessionError(`Missing ${name} login cookie. Sign in to Skool, then export all Skool cookies including HttpOnly cookies. Paste the new export here.`);
    }
    const current = candidates.filter((cookie) => cookie.value && (cookie.session === true || cookie.expires === undefined || cookie.expires === -1 || cookie.expires > now));
    if (!current.length) throw new SessionError('Your Skool login cookies have expired. Sign in again and export fresh cookies.');
    const values = [...new Set(current.map((cookie) => cookie.value))];
    if (values.length !== 1) throw new SessionError(`The export contains conflicting ${name} cookies. Export cookies from one signed-in Skool session.`);
    if (/[\r\n;]/.test(values[0])) throw new SessionError('Invalid login cookie value. Export fresh cookies from Skool.');
    return `${name}=${values[0]}`;
  }).join('; ');
}

export async function verifySkoolSession(cookies, fetcher = fetch) {
  const header = sessionHeader(cookies);
  let response;
  try {
    response = await fetcher(PROFILE_URL, {
      method: 'GET', headers: { Accept: 'application/json', Cookie: header },
      redirect: 'manual', signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new SessionError('Could not reach Skool to verify your account. Please try again.', 502, false);
  }
  if (response.status === 401) throw new SessionError('Skool rejected these login cookies. Sign in again and export fresh cookies.');
  if (response.status === 403 || response.status === 202) throw new SessionError('Skool blocked session verification or requires a browser check. Open Skool in your browser, complete any sign-in checks, then try a fresh cookie export.', 502, false);
  if (response.status === 429) throw new SessionError('Skool is rate-limiting verification. Wait a moment and try again.', 429, false);
  if (response.status >= 300 && response.status < 400) throw new SessionError('Skool redirected the session check. Sign in again and export fresh cookies.');
  if (!response.ok) throw new SessionError('Skool could not verify the account right now. Please try again.', 502, false);
  let data;
  try { data = await response.json(); }
  catch { throw new SessionError('Skool returned an unexpected verification response. Please try again later.', 502, false); }
  const string = (value, max = 200) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
  const id = string(data?.id);
  const username = string(data?.name);
  const fullName = [string(data?.first_name), string(data?.last_name)].filter(Boolean).join(' ');
  if (!id || !username || !/^[a-z0-9_-]+$/i.test(username)) {
    throw new SessionError('Skool did not return a signed-in profile. Check the cookie export and try again.');
  }
  return { skoolUserId: id, displayName: fullName || username, identifier: `@${username}`, verifiedAt: new Date().toISOString() };
}

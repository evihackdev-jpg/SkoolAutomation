export class InputError extends Error {}

// Keep cookie scope and flags when importing browser-extension exports.
export function parseCookies(input, now = Date.now() / 1000) {
  if (typeof input !== 'string' || !input.trim()) throw new InputError('Paste cookie data.');
  if (Buffer.byteLength(input) > 128 * 1024) throw new InputError('Cookie data exceeds 128 KB.');
  const source = input.trim().replace(/^Collected\s+\(non-HttpOnly\)\s+cookies:\s*/i, '').trim();
  let entries;
  if (source.startsWith('[') || source.startsWith('{')) {
    let parsed;
    try { parsed = JSON.parse(source); } catch { throw new InputError('Cookie JSON is not valid.'); }
    entries = Array.isArray(parsed) ? parsed : parsed?.cookies;
    if (!Array.isArray(entries)) throw new InputError('Use a JSON cookie array or an object with a cookies array.');
  } else {
    const rawCookies = new Map();
    entries = source.replace(/^Cookie:\s*/i, '').split(';').filter((part) => part.trim()).map((part) => {
      const separator = part.indexOf('=');
      if (separator < 1) throw new InputError('Use a Cookie header with name=value pairs.');
      return { name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim(), domain: 'www.skool.com', path: '/', secure: true };
    }).filter((cookie) => {
      if (!rawCookies.has(cookie.name)) {
        rawCookies.set(cookie.name, cookie.value);
        return true;
      }
      if (rawCookies.get(cookie.name) !== cookie.value) throw new InputError('The pasted header contains conflicting values for the same cookie. Export cookies from one signed-in Skool session.');
      return false;
    });
  }
  if (!entries.length || entries.length > 200) throw new InputError('Import between 1 and 200 cookies.');
  const seen = new Set();
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(entry.name) || typeof entry.value !== 'string' || /[\x00-\x20\x7f;]/.test(entry.value)) {
      throw new InputError('Each cookie needs a valid name and string value without whitespace or control characters.');
    }
    const domain = entry.domain ?? 'www.skool.com';
    if (typeof domain !== 'string' || !/^(\.)?([a-z0-9-]+\.)*skool\.com$/i.test(domain)) throw new InputError('Only skool.com cookies can be imported.');
    const path = entry.path ?? '/';
    if (typeof path !== 'string' || !path.startsWith('/') || /[\x00-\x1f\x7f]/.test(path)) throw new InputError('Invalid cookie path.');
    const expires = entry.expirationDate ?? entry.expires;
    if (expires !== undefined && (typeof expires !== 'number' || !Number.isFinite(expires))) throw new InputError('Cookie expiration must be a Unix timestamp in seconds.');
    if (entry.session !== true && expires !== undefined && expires !== -1 && expires <= now) throw new InputError('The export contains expired cookies. Export a fresh session.');
    for (const flag of ['httpOnly', 'secure', 'hostOnly', 'session']) {
      if (entry[flag] !== undefined && typeof entry[flag] !== 'boolean') throw new InputError('Cookie flags must be booleans.');
    }
    if (entry.sameSite !== undefined && !['Strict', 'Lax', 'None', 'strict', 'lax', 'none', 'no_restriction', 'unspecified'].includes(entry.sameSite)) throw new InputError('Invalid SameSite cookie setting.');
    const key = `${domain.toLowerCase().replace(/^\./, '')}|${path}|${entry.name}`;
    if (seen.has(key)) throw new InputError('The export contains duplicate cookies for the same scope.');
    seen.add(key);
    return { name: entry.name, value: entry.value, domain: domain.toLowerCase(), path,
      ...(expires !== undefined && { expires }),
      ...Object.fromEntries(['httpOnly', 'secure', 'hostOnly', 'session', 'sameSite'].filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]])) };
  });
}

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { InputError, parseCookies } from './cookies.mjs';
import { SessionError, verifySkoolSession } from './skool.mjs';

export function encryptionKey(value) {
  if (!/^[a-f0-9]{64}$/i.test(value ?? '')) throw new Error('COOKIE_ENCRYPTION_KEY must be 64 hexadecimal characters.');
  return Buffer.from(value, 'hex');
}

export function encryptCookies(cookies, key, accountId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(accountId));
  const data = Buffer.concat([cipher.update(JSON.stringify(cookies), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

// Server-only: credentials must never be returned by the account API.
export function decryptCookies(payload, key, accountId) {
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  cipher.setAAD(Buffer.from(accountId));
  cipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(payload.data, 'base64')), cipher.final()]).toString('utf8'));
}

export function publicAccount(record) {
  return { id: record._id, displayName: record.displayName, identifier: record.identifier,
    notes: record.notes, status: record.status || 'unverified', lastUsed: 'Never', avatarTone: 'blue',
    verifiedAt: record.verifiedAt, verificationError: record.verificationError,
    cookieCount: record.cookieCount, createdAt: record.createdAt };
}

export function createAccountsService(collection, key, verifySession = verifySkoolSession) {
  const checkedProfile = async (cookies) => {
    const profile = await verifySession(cookies);
    return { ...profile, identifierKey: `skool:${profile.skoolUserId}`, status: 'active', verificationError: null };
  };
  return {
    async list() {
      return (await collection.find({}, { projection: { encryptedCookies: 0 } }).sort({ createdAt: -1 }).toArray()).map(publicAccount);
    },
    async create(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Expected an account object.');
      const text = (field, max, required = true) => {
        const value = body[field] ?? '';
        if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new InputError(`Invalid ${field}.`);
        return value.trim();
      };
      const notes = text('notes', 2000, false);
      const cookies = parseCookies(body.cookieData);
      const profile = await checkedProfile(cookies);
      const id = randomUUID();
      const record = { _id: id, ...profile, notes,
        createdAt: new Date().toISOString(), cookieCount: cookies.length,
        encryptedCookies: encryptCookies(cookies, key, id) };
      await collection.insertOne(record);
      return publicAccount(record);
    },
    async update(id, body) {
      const existing = await collection.findOne({ _id: id });
      if (!existing) return null;
      const cookies = parseCookies(body?.cookieData);
      // Verify replacement cookies before changing the existing record.
      const profile = await checkedProfile(cookies);
      const patch = { ...profile, cookieCount: cookies.length, encryptedCookies: encryptCookies(cookies, key, id) };
      const result = await collection.updateOne({ _id: id }, { $set: patch });
      return result.matchedCount ? publicAccount({ ...existing, ...patch }) : null;
    },
    async verify(id) {
      const existing = await collection.findOne({ _id: id });
      if (!existing) return null;
      try {
        const profile = await checkedProfile(decryptCookies(existing.encryptedCookies, key, id));
        const result = await collection.updateOne({ _id: id }, { $set: profile });
        return result.matchedCount ? publicAccount({ ...existing, ...profile }) : null;
      } catch (error) {
        if (error instanceof SessionError && error.invalidSession) {
          await collection.updateOne({ _id: id }, { $set: { status: 'inactive', verificationError: error.message } });
        }
        throw error;
      }
    },
    async remove(id) { return (await collection.deleteOne({ _id: id })).deletedCount === 1; },
  };
}

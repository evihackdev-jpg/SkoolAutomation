import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { InputError } from './cookies.mjs';
const scrypt = promisify(scryptCallback);
const hash = (value) => createHash('sha256').update(value).digest('hex');
export const LOCAL_OWNER = 'local-owner';
export class AuthError extends Error {
  constructor(message, status = 401) { super(message); this.status = status; }
}

export function ownerCollection(collection, ownerId) {
  if (!ownerId) throw new AuthError('Sign in to continue.');
  return {
    find: (query = {}, options) => collection.find({ ...query, ownerId }, options),
    findOne: (query) => collection.findOne({ ...query, ownerId }),
    insertOne: (record) => collection.insertOne({ ...record, ownerId }),
    updateOne: (query, update) => collection.updateOne({ ...query, ownerId }, update),
    deleteOne: (query) => collection.deleteOne({ ...query, ownerId }),
  };
}

export function createIdentity(db, { registrationCode = process.env.REGISTRATION_CODE } = {}) {
  const registrationCodeHash = typeof registrationCode === 'string' && registrationCode.length
    ? createHash('sha256').update(registrationCode).digest() : null;
  const users = db.collection('users');
  const sessions = db.collection('sessions');
  const limits = new Map();
  function throttle(ip) {
    const now = Date.now();
    for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    const entry = limits.get(ip) || { count: 0, until: now + 15 * 60_000 };
    entry.count++;
    limits.set(ip, entry);
    if (entry.count > 20 || limits.size > 5000) throw new AuthError('Too many sign-in attempts. Try again in 15 minutes.', 429);
  }
  return {
    async initialize() {
      await users.createIndex({ email: 1 }, { unique: true });
      await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    },
    async authenticate(body, register, ip) {
      throttle(ip);
      if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') throw new InputError('Enter your email and password.');
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || body.password.length > 128) throw new InputError('Enter a valid email and a password of at most 128 characters.');
      let user;
      if (register) {
        if (!registrationCodeHash) throw new AuthError('Account registration is currently unavailable.', 503);
        if (typeof body.registrationCode !== 'string' || body.registrationCode.length > 128 ||
          !timingSafeEqual(createHash('sha256').update(body.registrationCode).digest(), registrationCodeHash)) {
          throw new AuthError('Registration code is incorrect.', 403);
        }
        if (body.password.length < 12) throw new InputError('Use a password of at least 12 characters.');
        const salt = randomBytes(16).toString('hex');
        const passwordHash = (await scrypt(body.password, salt, 64)).toString('hex');
        user = { _id: randomUUID(), email, salt, passwordHash, createdAt: new Date() };
        try { await users.insertOne(user); }
        catch (error) { if (error.code === 11000) throw new AuthError('An account with this email already exists. Sign in instead.', 409); throw error; }
      } else {
        user = await users.findOne({ email });
        const candidate = await scrypt(body.password, user?.salt || 'unknown-user-salt', 64);
        const stored = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
        if (!user || stored.length !== candidate.length || !timingSafeEqual(candidate, stored)) throw new AuthError('Email or password is incorrect.');
      }
      const token = randomBytes(32).toString('hex');
      await sessions.insertOne({ _id: hash(token), userId: user._id, expiresAt: new Date(Date.now() + 7 * 86400_000) });
      return { token, user: { id: user._id, email: user.email, localOwner: false } };
    },
    async user(req, localOwner = false) {
      const token = /(?:^|;\s*)skool_service_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (token) {
        const session = await sessions.findOne({ _id: hash(token), expiresAt: { $gt: new Date() } });
        const user = session && await users.findOne({ _id: session.userId });
        if (user) return { id: user._id, email: user.email, localOwner: false };
        throw new AuthError('Your session has expired. Sign in again.');
      }
      if (localOwner) return { id: LOCAL_OWNER, email: 'Local workspace owner', localOwner: true };
      throw new AuthError('Sign in to access your private workspace.');
    },
    async logout(req) {
      const token = /(?:^|;\s*)skool_service_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (token) await sessions.deleteOne({ _id: hash(token) });
    },
  };
}

export function sessionCookie(token, secure, clear = false) {
  return `skool_service_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 604800}${secure ? '; Secure' : ''}`;
}

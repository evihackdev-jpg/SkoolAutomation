import { InputError } from './cookies.mjs';

export const profileFields = ['name','email','phone','city','country','occupation','company','website','experience','goal','skill'];
const cleanText = (value, limit, label) => {
  if (typeof value !== 'string' || value.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new InputError(`Enter valid ${label} (up to ${limit} characters).`);
  return value.trim();
};
export function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Enter your membership information.');
  if (Object.keys(input).some(key => ![...profileFields,'answers'].includes(key))) throw new InputError('Unknown profile field.');
  const profile = {};
  for (const field of profileFields) {
    const value = cleanText(input[field] ?? '', ['experience','goal'].includes(field) ? 1000 : 200, field);
    if (value) profile[field] = value;
  }
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw new InputError('Enter a valid contact email.');
  if (profile.skill && !['Beginner','Intermediate','Advanced','Professional'].includes(profile.skill)) throw new InputError('Choose a valid skating level.');
  if (profile.website) {
    try { const url = new URL(profile.website); if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { throw new InputError('Enter a website URL beginning with https:// or http://.'); }
  }
  if (input.answers !== undefined && (!Array.isArray(input.answers) || input.answers.length > 20)) throw new InputError('Save at most 20 question answers.');
  profile.answers = (input.answers || []).map(item => {
    if (!item || typeof item !== 'object') throw new InputError('Enter a question and its answer.');
    const question = cleanText(item.question, 1000, 'question');
    const answer = cleanText(item.answer, 1000, 'answer');
    if (!question || !answer) throw new InputError('Each saved answer needs both a question and an answer.');
    return { question, answer };
  });
  const normalized = profile.answers.map(item => normalizeQuestion(item.question));
  if (new Set(normalized).size !== normalized.length) throw new InputError('Save only one answer per question.');
  return profile;
}

export const normalizeQuestion = value => value.normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g,"'").replace(/[?!.,:;]+$/g,'').replace(/\s+/g,' ').trim();

export function membershipFacts(settings, accountId) {
  // Old per-account facts remain usable until the user saves the new shared profile.
  return { ...(settings?.facts?.[accountId] || {}), ...(settings?.profile || {}) };
}

export function createProfileSettings(settings, accounts, ownerId) {
  return {
    async get() {
      const saved = await settings.findOne({ _id: ownerId });
      const records = await accounts.find({}).toArray();
      return { profile: saved?.profile || { answers: [] }, updatedAt: saved?.updatedAt || null,
        replacesLegacy: Object.values(saved?.facts || {}).some(f => Object.keys(f).length > 0),
        accounts: records.map(a => ({ id: a._id, displayName: a.displayName, identifier: a.identifier, status: a.status })),
      };
    },
    async save(body) {
      const profile = validateProfile(body?.profile);
      const updatedAt = new Date();
      await settings.updateOne({ _id: ownerId }, { $set: { profile, facts: {}, updatedAt } }, { upsert: true });
      return { profile, updatedAt };
    },
  };
}

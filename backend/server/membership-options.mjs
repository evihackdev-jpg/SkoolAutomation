import { normalizeQuestion } from './profile-settings.mjs';

export const optionKey = value => normalizeQuestion(value).replace(/[“”"']/g,'').replace(/\s*[–—-]\s*/g,' ').replace(/\s+/g,' ').trim();
const protectedQuestion = question => /password|passcode|credential|secret|token|access code|invite code|one.time code|captcha|eligib|certif|licen[cs]|over \d|at least \d.*(?:age|years)|completed.*course|paid.*course/i.test(question);
const invalidChoice = value => /\b(?:pay|purchase|checkout|credit card|billing|subscribe to paid|free trial)\b|[$€£]\s*\d/i.test(value);
const factual = /\b(?:age|birthday|born|experience|experienced|level|status|situation|income|revenue|salary|earn|earned|live|living|resid|citizen|country|city|license|certif\w*|qualified|completed|enrolled|student|password|passcode|invite code|referr\w*|following|followed|married|children|gender|profession|occupation|employ\w*|business owner|own a|have a|do you (?:have|work|use|know)|are you (?:a|an)|how long|how many)\b/i;
const preference = /(?:\b(?:prefer|favorite|favourite|interested|interests?|focus|excited|learn|learning|hope|goal|want|would you like|most like help|looking for|coolest)\b|why.*join|inspired.*join|what brings you here)/i;
const yesOption = value => /^(?:yes|yes please|i agree|agree|i understand|understood|i accept|accept|sure|absolutely)(?:\b|[!,])/i.test(value);
const noOption = value => /^(?:no|no thanks|no thank you|not now|nope|decline|opt out)(?:\b|[!,])/i.test(value);
const choice = (q, predicate) => q.options?.find(value => !invalidChoice(value) && predicate(value));

// Local decisions only. No profile values or saved answers enter an AI prompt.
export function automaticMembershipAnswer(q, profile, supplied) {
  if (supplied !== undefined) {
    if (q.type !== 'options') return supplied;
    const matches = q.options.filter(o => optionKey(o) === optionKey(supplied));
    if (matches.length === 1) return matches[0];
    const decorated = q.options.filter(o => optionKey(o).startsWith(optionKey(supplied) + ' (') || optionKey(o).startsWith(optionKey(supplied) + ' '));
    return decorated.length === 1 ? decorated[0] : '';
  }
  const question = normalizeQuestion(q.question);
  if (/^(?:owner\s*\/\s*member|community owner or member)\??$/.test(question) && q.type === 'options') {
    return choice(q, o => /^community member$/i.test(o.trim())) || '';
  }
  if (q.type === 'text' && /what do you (?:promote|sell)|what (?:business|services?|products?) do you (?:offer|provide)/i.test(question)) {
    return [profile.occupation,profile.company,profile.goal].filter(Boolean).join('. ').slice(0,1000) || undefined;
  }
  if (/how (?:did|do) you (?:find|hear|discover)|what (?:platform|person).*find|where did you (?:find|hear|discover)/i.test(question)) {
    if (q.type === 'options') return choice(q,o => /\bskool\b/i.test(o)) || '';
    if (q.type === 'text') return 'I found this community on Skool.';
  }
  // Membership does not opt the user into an optional marketing subscription.
  if (/newsletter|marketing (?:emails?|messages?)|subscribe|book (?:a|an).*call|reach out to book|contact you|contact me/i.test(question)) {
    if (q.type === 'options') return choice(q,noOption) || '';
    if (q.type === 'text') return 'No, thank you.';
  }
  // Acknowledge ordinary community conduct rules, without certifying profile,
  // eligibility, paid commitments, permissions or an unseen agreement.
  if (/rules|guidelines|respectful|no spam|not to promote|promo schedule/i.test(question) && /agree|understand|follow|accept|abide/i.test(question)
    && !/real name|photo|age|over \d|payment|charge|terms|privacy|license|legal|consent|eligible|profile|completed|course/i.test(question)) {
    if (q.type === 'options') return choice(q,yesOption) || '';
    if (q.type === 'text') return /type\s+["']?yes/i.test(question) ? 'YES' : 'Yes, I understand and will follow the community rules.';
  }
  const country = optionKey(profile.country || '');
  if (/\b(?:live|reside|resident)\b/.test(question) && /united states|\busa\b|\bu\.s\./.test(question) && country) {
    const inUS = ['united states','united states of america','usa','us','puerto rico','guam','american samoa','northern mariana islands','us virgin islands','u.s. virgin islands'].includes(country);
    if (q.type === 'options') return choice(q,inUS ? yesOption : noOption) || '';
    if (q.type === 'text') return inUS ? 'Yes.' : 'No.';
  }
  if (q.type === 'options' && preference.test(question) && !factual.test(question)) {
    // Prefer an option supported by the user's goal; otherwise choose the first
    // ordinary interest, as requested, without asserting a personal fact.
    const words = new Set((profile.goal || '').toLowerCase().match(/[a-z]{4,}/g) || []);
    const options = q.options.filter(o => !invalidChoice(o) && !/\b(?:i am|i have|i earn|i own|i completed|i live|certified|licensed|years of experience)\b/i.test(o));
    return options.find(o => (o.toLowerCase().match(/[a-z]{4,}/g)||[]).some(w=>words.has(w))) || options[0] || '';
  }
  return undefined;
}

export function defaultMembershipAnswer(q) {
  if (protectedQuestion(q.question) || q.type === 'email') return '';
  if (q.type === 'text') return "I haven't provided that information yet.";
  if (q.type === 'options') {
    const neutral = q.options.find(o => /^(?:prefer not to (?:say|answer)|not (?:specified|provided|sure)|unsure|other)(?:$|\b[\s,(/])/i.test(optionKey(o)) || /\bor other$/.test(optionKey(o)));
    if (neutral) return neutral;
    // The user's requested starting/restarting default is limited to ordinary
    // hobby onboarding; it cannot assert a qualification, income, or eligibility.
    if (/painting|drawing|knitting|crochet|gardening/i.test(q.question)) {
      return q.options.find(o => /^just starting or restarting$/i.test(o.trim())) || '';
    }
  }
  return '';
}

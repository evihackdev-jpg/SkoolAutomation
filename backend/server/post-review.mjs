// As-is drafts stay local. This conservative check uses the community's rules
// and member-writable categories without sending the user's text to an AI service.
import { generalCategory } from './post-category.mjs';
export function reviewAsIsPost(context, post) {
  const text = `${post.title}\n${post.content}`;
  const recruiting = /\b(?:hir(?:e|ing)|recruit|job|vacancy|looking for (?:a |an )?(?:senior |junior )?(?:developer|designer|assistant|worker)|work with me)\b/i.test(text);
  const links = /(?:https?:\/\/|www\.)\S+/i.test(text);
  const promotional = recruiting || links || /\b(?:buy|sale|discount|offer|sign up|subscribe|contact me|dm me|my (?:business|service|product)|paid|salary|payment|per month)\b|[$€£]\s*\d/i.test(text);
  for (const rule of context.rules || []) {
    const ruleText = `${rule.title || ''}. ${rule.description || ''}`;
    const prohibition = /\b(?:no|not allowed|not permitted|do not|don't|prohibit\w*|forbid\w*|ban(?:ned)?|must not|never)\b/i.test(ruleText);
    const restrictedPromotion = promotional && /\b(?:promot\w*|advertis\w*|solicit\w*|sell\w*|sales|pitch\w*)\b/i.test(ruleText);
    const restrictedRecruitment = recruiting && /\b(?:hir(?:e|ing)|recruit\w*|job\w*|vacanc\w*)\b/i.test(ruleText);
    const restrictedLinks = links && /\b(?:links?|urls?|websites?)\b/i.test(ruleText);
    const approvalRequired = promotional && /(?:prior|admin|owner|moderator).{0,40}(?:approval|permission)|(?:approval|permission).{0,40}(?:post|promot|advertis)/i.test(ruleText);
    if ((prohibition && (restrictedPromotion || restrictedRecruitment || restrictedLinks)) || approvalRequired) {
      return { suitable: false, reason: `The as-is post conflicts with or needs permission under this community rule: ${rule.title || rule.description}.`, labelId: '' };
    }
  }
  const label = generalCategory(context.labels) || (recruiting && context.labels.find(l => /\b(?:jobs?|hiring|careers?|opportunities|collaboration)\b/i.test(l.name)))
    || context.labels.find(l => /\b(?:general|discussion)\b/i.test(l.name)) || context.labels[0];
  return { suitable: Boolean(label), reason: label ? '' : 'No member-writable category is available.', labelId: label?.id || '' };
}

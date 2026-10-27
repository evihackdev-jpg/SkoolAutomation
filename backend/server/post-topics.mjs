// Local topic matching keeps as-is draft text out of AI requests when no
// separate audience/goal has been supplied.
const ignored = new Set('the and for with this that from have will your our you are was were but not can would could should into about their they them then than what when where why how who looking look need want please hello everyone requirement requirements required share post title content community communities join hiring hire seeking find work working opportunity paid payment month weekly reply contact send email message here there some someone anyone person per paypal stripe card telegram http https www com'.split(' '));
export function postTopics(post) {
  const text = `${post.title} ${post.content}`.toLowerCase()
    .replace(/(?:https?:\/\/|www\.)\S+|\S+@\S+|@\S+|\+?\d[\d\s().-]{6,}/g, ' ');
  return [...new Set(text.match(/\p{L}[\p{L}-]{2,39}/gu) || [])].filter(word => !ignored.has(word)).slice(0,12);
}
export function matchPostTopics(communities, topics) {
  const ranked = [];
  for (const community of communities) {
    const words = new Set(`${community.name} ${community.description || ''}`.toLowerCase().match(/\p{L}[\p{L}-]{2,39}/gu) || []);
    const matches = topics.filter(topic => words.has(topic));
    if (matches.length) ranked.push({ ...community, score: Math.min(95,70+matches.length*5), reason: `Local topic match: ${matches.join(', ')}.` });
  }
  return { ranked, skipped: [] };
}

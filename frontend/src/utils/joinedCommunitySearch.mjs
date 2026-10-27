const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function matchesJoinedCommunity(community, query) {
  const needle = normalize(query);
  if (!needle) return true;
  const fields = [community.name, community.url, community.description,
    ...(community.memberships || []).flatMap(member => [member.displayName, member.identifier])];
  return fields.some(value => normalize(value).includes(needle));
}

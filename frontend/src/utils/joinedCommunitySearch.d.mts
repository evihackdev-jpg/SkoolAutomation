export function matchesJoinedCommunity(community: {
  name: string;
  url: string;
  description: string;
  memberships?: { displayName: string; identifier?: string }[];
}, query: string): boolean;

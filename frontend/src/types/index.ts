export type CommunityCategory =
  | 'AI'
  | 'Development'
  | 'Entrepreneurship'
  | 'SaaS'
  | 'No-Code'
  | 'Business'
  | 'Marketing'
  | 'Design'
  | 'Crypto'
  | 'Health'
  | 'Career';

export type CommunityIconTone = 'red' | 'orange' | 'blue' | 'purple' | 'green' | 'teal';

export interface Community {
  id: string;
  name: string;
  description: string;
  members: number;
  categories: CommunityCategory[];
  matchScore: number;
  iconName: string;
  iconTone: CommunityIconTone;
  bookmarked: boolean;
  updatedAt: string;
}

export interface SearchResult {
  id: string;
  name: string;
  description: string;
  members: number;
  categories: CommunityCategory[];
  matchScore: number;
  iconName: string;
  iconTone: CommunityIconTone;
  updatedAt: string;
}

export type AccountStatus = 'active' | 'inactive' | 'unverified';

export interface AccountRecord {
  id: string;
  displayName: string;
  identifier: string;
  status: AccountStatus;
  lastUsed: string;
  avatarTone: CommunityIconTone;
  notes?: string;
  cookieCount?: number;
  createdAt?: string;
  verifiedAt?: string;
  verificationError?: string | null;
}

export type SavedStatus = 'To Review' | 'Interested' | 'Joined';

export interface SavedCommunity {
  id: string;
  communityId: string;
  name: string;
  members: number;
  matchScore: number;
  iconName: string;
  iconTone: CommunityIconTone;
  status: SavedStatus;
  savedAt: string;
}

export type DateRange = '7d' | '30d' | '90d' | '12m';

export interface DiscoveryPoint {
  label: string;
  discovered: number;
}

export interface CategoryShare {
  name: string;
  percent: number;
}

export interface MatchQualitySlice {
  name: string;
  value: number;
}

export interface AnalyticsSnapshot {
  stats: { communitiesFound: number; highMatches: number; joined: number; accounts: number };
  discovery: DiscoveryPoint[];
  topCategories: CategoryShare[];
  matchQuality: MatchQualitySlice[];
}

export interface MemberRecord {
  id: string;
  name: string;
  role: string;
  initial: string;
  tone: CommunityIconTone;
  joined: string;
}

export interface ActivityRecord {
  id: string;
  title: string;
  detail: string;
  time: string;
}

import { CheckCheck, Compass, RefreshCw, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listAccounts, request } from '../api/accounts';
import { Button } from '../components/Button';
import { JoinedCommunityCard, type CommunityMembership, type DiscoveryCommunity } from '../components/DiscoveryCard';
import { PageHeader } from '../components/PageHeader';
import { SearchBar } from '../components/SearchBar';
import { matchesJoinedCommunity } from '../utils/joinedCommunitySearch.mjs';

interface MembershipCommunity extends DiscoveryCommunity { role: string; joinedAt: string | null }
interface MembershipPage { communities: MembershipCommunity[]; hasMore: boolean; nextOffset: number }
interface JoinedCommunity extends DiscoveryCommunity { memberships: CommunityMembership[] }

export function JoinedCommunitiesPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const [communities, setCommunities] = useState<JoinedCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountCount, setAccountCount] = useState(0);
  const [checkedCount, setCheckedCount] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [sort, setSort] = useState('name');
  const lastSync = useRef(0);

  useEffect(() => {
    const syncOnReturn = () => {
      if (document.visibilityState === 'visible' && !loading && Date.now() - lastSync.current > 5000) {
        lastSync.current = Date.now();
        setRefresh(value => value + 1);
      }
    };
    window.addEventListener('focus', syncOnReturn);
    document.addEventListener('visibilitychange', syncOnReturn);
    return () => { window.removeEventListener('focus', syncOnReturn); document.removeEventListener('visibilitychange', syncOnReturn); };
  }, [loading]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(null); setWarnings([]); setCommunities([]); setAccountCount(0); setCheckedCount(0);
    const load = async () => {
      try {
        const { accounts } = await listAccounts();
        if (!active) return;
        setAccountCount(accounts.length);
        const connected = accounts;
        let nextAccount = 0;
        const worker = async () => {
          while (active && nextAccount < connected.length) {
            const account = connected[nextAccount++];
            try {
              let offset = 0;
              while (active) {
                const page = await request<MembershipPage>('/api/communities/joined?' + new URLSearchParams({ accountId: account.id, offset: String(offset) }), { signal: controller.signal });
                if (!active) return;
                setCommunities(current => {
                  const merged = new Map(current.map(community => [community.id, community]));
                  for (const community of page.communities) {
                    const existing = merged.get(community.id);
                    const membership = { id: account.id, displayName: account.displayName, identifier: account.identifier, role: community.role, joinedAt: community.joinedAt };
                    merged.set(community.id, { ...community, memberships: [...(existing?.memberships || []).filter(item => item.id !== account.id), membership] });
                  }
                  return [...merged.values()];
                });
                if (!page.hasMore) break;
                if (page.nextOffset <= offset) throw new Error('Membership pagination did not advance. Please retry.');
                offset = page.nextOffset;
              }
              if (active) setCheckedCount(count => count + 1);
            } catch (failure) {
              if (active) setWarnings(current => [...current, `${account.displayName}: ${failure instanceof Error ? failure.message : 'Could not load memberships.'}`]);
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, connected.length) }, worker));
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : 'Could not load accounts.'); }
      finally { if (active) { lastSync.current = Date.now(); setLoading(false); } }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, [refresh]);

  const visible = useMemo(() => {
    const result = communities.filter(community => matchesJoinedCommunity(community, query));
    const latest = (community: JoinedCommunity) => Math.max(0, ...community.memberships.map(member => member.joinedAt ? Date.parse(member.joinedAt) : 0));
    result.sort(sort === 'members' ? (a, b) => (b.members ?? -1) - (a.members ?? -1) : sort === 'recent' ? (a, b) => latest(b) - latest(a) : (a, b) => a.name.localeCompare(b.name));
    return result;
  }, [communities, query, sort]);
  const memberships = communities.reduce((total, community) => total + community.memberships.length, 0);
  const pending = communities.reduce((total, community) => total + community.memberships.filter(member => member.role === 'pending').length, 0);
  const accountSummaries = useMemo(() => {
    const summaries = new Map<string, { name: string; joined: number; pending: number }>();
    for (const community of communities) for (const member of community.memberships) {
      const summary = summaries.get(member.id) || { name: member.displayName, joined: 0, pending: 0 };
      if (member.role === 'pending') summary.pending++; else summary.joined++;
      summaries.set(member.id, summary);
    }
    return [...summaries.entries()];
  }, [communities]);
  return <div className="space-y-6">
    <PageHeader title="Communities I Joined" subtitle="All your accounts’ communities, including requests awaiting approval." actions={<Button variant="secondary" icon={<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />} disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</Button>} />
    <div className="grid gap-3 sm:grid-cols-3">
      {[{ label: 'Communities', value: communities.length, icon: Compass }, { label: 'Accounts synced', value: `${checkedCount} / ${accountCount}`, icon: Users }, { label: 'Joined / awaiting approval', value: `${memberships - pending} / ${pending}`, icon: CheckCheck }].map(({ label, value, icon: Icon }) => <div key={label} className="flex items-center gap-4 rounded-xl border border-line bg-card p-4"><span className="rounded-lg bg-primary/10 p-2.5 text-primary"><Icon size={19} /></span><div><p className="text-2xl font-semibold tracking-tight text-ink">{value}</p><p className="text-xs text-ink-muted">{label}</p></div></div>)}
    </div>
    {accountSummaries.length > 0 && <div className="flex flex-wrap gap-2">{accountSummaries.map(([id, account]) => <p key={id} className="rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-secondary"><span className="font-medium text-ink">{account.name}</span> · {account.joined} joined{account.pending > 0 ? ` · ${account.pending} awaiting approval` : ''}</p>)}</div>}
    <div className="flex flex-col gap-3 sm:flex-row"><SearchBar value={query} onValueChange={q => setParams(q ? { q } : {}, { replace: true })} label="Search joined communities" placeholder="Search your communities or accounts…" className="flex-1" /><select aria-label="Sort joined communities" value={sort} onChange={event => setSort(event.target.value)} className="h-10 rounded-lg border border-line bg-card px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"><option value="name">Name</option><option value="recent">Recently joined</option><option value="members">Most members</option></select></div>
    {error && <div role="alert" className="rounded-xl border border-primary/30 bg-card p-4 text-sm text-ink-secondary"><p>{error}</p><Button variant="secondary" className="mt-3" onClick={() => setRefresh(value => value + 1)}>Retry</Button></div>}
    {warnings.length > 0 && <div role="alert" className="space-y-2 rounded-xl border border-warning/30 bg-card p-4 text-sm text-ink-secondary"><p className="font-medium text-warning">Some accounts could not be fully synced</p><ul className="space-y-1">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><Link to="/accounts" className="inline-block text-primary">Manage accounts →</Link></div>}
    {loading && <p role="status" className="text-sm text-ink-muted">Syncing memberships from your accounts… {checkedCount} synced.</p>}
    {query && <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-secondary"><p>Search is filtering your list: “{query}”</p><button type="button" onClick={() => setParams({})} className="shrink-0 font-medium text-primary">Show all communities</button></div>}
    {visible.length > 0 ? <><p className="text-xs text-ink-muted">Showing {visible.length} of {communities.length} communities · All synced accounts included.</p><div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-5">{visible.map(community => <JoinedCommunityCard key={community.id} community={community} memberships={community.memberships} />)}</div></>
      : !loading && !error && <div className="rounded-xl border border-line bg-card px-6 py-12 text-center"><CheckCheck size={30} className="mx-auto mb-4 text-ink-muted" /><h2 className="text-lg font-semibold">{query ? 'No matching communities' : warnings.length ? 'No confirmed communities loaded' : 'No joined communities yet'}</h2><p className="mx-auto mt-2 max-w-md text-sm text-ink-secondary">{query ? 'Try another name or clear your search.' : accountCount === 0 ? 'Connect your Skool accounts to see the communities you belong to.' : warnings.length ? 'Resolve the account warnings and refresh to finish syncing.' : 'Join a community from Discover, then return here to see your memberships.'}</p><div className="mt-5">{query ? <Button variant="secondary" onClick={() => setParams({})}>Clear search</Button> : <Link to={accountCount === 0 ? '/accounts' : '/discover'} className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">{accountCount === 0 ? 'Connect an account' : 'Discover communities'}</Link>}</div></div>}
  </div>;
}

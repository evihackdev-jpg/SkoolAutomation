import { Compass, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listAccounts, request } from '../api/accounts';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { SearchBar } from '../components/SearchBar';
import type { AccountRecord } from '../types';
import { DiscoveryCard, type DiscoveryCommunity } from '../components/DiscoveryCard';
import { DiscoveryFilters } from './DiscoveryFilters';
import { bulkRunning, type BulkJoinJob } from './BulkJoinPanel';
import type { JoinResult } from './DiscoveryCard';

interface Category { id: string; name: string }
interface DiscoveryResult { communities: DiscoveryCommunity[]; categories: Category[]; languages: Category[]; page: number; total: number | null; hasMore: boolean }
const control = 'h-10 rounded-lg border border-line bg-card px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/40';

export function CommunitySearch() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') || '').trim();
  const category = params.get('category') || '';
  const price = params.get('price') || '';
  const type = params.get('type') || '';
  const sourceSort = params.get('sort') || 'trending';
  const language = params.get('language') || 'english';
  const requestedPage = Number(params.get('page') || 1);
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 100 ? requestedPage : 1;
  const [draft, setDraft] = useState(query);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [accountsReady, setAccountsReady] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [data, setData] = useState<DiscoveryResult | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [languages, setLanguages] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [minMembers, setMinMembers] = useState('');
  const [bulkJob,setBulkJob]=useState<BulkJoinJob|null>(null);
  const connected = useMemo(() => accounts.filter(account => account.status === 'active'), [accounts]);
  const accountKey = connected.map(account => account.id).join(':');
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await request<{ jobs: BulkJoinJob[] }>('/api/communities/bulk-join', { signal: controller.signal });
        if (!controller.signal.aborted) setBulkJob(result.jobs[0] || null);
      } catch { /* Keep the last known join state until the next refresh. */ }
      finally { loading = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  useEffect(() => { setDraft(query); }, [query]);
  useEffect(() => {
    let active = true;
    setAccountsReady(false); setAccountError(null);
    listAccounts().then(result => {
      if (!active) return;
      setAccounts(result.accounts);
    }).catch(failure => { if (active) setAccountError(failure.message); })
      .finally(() => { if (active) setAccountsReady(true); });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    if (!accountsReady || !connected.length || accountError) { setLoading(false); setData(null); setError(null); return; }
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(null); setData(null);
    const search = new URLSearchParams({ q: query, category, price, type, sort: sourceSort, language, page: String(page) });
    request<DiscoveryResult>('/api/discover?' + search, { signal: controller.signal }).then(result => {
      if (!active) return;
      setData(result);
      if (result.categories.length) setCategories(result.categories);
      if (result.languages?.length) setLanguages(result.languages);
    }).catch(failure => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [accountsReady, accountKey, connected.length, accountError, query, category, price, type, sourceSort, language, page, refresh]);
  const visible = useMemo(() => {
    const minimum = Number(minMembers) || 0;
    const result = (data?.communities || []).filter(community => !minimum || (community.members !== null && community.members >= minimum));
    return result;
  }, [data, minMembers]);
  const updateFilters = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    next.set('page', '1');
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next);
  };
  const resetFilters = () => { setMinMembers(''); setParams(query ? { q: query } : {}); };
  const search = (event: FormEvent) => {
    event.preventDefault();
    setMinMembers('');
    updateFilters({ q: draft.trim() });
  };
  const changePage = (page: number) => { const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next); };
  return <div className="space-y-5">
    <PageHeader title="Discover Communities" subtitle="Find your next community. Each click joins with one randomly chosen connected account."
      actions={<Button variant="secondary" icon={<RefreshCw size={15} />} disabled={loading || !accountsReady} onClick={() => setRefresh(value => value + 1)}>Refresh</Button>} />
    <form role="search" onSubmit={search} className="flex flex-col gap-3 sm:flex-row">
      <SearchBar value={draft} onValueChange={setDraft} label="Search communities" placeholder="Search by keyword…" maxLength={200} className="flex-1" />
      <Button type="submit" disabled={!connected.length || loading || !accountsReady || Boolean(accountError)}>Search</Button>
    </form>
    <div className="flex flex-wrap gap-3">
      <label className="flex flex-col gap-1 text-xs text-ink-secondary">Category<select value={category} onChange={event => updateFilters({ category: event.target.value })} className={control}>
        <option value="">All categories</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label className="flex flex-col gap-1 text-xs text-ink-secondary">Minimum members on this page<input type="number" min="0" value={minMembers} onChange={event => setMinMembers(event.target.value)} placeholder="Any" className={control + ' w-40'} /></label>
    <DiscoveryFilters price={price} type={type} sort={sourceSort} language={language} languages={languages} keywordSearch={Boolean(query)} onChange={(key, value) => updateFilters({ [key]: value })} onReset={resetFilters} />
    </div>
    {connected.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card px-4 py-3"><span className="mr-1 text-xs font-medium text-success">Random selection · {connected.length} connected {connected.length === 1 ? 'account' : 'accounts'}</span>{connected.map(account => <span key={account.id} className="rounded-md bg-elevated px-2 py-1 text-xs text-ink-secondary">{account.displayName}</span>)}<Link to="/joined-communities" className="ml-auto text-xs font-medium text-primary">Communities I Joined →</Link></div>}
    {accountsReady && accounts.length > connected.length && <p className="text-xs text-warning">{accounts.length - connected.length} account(s) need verification before they can join. <Link to="/accounts" className="underline">Manage accounts</Link></p>}
    {(accountError || error) && <div role="alert" className="space-y-3 rounded-card border border-primary/30 bg-card p-5"><p className="text-sm text-ink-secondary">{accountError || error}</p><div className="flex items-center gap-4"><Button variant="secondary" onClick={() => setRefresh(value => value + 1)}>Retry</Button><Link to="/accounts" className="text-sm text-primary">Manage Accounts</Link></div></div>}
    {!accountsReady || loading ? <p role="status" className="py-12 text-center text-ink-secondary">Loading communities from Skool…</p>
      : !accountError && !connected.length ? <div className="space-y-3 rounded-card border border-line bg-card p-6"><h2 className="text-lg font-semibold text-ink">Connect your Skool account</h2><p className="text-sm text-ink-secondary">Add or verify your account to search live communities.</p><Link to="/accounts" className="inline-block text-sm font-medium text-primary">Go to Accounts →</Link></div>
      : data && !error && <>
        <p role="status" className="text-sm text-ink-muted">Page {page} · {visible.length} of {data.communities.length} communities on this page{data.total !== null ? ` · ${data.total.toLocaleString()} results reported by Skool` : ''}</p>
        {visible.length === 0 ? <div className="space-y-3 rounded-card border border-line bg-card p-8 text-center"><Compass size={28} className="mx-auto text-ink-muted" /><h2 className="font-semibold text-ink">No communities match</h2><p className="text-sm text-ink-secondary">Try another keyword, category, or minimum member count.</p><Button variant="secondary" onClick={() => { setParams({}); setMinMembers(''); }}>Reset filters</Button></div>
          : <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-5">{visible.map(community => {
            const bulk=bulkJob?.results.find(result=>result.url===community.url);
            const result=bulk&&['joined','pending','action_required','unconfirmed','error'].includes(bulk.status)?bulk as JoinResult:undefined;
            return <DiscoveryCard key={`${accountKey}:${community.id}`} community={community} accounts={connected} bulkResult={result} bulkActive={bulkRunning(bulkJob)} />;
          })}</div>}
        <div className="flex items-center justify-between gap-3"><Button variant="secondary" disabled={page <= 1} onClick={() => changePage(page - 1)}>Previous</Button><span className="text-sm text-ink-muted">Page {page}</span><Button variant="secondary" disabled={!data.hasMore || page >= 100} onClick={() => changePage(page + 1)}>Next</Button></div>
      </>}
  </div>;
}

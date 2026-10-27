import { Check, Clock, ExternalLink, ImageIcon, Star, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../api/accounts';

export interface DiscoveryCommunity {
  id: string; name: string; description: string; members: number | null; url: string; price: string | null;
  coverUrl: string | null; logoUrl: string | null; rating: number | null; reviewCount: number | null;
}
export interface CommunityAccount { id: string; displayName: string }
export interface CommunityMembership extends CommunityAccount { identifier?: string; role: string; joinedAt: string | null }
export const communityCardClass = 'flex h-full flex-col overflow-hidden rounded-xl border border-line bg-card text-ink shadow-sm transition hover:border-ink-muted/50';

function CommunityImage({ url, name, cover = false }: { url: string | null; name: string; cover?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <div className={cover ? 'aspect-[1.91/1] w-full overflow-hidden bg-elevated' : 'h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-elevated'}>
    {url && failedUrl !== url
      ? <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} className="h-full w-full object-cover" />
      : <div className="flex h-full items-center justify-center text-ink-muted" aria-hidden="true">{cover ? <ImageIcon size={32} strokeWidth={1.5} /> : <span className="text-xs font-semibold">{name.slice(0, 2).toUpperCase()}</span>}</div>}
  </div>;
}

function CommunityDetails({ community }: { community: DiscoveryCommunity }) {
  return <>
    <CommunityImage url={community.coverUrl} name={community.name} cover />
    <div className="flex w-full flex-1 flex-col p-4">
      <div className="flex min-w-0 items-center gap-2.5"><CommunityImage url={community.logoUrl} name={community.name} /><h2 className="line-clamp-2 text-sm font-semibold leading-5" title={community.name}>{community.name}</h2></div>
      <p className="mb-4 mt-3 line-clamp-3 min-h-[60px] whitespace-pre-line text-[13px] leading-5 text-ink-secondary">{community.description || 'No description provided.'}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs leading-5 text-ink-secondary tabular-nums">
        {community.members !== null && <span className="inline-flex items-center gap-1" title={`${community.members.toLocaleString()} members`}><UserRound size={13} className="text-ink-muted" aria-hidden="true" />{community.members.toLocaleString()}</span>}
        {community.rating != null && <span className="inline-flex items-center gap-1" title={`Rated ${community.rating.toFixed(1)} out of 5`}><Star size={13} className="fill-amber-400 text-amber-400" aria-hidden="true" />{community.rating.toFixed(1)}{community.reviewCount != null ? ` (${community.reviewCount.toLocaleString()})` : ''}</span>}
        <span className="ml-auto font-medium text-ink">{community.price || 'See pricing'}</span>
      </div>
    </div>
  </>;
}

export interface JoinResult { status: 'joined' | 'pending' | 'action_required' | 'unconfirmed' | 'error'; message: string; url: string; account?: CommunityAccount; missingQuestions?: string[] }

export function DiscoveryCard({ community, accounts, bulkResult, bulkActive = false }: { community: DiscoveryCommunity; accounts: CommunityAccount[]; bulkResult?: JoinResult; bulkActive?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JoinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const joining = useRef(false);
  const selected = useRef<CommunityAccount | null>(null);
  const mounted = useRef(true);
  const checkDelay = useRef(30000);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(()=>{
    if(!bulkResult)return;
    if(bulkResult.account)selected.current=bulkResult.account;
    setResult(old=>old?.status==='joined'&&bulkResult.status!=='joined'?old:bulkResult);
    setError(null);
  },[bulkResult]);
  useEffect(() => {
    if (busy || !selected.current || !['pending','unconfirmed'].includes(result?.status || '')) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({accountId:selected.current!.id,groupName:new URL(community.url).pathname.split('/')[1]});
      void request<JoinResult>(`/api/communities/membership?${params}`,{signal:controller.signal}).then(data=>{
        checkDelay.current = data.status === 'pending' ? 60000 : 30000;
        if (mounted.current && !controller.signal.aborted) setResult({...data,account:selected.current || undefined});
      }).catch(failure=>{
        checkDelay.current = /rate.limit/i.test(failure instanceof Error ? failure.message : '') ? 900000 : 60000;
        // A failed read does not turn a pending request into a failed join.
        if (mounted.current && !controller.signal.aborted) setResult(old=>old?{...old}:old);
      });
    },checkDelay.current);
    return () => {window.clearTimeout(timer);controller.abort();};
  },[busy,result,community.url]);
  const done = result?.status === 'joined' || result?.status === 'pending';
  const join = async () => {
    if (joining.current || done || !accounts.length) return;
    joining.current = true; setBusy(true); setError(null);
    const groupName = new URL(community.url).pathname.split('/')[1];
    try {
      if (!selected.current) {
        const selection = await request<{ account: CommunityAccount }>('/api/communities/random-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupName }) });
        selected.current = selection.account;
      }
      if (!mounted.current) return;
      const chosen = selected.current;
      setResult({ status: 'unconfirmed', message: 'Joining and answering membership questions…', url: community.url, account: chosen });
      const response = await request<JoinResult>('/api/communities/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupName, accountId: chosen.id }),
      }, 150000);
      selected.current = response.account || chosen;
      if (mounted.current) setResult({ ...response, account: selected.current || undefined });
    } catch (failure) { if (mounted.current) { setResult(null); setError(failure instanceof Error ? failure.message : 'Could not join.'); } }
    finally { joining.current = false; if (mounted.current) setBusy(false); }
  };
  return <article className={communityCardClass}>
    <button type="button" onClick={() => void join()} disabled={bulkActive || busy || done || !accounts.length} aria-busy={busy} aria-label={`Join ${community.name} with one randomly selected connected account`}
      className="flex flex-1 flex-col text-left transition hover:bg-elevated/50 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
      <CommunityDetails community={community} />
      <span className="mx-4 mb-4 flex items-center justify-center gap-2 self-stretch rounded-lg bg-primary/15 px-3 py-2 text-xs font-semibold text-primary">{busy ? 'Joining…' : result?.status === 'joined' ? 'Joined ✓' : result?.status === 'pending' ? 'Awaiting approval' : bulkActive ? 'Automatic joining in progress' : selected.current ? `Retry with ${selected.current.displayName}` : 'Join with a random account'}</span>
    </button>
    <div className="space-y-2 border-t border-line px-4 py-3 text-xs leading-5">
      {result && <div aria-live="polite">{result.account && <p className="font-medium text-ink">{result.account.displayName}</p>}<p className={result.status === 'error' ? 'text-primary' : result.status === 'joined' ? 'text-success' : 'text-ink-secondary'}>{result.message}</p></div>}
      {error && <p role="alert" className="text-primary">{error}</p>}
      {!!result?.missingQuestions?.length && <Link to="/settings" className="block font-medium text-primary hover:underline">Add your answer in Settings</Link>}
      {error && selected.current && <p className="text-ink-secondary">Account: {selected.current.displayName}. Retrying uses this same account.</p>}
      <a href={result?.url || community.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-ink-secondary hover:text-ink">{result?.status === 'action_required' ? 'Continue on Skool' : 'View on Skool'}<ExternalLink size={12} /></a>
    </div>
  </article>;
}

export function JoinedCommunityCard({ community, memberships }: { community: DiscoveryCommunity; memberships: CommunityMembership[] }) {
  const pending = memberships.filter(member => member.role === 'pending').length;
  const joined = memberships.length - pending;
  return <article className={communityCardClass}>
    <a href={community.url} target="_blank" rel="noopener noreferrer" className="flex flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" aria-label={`Open ${community.name} on Skool`}><CommunityDetails community={community} /></a>
    <div className="space-y-3 border-t border-line px-4 py-3">
      <p className="break-all text-xs text-ink-muted">{community.url.replace(/^https:\/\/(www\.)?/, '')}</p>
      <div className="flex flex-wrap gap-3 text-xs font-medium">{joined > 0 && <span className="inline-flex items-center gap-1.5 text-success"><Check size={14} />Joined · {joined} {joined === 1 ? 'account' : 'accounts'}</span>}{pending > 0 && <span className="inline-flex items-center gap-1.5 text-warning"><Clock size={14} />Awaiting approval · {pending}</span>}</div>
      <div className="flex flex-wrap gap-1.5">{memberships.map(member => <span key={member.id} title={member.role === 'pending' ? 'Membership request awaiting approval' : member.joinedAt ? `Joined ${new Date(member.joinedAt).toLocaleDateString()}` : 'Confirmed membership'} className="rounded-md border border-line bg-elevated px-2 py-1 text-xs text-ink-secondary">{member.displayName}{member.identifier && <span className="ml-1 text-ink-muted">{member.identifier}</span>}{member.role === 'pending' ? ' · Pending' : member.role === 'group-admin' ? ' · Admin' : member.role === 'group-moderator' ? ' · Moderator' : ''}</span>)}</div>
      <a href={community.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-hover">Open community<ExternalLink size={12} /></a>
    </div>
  </article>;
}

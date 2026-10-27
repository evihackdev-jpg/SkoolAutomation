import { AlertCircle, ArrowRight, Compass, RefreshCw, ShieldCheck, UserCog, UserRoundSearch } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAccounts } from '../api/accounts';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import type { AccountRecord } from '../types';
import { cn } from '../utils/format';
import { toneClasses } from '../utils/icons';

const linkStyle = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';

function verifiedDate(value?: string) {
  if (!value) return 'Not verified yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not verified yet' : `Verified ${date.toLocaleString()}`;
}

export function DashboardPage() {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    let requestId = 0;
    const refresh = async () => {
      const currentRequest = ++requestId;
      setLoading(true);
      setError(null);
      try {
        const result = await listAccounts();
        if (active && currentRequest === requestId) setAccounts(result.accounts);
      } catch (failure) {
        if (active && currentRequest === requestId) setError(failure instanceof Error ? failure.message : 'Could not load your accounts.');
      } finally {
        if (active && currentRequest === requestId) setLoading(false);
      }
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { active = false; window.removeEventListener('focus', onFocus); };
  }, [reloadKey]);

  const unavailable = loading || Boolean(error);
  const metrics = [
    { label: 'Accounts', value: accounts.length, icon: UserCog, tone: 'purple' as const },
    { label: 'Connected', value: accounts.filter(a => a.status === 'active').length, icon: ShieldCheck, tone: 'green' as const },
    { label: 'Needs Cookies', value: accounts.filter(a => a.status === 'inactive').length, icon: AlertCircle, tone: 'orange' as const },
    { label: 'Not Checked', value: accounts.filter(a => a.status === 'unverified').length, icon: UserRoundSearch, tone: 'blue' as const },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Your Skool accounts and community discovery progress."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={loading} icon={<RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />} onClick={() => setReloadKey(value => value + 1)}>{loading ? 'Refreshing…' : 'Refresh'}</Button>
          <Link to="/accounts" className={linkStyle}>Manage Accounts</Link>
        </div>} />

      <section aria-label="Account metrics" aria-busy={loading} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => <StatCard key={metric.label} {...metric} value={unavailable ? '—' : metric.value} />)}
      </section>
      <section className="flex flex-col justify-between gap-4 rounded-xl border border-primary/25 bg-card p-5 sm:flex-row sm:items-center"><div><h2 className="font-semibold">Put your community goal into motion</h2><p className="mt-1 text-sm text-ink-muted">Find suitable communities, join, and publish tailored articles with Auto Mode.</p></div><Link to="/auto-mode" className={`${linkStyle} shrink-0`}>Open Auto Mode <ArrowRight size={15} /></Link></section>

      {error && <div role="alert" className="space-y-3 rounded-card border border-primary/30 bg-card p-4">
        <p className="font-medium text-ink">Could not load your dashboard</p>
        <p className="text-sm text-ink-secondary">{error}</p>
        <Button variant="secondary" onClick={() => setReloadKey(value => value + 1)}>Retry</Button>
      </div>}

      <section aria-labelledby="your-accounts" aria-busy={loading} className="overflow-hidden rounded-card border border-line bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id="your-accounts" className="text-[17px] font-semibold text-ink">Your Accounts</h2>
          <Link to="/accounts" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:text-primary-hover">Manage <ArrowRight size={14} /></Link>
        </div>
        {loading ? <p role="status" className="px-4 py-8 text-sm text-ink-secondary">Loading your saved accounts…</p>
          : error ? <p className="px-4 py-8 text-sm text-ink-muted">Account details will appear when the connection is restored.</p>
          : accounts.length === 0 ? <div className="space-y-3 p-6">
            <h3 className="font-semibold text-ink">Connect your first Skool account</h3>
            <p className="text-sm text-ink-secondary">Import your signed-in cookies to verify your profile and see it here.</p>
            <Link to="/accounts" className={linkStyle}>Add Account</Link>
          </div> : <ul className="divide-y divide-line">
            {accounts.map(account => <li key={account.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold', toneClasses[account.avatarTone])} aria-hidden="true">{account.displayName.charAt(0).toUpperCase()}</span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-ink">{account.displayName}</p>
                  <p className="text-xs text-ink-secondary">{account.identifier || 'Imported with cookies'}</p>
                  <p className="mt-1 text-xs text-ink-muted">{verifiedDate(account.verifiedAt)}</p>
                  {account.verificationError && <p className="mt-2 max-w-xl text-xs text-primary">{account.verificationError}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', account.status === 'active' ? 'border-success/30 bg-success-bg text-success' : account.status === 'inactive' ? 'border-warning/30 text-warning' : 'border-line text-ink-secondary')}>
                  {account.status === 'active' ? 'Connected' : account.status === 'inactive' ? 'Needs cookies' : 'Not checked'}
                </span>
                {account.status !== 'active' && <Link to="/accounts" className="text-xs font-medium text-primary hover:text-primary-hover">{account.status === 'inactive' ? 'Update cookies' : 'Verify session'}</Link>}
              </div>
            </li>)}
          </ul>}
        {!unavailable && accounts.length > 0 && <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">Connection status reflects the last session check. Manage Accounts lets you verify again or update cookies.</p>}
      </section>

      <section aria-labelledby="discovery-progress" className="rounded-card border border-line bg-card p-5">
        <div className="flex items-start gap-3">
          <Compass size={22} className="mt-0.5 shrink-0 text-ink-muted" />
          <div className="space-y-2">
            <h2 id="discovery-progress" className="text-[17px] font-semibold text-ink">Community Discovery</h2>
            <p className="text-sm text-ink-secondary">Search live Skool communities by keyword and category, or use Auto Mode for goal-based matching, publishing, and run history.</p>
            <Link to="/discover" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover">Discover communities <ArrowRight size={14} /></Link>
          </div>
        </div>
      </section>
    </div>
  );
}

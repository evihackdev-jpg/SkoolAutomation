import { ArrowRight, ArrowUpRight, Bot, Check, CheckCheck, CircleCheck, Clock3, Compass, FileText, LoaderCircle, Play, Settings2, Sparkles, Square, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { request, listAccounts } from '../api/accounts';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import type { AccountRecord } from '../types';

interface Result { groupName: string; name: string; url: string; score?: number; reason: string; source: string; account: { id: string; displayName: string }; status: string; message: string; article?: { title: string; content: string }; categoryName?: string; postMode?: 'as_is' | 'refined' | 'generated' }
interface Run { selectionMode?: 'all'; selectionCount?: number; id: string; goal: string; post?: PostDraft | null; postingMode?: 'count' | 'interval'; intervalMinutes?: number | null; waitReason?: 'retry' | 'interval' | null; status: string; stage: string; failedStage?: string; nextAttemptAt?: string | null; matching?: { total: number; evaluated: number; matched: number; skipped: number }; cancelRequested: boolean; results: Result[]; events: { at: string; message: string; outcome?: 'success' | 'unsuccessful' }[]; createdAt: string; limit: number | null; discover: boolean; existing: boolean }
interface State { runs: Run[]; configured: boolean }
interface PostDraft { title: string; content: string; refineWithAI: boolean }
const running = (run: Run) => ['queued','running','waiting'].includes(run.status);
const label = (status: string) => ({ waiting: 'Waiting to retry', needs_attention: 'Needs attention', action_required: 'Details needed', unconfirmed: 'Check on Skool', ready: 'Article ready', pending: 'Awaiting approval' }[status] || status.replace(/_/g,' '));
const runLabel = (run: Run) => run.status === 'waiting' && run.waitReason === 'interval' ? 'Scheduled' : label(run.status);

export function AutoModePage() {
  const [state, setState] = useState<State | null>(null);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [postTitle, setPostTitle] = useState('');
  const [postContent, setPostContent] = useState('');
  const [refineWithAI, setRefineWithAI] = useState(true);
  const [discover, setDiscover] = useState(true);
  const [existing, setExisting] = useState(true);
  const [limit, setLimit] = useState(3);
  const [postingMode, setPostingMode] = useState<'count' | 'interval'>('count');
  const [intervalMinutes, setIntervalMinutes] = useState('1');
  const [selected, setSelected] = useState<string | null>(null);
  const [activityView, setActivityView] = useState<'activity' | 'history'>('activity');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  const initialized = useRef(false);
  const fetching = useRef(false);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    const version = loadVersion.current;
    try {
      const [data, accountData] = await Promise.all([request<State>('/api/automation'), listAccounts()]);
      if (!alive.current || version !== loadVersion.current) return;
      setState(data); setAccounts(accountData.accounts); setError(null);
      if (!initialized.current) {
        const latest = data.runs[0];
        if (latest) { setDiscover(latest.discover); setExisting(latest.existing); setLimit(latest.limit ?? 3); setPostingMode(latest.postingMode ?? 'count'); setIntervalMinutes(String(latest.intervalMinutes ?? 1)); setPostTitle(latest.post?.title || ''); setPostContent(latest.post?.content || ''); setRefineWithAI(latest.post?.refineWithAI ?? true); }
        initialized.current = true;
      }
    } catch (failure) { if (alive.current && version === loadVersion.current) setError(failure instanceof Error ? failure.message : 'Could not load Auto Mode.'); }
    finally { fetching.current = false; if (alive.current) setLoaded(true); }
  }, []);
  useEffect(() => { alive.current = true; void load(); const timer = window.setInterval(() => { void load(); }, 4000); return () => { alive.current = false; window.clearInterval(timer); }; }, [load]);
  const active = state?.runs.find(running);
  const current = state?.runs.find(r => r.id === selected) || active || state?.runs[0];
  const connected = accounts.filter(a => a.status === 'active').length;
  const published = current?.results.filter(r => r.status === 'published').length || 0;
  const postError = (!postTitle.trim() || !postContent.trim()) ? 'Enter both a title and content for your post.' : '';
  const intervalError = postingMode === 'interval' && (!Number.isInteger(Number(intervalMinutes)) || Number(intervalMinutes) < 1 || Number(intervalMinutes) > 1440) ? 'Enter an interval from 1 to 1,440 whole minutes.' : '';
  const scheduleSummary = postingMode === 'interval' ? `One post every ${intervalMinutes || '…'} ${Number(intervalMinutes) === 1 ? 'minute' : 'minutes'} · Until stopped` : `Target: ${limit} ${limit === 1 ? 'post' : 'posts'}`;
  const successfulResults = current?.results.filter(result => result.status === 'published') || [];
  const successfulEvents = current?.events.filter(event => event.outcome === 'success' || (!event.outcome && successfulResults.some(result => event.message === `${result.name}: ${result.message}`))) || [];
  const start = async (event: FormEvent) => {
    event.preventDefault(); if (busy || active) return;
    if (postError || intervalError) { setError(postError || intervalError); return; }
    setBusy(true); setError(null); setNotice('');
    try {
      const post: PostDraft = { title: postTitle, content: postContent, refineWithAI };
      const data = await request<{ run: Run }>('/api/automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discover, existing, postingMode, ...(postingMode === 'count' ? { limit } : { intervalMinutes: Number(intervalMinutes) }), post }) });
      if (alive.current) { setActivityView('activity'); setSelected(data.run.id); setState(old => old ? { ...old, runs: [data.run, ...old.runs] } : null); }
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not start Auto Mode.'); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    if (!active || busy) return;
    setBusy(true);
    try { await request(`/api/automation/${active.id}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setNotice('Stopping after the current request. A post already being sent may still complete.'); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not stop the run.'); }
    finally { setBusy(false); }
  };
  const clearHistory = async () => {
    if (busy || clearing) return;
    setClearing(true); setBusy(true); setError(null); setNotice('');
    try {
      const result = await request<{ cleared: number }>('/api/automation/history', { method: 'DELETE' });
      if (!alive.current) return;
      // Ignore polls started before deletion so cleared entries cannot reappear.
      loadVersion.current++;
      setState(old => old ? { ...old, runs: old.runs.filter(running) } : old);
      setSelected(null);
      setNotice(`${result.cleared} finished ${result.cleared === 1 ? 'run' : 'runs'} cleared. Active runs and duplicate-post protection are preserved.`);
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'Could not clear recent runs.'); }
    finally { if (alive.current) { setClearing(false); setBusy(false); } }
  };
  const startDisabled = !loaded || !state?.configured || !connected || !!active || busy || !!postError || !!intervalError || (!discover && !existing);
  const readiness = !loaded ? 'Loading your workspace…' : active ? 'A run is in progress' : !state?.configured ? 'Configure AI to get started' : !connected ? 'Connect an account to get started' : postError ? 'Complete your post' : intervalError ? 'Set a valid posting interval' : !discover && !existing ? 'Choose where to publish' : 'Ready to start';
  const runTone = (status: string) => status === 'completed' ? 'bg-success/10 text-success' : running({ status } as Run) ? 'bg-primary/10 text-primary' : ['failed','needs_attention','interrupted'].includes(status) ? 'bg-warning/10 text-warning' : 'bg-elevated text-ink-secondary';

  return <div className="space-y-6 pb-4">
    <PageHeader title="Auto Mode" subtitle="Find your communities. Share something that matters." actions={
      <Link to="/settings" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs font-medium text-ink-secondary transition hover:border-ink-muted/50 hover:text-ink"><Settings2 size={14} />Membership profile<ArrowUpRight size={13} /></Link>
    } />

    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary"><span className="min-w-0 flex-1">{error}</span><Button variant="ghost" onClick={() => void load()}>Retry</Button></div>}
    {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-line bg-card px-4 py-3 text-xs leading-5 text-ink-secondary"><CircleCheck size={15} className="mt-0.5 shrink-0 text-success" />{notice}</p>}

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <form onSubmit={start} className="min-w-0 overflow-hidden rounded-2xl border border-line bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5"><span className="rounded-lg bg-primary/10 p-2 text-primary"><Bot size={18} /></span><h2 className="text-sm font-semibold">Create a run</h2></div>
          <div className="flex items-center gap-3 text-[11px] text-ink-secondary">
            <Link to="/accounts" className="inline-flex items-center gap-1.5 hover:text-ink"><Users size={13} />{loaded ? connected : '…'} {connected === 1 ? 'account' : 'accounts'}</Link>
            <span className="h-3 w-px bg-line" />
            <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${state?.configured ? 'bg-success' : 'bg-ink-muted'}`} />{!state ? 'Checking AI' : state.configured ? 'AI ready' : 'AI unavailable'}</span>
          </div>
        </div>

        <fieldset disabled={Boolean(active)} className="min-w-0 space-y-3 px-5 py-5 sm:px-6">
          <legend className="sr-only">Post content</legend>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5"><span className="text-[11px] font-semibold tabular-nums text-primary">01</span><h2 className="text-sm font-semibold">Compose your post</h2></div>
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${refineWithAI ? 'border-primary/25 bg-primary/5 text-ink' : 'border-line text-ink-secondary'}`}>
              <input type="checkbox" checked={refineWithAI} onChange={e => setRefineWithAI(e.target.checked)} className="h-3.5 w-3.5 accent-primary" /><Sparkles size={13} className={refineWithAI ? 'text-primary' : 'text-ink-muted'} />Refine with AI
            </label>
          </div>
          <p className="text-xs leading-5 text-ink-muted">{refineWithAI ? 'Write your post. AI will refine it before posting.' : 'Your title and content will be published exactly as you enter them.'}</p>
          <div className="overflow-hidden rounded-xl border border-line bg-app transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
            <label htmlFor="post-title" className="sr-only">Post title</label>
            <input id="post-title" type="text" required maxLength={150} value={postTitle} onChange={e => setPostTitle(e.target.value)} placeholder="Give your post a title" className="w-full border-0 border-b border-line/70 bg-transparent px-4 py-3.5 text-base font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-muted disabled:opacity-60" />
            <label htmlFor="post-content" className="sr-only">Post content</label>
            <textarea id="post-content" required maxLength={10000} rows={5} value={postContent} onChange={e => setPostContent(e.target.value)} placeholder="What would you like to share with the community?" className="block min-h-[144px] w-full resize-y border-0 bg-transparent px-4 py-3 text-sm leading-6 text-ink outline-none placeholder:text-ink-muted disabled:opacity-60" />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-4 py-2 text-[10px] text-ink-muted"><span className="inline-flex items-center gap-1.5"><FileText size={12} />{refineWithAI ? 'AI refinement' : 'Post as-is'}</span><span className="tabular-nums">Title {postTitle.length}/150 · Content {postContent.length.toLocaleString()}/10,000</span></div>
          </div>
          {postError && <p role="status" className="text-xs text-warning">{postError}</p>}
        </fieldset>

        <fieldset disabled={Boolean(active)} className="space-y-4 border-t border-line px-5 py-5 sm:px-6">
          <legend className="sr-only">Audience</legend>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5"><span className="text-[11px] font-semibold tabular-nums text-primary">02</span><h2 className="text-sm font-semibold">Where to publish</h2></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[{ checked: discover, set: setDiscover, icon: Compass, title: 'Discover new', detail: 'Try free communities across search pages.' }, { checked: existing, set: setExisting, icon: CheckCheck, title: 'Already joined', detail: 'Try joined communities across all accounts.' }].map(({checked,set,icon:Icon,title,detail}) => <label key={title} className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition ${checked ? 'border-primary/30 bg-primary/[0.04]' : 'border-line hover:border-ink-muted/40'}`}>
              <Icon size={18} className={`mt-0.5 shrink-0 ${checked ? 'text-primary' : 'text-ink-muted'}`} /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{title}</span><span className="mt-1 block text-[11px] leading-4 text-ink-muted">{detail}</span></span><input type="checkbox" checked={checked} onChange={e => set(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary" />
            </label>)}
          </div>
          <p className="text-[11px] text-ink-muted">No relevance or content-rule filters. General is selected when available.</p>
        </fieldset>

        <fieldset disabled={Boolean(active)} className="space-y-4 border-t border-line px-5 py-5 sm:px-6">
          <legend className="sr-only">Posting schedule</legend>
          <div className="flex items-center gap-2.5"><span className="text-[11px] font-semibold tabular-nums text-primary">03</span><h2 className="text-sm font-semibold">Posting schedule</h2></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[{ value: 'count' as const, title: 'By post count', detail: 'Finish when your target is reached.', icon: CheckCheck }, { value: 'interval' as const, title: 'By time interval', detail: 'Keep posting until you stop the run.', icon: Clock3 }].map(({ value, title, detail, icon: Icon }) => <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition ${postingMode === value ? 'border-primary/30 bg-primary/[0.04]' : 'border-line hover:border-ink-muted/40'}`}>
              <Icon size={18} className={`mt-0.5 shrink-0 ${postingMode === value ? 'text-primary' : 'text-ink-muted'}`} /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{title}</span><span className="mt-1 block text-[11px] leading-4 text-ink-muted">{detail}</span></span><input type="radio" name="posting-mode" value={value} checked={postingMode === value} onChange={() => setPostingMode(value)} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary" />
            </label>)}
          </div>
          {postingMode === 'count' ? <label htmlFor="auto-limit" className="flex items-center gap-3 text-xs text-ink-secondary">Number of posts<select id="auto-limit" value={limit} onChange={e => setLimit(Number(e.target.value))} className="rounded-lg border border-line bg-app px-3 py-2 text-sm text-ink outline-none focus:border-primary">{Array.from({ length: 20 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select></label> : <>
            <label htmlFor="auto-interval" className="flex flex-wrap items-center gap-3 text-xs text-ink-secondary">Publish one post every<input id="auto-interval" type="number" min={1} max={1440} step={1} required value={intervalMinutes} onChange={e => setIntervalMinutes(e.target.value)} aria-describedby="interval-help" className="w-24 rounded-lg border border-line bg-app px-3 py-2 text-sm text-ink outline-none focus:border-primary" />minutes</label>
            <p id="interval-help" className="text-[11px] leading-5 text-ink-muted">The first post starts immediately. Each later post waits at least this interval. Runs continue while the backend is running; approvals, failed attempts, and cooldowns can delay a post.</p>
            {intervalError && <p role="status" className="text-xs text-warning">{intervalError}</p>}
          </>}
        </fieldset>

        <div className="border-t border-line bg-elevated/30 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="flex items-center gap-2 text-xs font-medium text-ink-secondary"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${!startDisabled ? 'bg-success' : 'bg-ink-muted'}`} />{readiness}</p><p className="mt-1.5 text-[11px] text-ink-muted">{scheduleSummary} · {refineWithAI ? 'AI refinement' : 'Exact text'}</p></div>
            <Button type="submit" className="h-10 px-5 sm:min-w-[185px]" disabled={startDisabled} icon={busy && !clearing ? <LoaderCircle className="animate-spin" size={15} /> : <Play size={15} />}>Start Auto Mode<ArrowRight size={14} className="ml-1" /></Button>
          </div>
          {!connected && loaded && <Link to="/accounts" className="mt-3 inline-flex items-center gap-1 text-xs text-primary">Connect an account<ArrowUpRight size={12} /></Link>}
          <p className="mt-3 text-[10px] leading-4 text-ink-muted">Starting allows automatic joining and publishing. Membership answers use your <Link to="/settings" className="text-ink-secondary underline decoration-line underline-offset-2 hover:text-ink">saved profile</Link>.</p>
          <details className="mt-2 text-[10px] leading-4 text-ink-muted"><summary className="w-fit cursor-pointer hover:text-ink-secondary">How posting works</summary><div className="mt-2 space-y-2">
            <p>One post per community. If Skool rejects a post, Auto Mode tries the next community. Count mode continues until the target is confirmed. Interval mode continues until you stop it, without catching up missed intervals in a burst. Rate limits trigger a cooldown. Unconfirmed posts are checked before sending replacements to avoid duplicates.</p>
            <p>With AI refinement enabled, your post and community context go to OpenRouter. As-is posts preserve your exact text. Cookies and saved personal facts stay on the backend.</p>
          </div></details>
        </div>
      </form>

      <aside className="min-w-0 overflow-hidden rounded-2xl border border-line bg-card xl:sticky xl:top-24">
        <div className="flex gap-5 border-b border-line px-5" role="group" aria-label="Run panel">
          <button type="button" aria-pressed={activityView === 'activity'} onClick={() => setActivityView('activity')} className={`-mb-px flex items-center gap-2 border-b-2 py-4 text-xs font-semibold transition focus-visible:outline focus-visible:outline-primary ${activityView === 'activity' ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>Activity{active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}</button>
          <button type="button" aria-pressed={activityView === 'history'} onClick={() => setActivityView('history')} className={`-mb-px flex items-center gap-2 border-b-2 py-4 text-xs font-semibold transition focus-visible:outline focus-visible:outline-primary ${activityView === 'history' ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>Recent runs<span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] tabular-nums text-ink-muted">{state?.runs.length || 0}</span></button>
        </div>

        {activityView === 'activity' ? <>
          <div className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xs font-semibold">{current ? selected && current.id === selected ? 'Selected run' : 'Latest run' : 'Run overview'}</h2>{current ? <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium capitalize ${runTone(current.status)}`}>{running(current) && <LoaderCircle size={11} className="animate-spin" />}{runLabel(current)}</span> : <span className="rounded-full bg-elevated px-2.5 py-1 text-[10px] text-ink-muted">Not started</span>}</div>
            {current ? <>
              <p className="line-clamp-3 break-words text-sm font-medium leading-6" title={current.post?.title || current.goal}>{current.post?.title || current.goal}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-ink-muted"><Clock3 size={11} />{new Date(current.createdAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
              <div className="my-5 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-app/50 py-3">{[['Checked',current.results.length],['Selected',current.selectionCount ?? current.matching?.matched ?? '—'],['Published',published]].map(([title,n]) => <div key={title} className="px-3 text-center"><p className={`text-xl font-semibold tabular-nums ${title === 'Published' && published ? 'text-success' : 'text-ink'}`}>{n}</p><p className="mt-1 text-[10px] text-ink-muted">{title}</p></div>)}</div>
              {current.postingMode === 'interval' ? <div className="flex items-start gap-2 rounded-xl border border-line bg-app/50 px-3 py-3 text-xs leading-5 text-ink-secondary"><Clock3 size={14} className="mt-0.5 shrink-0 text-primary" /><span>One post every {current.intervalMinutes} {current.intervalMinutes === 1 ? 'minute' : 'minutes'}<span className="block text-[10px] text-ink-muted">Continues until stopped · {published} published</span></span></div> : <>
                <div className="mb-3 flex justify-between text-[10px] text-ink-muted"><span>Confirmed publications</span><span className="tabular-nums">{published} / {current.limit}</span></div>
                <div role="progressbar" aria-label="Confirmed publications" aria-valuemin={0} aria-valuemax={current.limit ?? 1} aria-valuenow={published} className="h-1 overflow-hidden rounded-full bg-elevated"><div style={{width:`${Math.min(100,published/(current.limit || 1)*100)}%`}} className="h-full rounded-full bg-success transition-[width] duration-300 motion-reduce:transition-none" /></div>
              </>}
              <p role="status" className="mt-4 break-words text-xs leading-5 text-ink-secondary">{current.stage}</p>
              {current.matching && <p className="mt-2 text-[10px] leading-4 text-ink-muted">{current.matching.evaluated} of {current.matching.total} communities evaluated{current.matching.skipped > 0 ? ` · ${current.matching.skipped} could not be evaluated` : ''}</p>}
              {running(current) && current.nextAttemptAt && <p className="mt-2 text-[11px] text-ink-secondary">{current.waitReason === 'interval' ? 'Next scheduled post' : 'Next attempt'}: {new Date(current.nextAttemptAt).toLocaleString()}</p>}{current.failedStage && <p className="mt-2 text-[10px] leading-4 text-warning">Stopped during {current.failedStage.toLowerCase()}. The run will retry automatically.</p>}
            </> : <div className="py-5"><div className="mb-5 flex items-center justify-center gap-3 text-ink-muted"><span className="rounded-xl border border-line bg-app p-3"><Compass size={20} /></span><ArrowRight size={12} /><span className="rounded-xl border border-line bg-app p-3"><Users size={20} /></span><ArrowRight size={12} /><span className="rounded-xl border border-line bg-app p-3"><FileText size={20} /></span></div><p className="text-center text-sm font-medium">Your next run starts here</p><p className="mx-auto mt-2 max-w-[250px] text-center text-xs leading-5 text-ink-muted">Write your post and start a run. Follow its progress here as communities are found and posts are published.</p></div>}
            {active && <Button variant="secondary" className="mt-4 w-full" disabled={busy || active.cancelRequested} onClick={() => void stop()} icon={<Square size={12} />}>{active.cancelRequested ? 'Stopping…' : 'Stop active run'}</Button>}
          </div>

          <div className="border-t border-line p-5">
            <div className="mb-4 flex items-center justify-between"><h3 className="text-xs font-semibold">Published posts</h3><span className="text-[10px] text-ink-muted">Confirmed only</span></div>
            {!successfulResults.length ? <div className="rounded-xl border border-dashed border-line px-4 py-7 text-center"><CircleCheck size={22} strokeWidth={1.5} className="mx-auto mb-3 text-ink-muted" /><p className="text-xs text-ink-secondary">No publications yet</p><p className="mt-1.5 text-[11px] leading-4 text-ink-muted">Successful posts will appear here.</p></div> : <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">{successfulResults.map(result => <article key={result.groupName} className="overflow-hidden rounded-xl border border-line bg-app/50">
              <div className="p-3.5"><div className="flex items-start gap-2"><span className="mt-0.5 rounded-full bg-success/10 p-1 text-success"><Check size={11} /></span><a href={result.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-words text-xs font-semibold leading-5 hover:text-primary">{result.name}<ArrowUpRight size={12} className="ml-1 inline text-ink-muted" /></a></div><p className="mt-2 text-[10px] text-ink-muted">{result.account.displayName}{result.categoryName ? ` · ${result.categoryName}` : ''} · {result.postMode === 'as_is' ? 'As-is' : result.postMode === 'refined' ? 'AI refined' : 'AI written'}</p></div>
              {result.article && <details className="border-t border-line px-3.5 py-2.5"><summary className="cursor-pointer break-words text-[11px] leading-5 text-ink-secondary">{result.article.title}</summary><p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-ink-secondary">{result.article.content}</p></details>}
            </article>)}</div>}
            {!!successfulEvents.length && <details className="mt-4 text-[11px] text-ink-muted"><summary className="cursor-pointer hover:text-ink-secondary">Successful activity log · {successfulEvents.length}</summary><ol className="mt-3 space-y-3">{successfulEvents.map((event,i)=><li key={i} className="flex gap-2 leading-5"><time className="shrink-0 text-[10px] tabular-nums">{new Date(event.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time><span className="min-w-0 break-words text-ink-secondary">{event.message}</span></li>)}</ol></details>}
          </div>
        </> : <div className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xs font-semibold">Recent runs</h2><Button variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy || !state?.runs.some(run => !running(run))} onClick={() => void clearHistory()} icon={clearing ? <LoaderCircle size={12} className="animate-spin" /> : <Trash2 size={12} />}>{clearing ? 'Clearing…' : 'Clear history'}</Button></div>
          {!loaded ? <p role="status" className="py-10 text-center text-xs text-ink-muted">Loading runs…</p> : !state?.runs.length ? <div className="py-10 text-center"><Clock3 size={24} strokeWidth={1.5} className="mx-auto mb-3 text-ink-muted" /><p className="text-xs text-ink-secondary">No recent runs</p><p className="mt-2 text-[11px] text-ink-muted">Your run history will appear here.</p></div> : <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">{state.runs.map(run => <button key={run.id} type="button" onClick={() => { setSelected(run.id); setActivityView('activity'); }} className={`block w-full rounded-xl border p-3.5 text-left transition focus-visible:outline focus-visible:outline-primary ${current?.id === run.id ? 'border-primary/30 bg-primary/[0.04]' : 'border-line hover:bg-elevated'}`}><span className="mb-2 flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-0.5 text-[9px] font-medium capitalize ${runTone(run.status)}`}>{label(run.status)}</span><ArrowUpRight size={13} className="text-ink-muted" /></span><span className="line-clamp-2 break-words text-xs font-medium leading-5">{run.post?.title || run.goal}</span><span className="mt-2 block text-[10px] text-ink-muted">{new Date(run.createdAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})} · {run.results.filter(r=>r.status==='published').length} published</span></button>)}</div>}
          <p className="mt-4 border-t border-line pt-3 text-[10px] leading-4 text-ink-muted">Clearing removes finished runs. Active runs and duplicate-post protection are kept.</p>
        </div>}
      </aside>
    </div>
  </div>;
}

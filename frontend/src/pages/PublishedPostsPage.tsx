import { ArrowUpRight, Check, ChevronDown, Clock3, FileCheck2, LayoutGrid, List, LoaderCircle, RefreshCw, UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../api/accounts';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';

interface PublishedPost {
  id: string; title: string; content: string; communityName: string; communityUrl: string | null;
  url: string | null; accountName: string; categoryName: string | null;
  postMode: 'as_is' | 'refined' | 'generated' | null; publishedAt: string;
}
interface PostsPage { posts: PublishedPost[]; nextCursor: string | null }

function PublishedPostList({ posts }: { posts: PublishedPost[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <div className="overflow-hidden rounded-2xl border border-line bg-card">
    <div aria-hidden="true" className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_100px] gap-5 border-b border-line bg-elevated/40 px-5 py-3 text-[10px] font-medium uppercase tracking-wider text-ink-muted lg:grid"><span>Post / Community</span><span>Account</span><span>Published</span><span className="text-right">Link</span></div>
    <ul className="divide-y divide-line">{posts.map(post => {
      const open = expanded.has(post.id);
      return <li key={post.id} className="px-4 py-4 sm:px-5">
        <div className="grid items-center gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_100px] lg:gap-5">
          <div className="min-w-0"><button type="button" onClick={() => toggle(post.id)} aria-expanded={open} aria-controls={`post-content-${post.id}`} className="group flex w-full items-start gap-2 rounded text-left text-sm font-semibold leading-6 text-ink outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/50"><ChevronDown size={15} className={`mt-1 shrink-0 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} /><span className="min-w-0 break-words">{post.title}</span></button><p className="mt-1 truncate pl-[23px] text-[11px] text-ink-muted">{post.communityName}{post.categoryName ? ` · ${post.categoryName}` : ''}</p></div>
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-secondary"><UserRound size={13} className="shrink-0 text-ink-muted" /><span className="truncate">{post.accountName}</span></span>
          <time dateTime={post.publishedAt} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted"><Clock3 size={12} className="shrink-0" />{new Date(post.publishedAt).toLocaleString()}</time>
          {post.url ? <a href={post.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline lg:justify-self-end">View post<ArrowUpRight size={12} /></a> : <span className="text-xs text-ink-muted lg:text-right">No link</span>}
        </div>
        <div id={`post-content-${post.id}`} hidden={!open} className="mt-4 rounded-xl border border-line bg-app/50 p-4"><div className="mb-3 flex flex-wrap items-center gap-3 text-[10px]"><span className="inline-flex items-center gap-1 text-success"><Check size={11} />Published</span>{post.postMode && <span className="text-ink-muted">{post.postMode === 'as_is' ? 'As-is' : post.postMode === 'refined' ? 'AI refined' : 'AI written'}</span>}</div><p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink-secondary">{post.content}</p></div>
      </li>;
    })}</ul>
  </div>;
}

export function PublishedPostsPage() {
  const [view, setView] = useState<'cards' | 'list'>(() => {
    try { return localStorage.getItem('published-posts-view') === 'list' ? 'list' : 'cards'; }
    catch { return 'cards'; }
  });
  const [posts, setPosts] = useState<PublishedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const lastCursor = useRef<string | undefined>(undefined);
  const load = useCallback(async (cursor?: string) => {
    controller.current?.abort();
    const currentController = new AbortController();
    controller.current = currentController;
    const version = ++generation.current;
    lastCursor.current = cursor;
    setBusy(true); setError('');
    try {
      const page = await request<PostsPage>('/api/published-posts' + (cursor ? '?' + new URLSearchParams({ cursor }) : ''), { signal: currentController.signal });
      if (version !== generation.current) return;
      setPosts(old => cursor ? [...new Map([...old, ...page.posts].map(post => [post.id, post])).values()] : page.posts);
      setNextCursor(page.nextCursor);
    } catch (failure) {
      if (version === generation.current && !currentController.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load published posts.');
    } finally {
      if (version === generation.current) { setBusy(false); setLoading(false); }
    }
  }, []);
  useEffect(() => {
    void load();
    return () => { generation.current++; controller.current?.abort(); };
  }, [load]);
  useEffect(() => {
    try { localStorage.setItem('published-posts-view', view); } catch { /* The view still works when browser storage is unavailable. */ }
  }, [view]);

  return <div className="space-y-5 pb-4">
    <PageHeader title="Published Posts" subtitle="Your successful Auto Mode posts across all accounts and communities." actions={<div className="flex flex-wrap items-center gap-2"><div role="group" aria-label="Published posts view" className="inline-flex rounded-lg border border-line bg-card p-1">{[{ value: 'cards' as const, label: 'Cards', icon: LayoutGrid }, { value: 'list' as const, label: 'List', icon: List }].map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${view === value ? 'bg-primary/15 text-primary' : 'text-ink-muted hover:bg-elevated hover:text-ink'}`}><Icon size={14} />{label}</button>)}</div><Button variant="secondary" disabled={busy} onClick={() => void load()} icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />}>Refresh</Button></div>} />
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3">
      <p className="flex items-center gap-2 text-xs text-ink-secondary"><FileCheck2 size={15} className="text-success" />{posts.length} confirmed {posts.length === 1 ? 'post' : 'posts'} loaded</p>
      <Link to="/auto-mode" className="inline-flex items-center gap-1 text-xs font-medium text-primary">Open Auto Mode<ArrowUpRight size={13} /></Link>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-card px-4 py-3"><p className="text-sm text-ink-secondary">{error}</p><Button variant="secondary" disabled={busy} onClick={() => void load(lastCursor.current)}>Retry</Button></div>}
    {loading ? <p role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-ink-muted"><LoaderCircle size={17} className="animate-spin" />Loading published posts…</p> : !posts.length && !error ? <div className="rounded-2xl border border-dashed border-line bg-card px-5 py-16 text-center">
      <FileCheck2 size={30} strokeWidth={1.5} className="mx-auto mb-4 text-ink-muted" /><h2 className="text-base font-semibold">No published posts yet</h2><p className="mt-2 text-sm text-ink-secondary">Posts appear here once Skool confirms publication.</p><Link to="/auto-mode" className="mt-5 inline-block text-sm font-medium text-primary">Create an Auto Mode run →</Link>
    </div> : view === 'list' ? <PublishedPostList posts={posts} /> : <div className="grid items-start gap-4 lg:grid-cols-2">{posts.map(post => <article key={post.id} className="min-w-0 overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4"><div className="min-w-0"><p className="truncate text-xs font-semibold text-ink-secondary">{post.communityName}</p><p className="mt-1 text-[11px] text-ink-muted">{post.categoryName || 'Community post'}</p></div><span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-[10px] font-medium text-success"><Check size={11} />Published</span></div>
      <div className="space-y-3 p-5"><h2 className="break-words text-base font-semibold leading-6">{post.title}</h2><p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-ink-secondary">{post.content}</p></div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3 text-[11px] text-ink-muted"><span className="inline-flex items-center gap-1.5"><UserRound size={12} />{post.accountName}</span><time dateTime={post.publishedAt} className="inline-flex items-center gap-1.5"><Clock3 size={12} />{new Date(post.publishedAt).toLocaleString()}</time>{post.postMode && <span>{post.postMode === 'as_is' ? 'As-is' : post.postMode === 'refined' ? 'AI refined' : 'AI written'}</span>}{post.url && <a href={post.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline">View on Skool<ArrowUpRight size={12} /></a>}</div>
    </article>)}</div>}
    {nextCursor && <div className="flex justify-center"><Button variant="secondary" disabled={busy} onClick={() => void load(nextCursor)} icon={busy ? <LoaderCircle size={14} className="animate-spin" /> : undefined}>Load more posts</Button></div>}
    {!loading && posts.length > 0 && <p className="text-[11px] leading-5 text-ink-muted">Posts confirmed by Skool are kept here even when you clear recent runs. A post may later be edited or removed on Skool.</p>}
  </div>;
}

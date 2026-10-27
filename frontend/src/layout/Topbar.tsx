import { LogOut, Menu, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useIdentity } from '../hooks/useIdentity';
import { SearchBar } from '../components/SearchBar';
import { Notice } from '../components/Notice';
import { Button } from '../components/Button';

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, signOut } = useIdentity();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const search = (event: FormEvent) => { event.preventDefault(); navigate('/discover?q=' + encodeURIComponent(query.trim())); };
  const logout = async () => {
    setBusy(true);
    try { await signOut(); navigate('/login'); }
    catch { setError('Could not sign out. Please retry.'); }
    finally { setBusy(false); }
  };
  return <header className="sticky top-0 z-30 border-b border-line bg-app/90 backdrop-blur-sm">
    <div className="flex min-h-16 items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
      <button type="button" aria-label="Open navigation menu" onClick={onOpenMenu} className="rounded-lg p-2 text-ink-secondary lg:hidden"><Menu size={20} /></button>
      <form onSubmit={search} className="flex max-w-md flex-1 gap-2"><SearchBar value={query} onValueChange={setQuery} label="Search communities" placeholder="Search communities" maxLength={200} compact className="flex-1" /><button type="submit" aria-label="Search" className="rounded-lg p-2 text-ink-secondary"><Search size={18} /></button></form>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <div className="hidden min-w-0 text-right sm:block"><p className="max-w-48 truncate text-sm text-ink">{user?.email}</p><p className="text-xs text-ink-muted">{user?.localOwner ? 'This computer only' : 'Private workspace'}</p></div>
        {user?.localOwner ? <Link to="/login" className="text-xs text-ink-secondary hover:text-ink">Sign in as another user</Link> : <Button variant="ghost" disabled={busy} onClick={() => void logout()} icon={<LogOut size={16} />}>Sign out</Button>}
      </div>
    </div>
    {error && <div className="px-4 pb-3"><Notice message={error} tone="error" onDismiss={() => setError(null)} /></div>}
  </header>;
}

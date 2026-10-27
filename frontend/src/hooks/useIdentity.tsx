import { useEffect, useState, type ReactNode } from 'react';
import { request } from '../api/accounts';
import { IdentityContext as Context, type User } from './identityContext';
export { useIdentity } from './identityContext';
export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    fetch('/api/auth/me', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) }).then(async response => {
      if (response.status === 401) { if (active) setUser(null); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not connect to the service.');
      if (active) setUser(data.user);
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Could not connect to the service.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  const signIn = async (email: string, password: string, register: boolean) => {
    const data = await request<{ user: User }>(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    setUser(data.user); setError(null);
  };
  const signOut = async () => {
    await request('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    setUser(null);
  };
  return <Context.Provider value={{ user, loading, error, reload: () => setVersion(value => value + 1), signIn, signOut }}>{children}</Context.Provider>;
}

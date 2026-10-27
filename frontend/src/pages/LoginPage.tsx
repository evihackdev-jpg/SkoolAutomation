import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { useIdentity } from '../hooks/useIdentity';

export function LoginPage() {
  const { signIn } = useIdentity();
  const navigate = useNavigate();
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registrationCode, setRegistrationCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try { await signIn(email, password, register, registrationCode); setPassword(''); setRegistrationCode(''); navigate('/dashboard', { replace: true }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  };
  return <div className="flex min-h-screen items-center justify-center bg-app p-5 text-ink">
    <div className="w-full max-w-md space-y-6 rounded-card border border-line bg-card p-7">
      <Logo size={32} />
      <div><h1 className="text-2xl font-semibold">{register ? 'Create your workspace' : 'Sign in'}</h1><p className="mt-2 text-sm text-ink-secondary">Your Skool accounts and cookies stay private to your service login.</p></div>
      {error && <p role="alert" className="text-sm text-primary">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-2 text-sm">Email<input type="email" required maxLength={254} autoComplete="username" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} className="h-11 w-full rounded-lg border border-line bg-app px-3" /></label>
        <label className="block space-y-2 text-sm">Password<input type="password" required minLength={register ? 12 : 1} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} className="h-11 w-full rounded-lg border border-line bg-app px-3" /></label>
        {register && <p className="text-xs text-ink-muted">Use at least 12 characters. This password is for this service, not your Skool account.</p>}
        {register && <label className="block space-y-2 text-sm">Registration code<input type="password" required maxLength={128} autoComplete="off" autoCapitalize="none" spellCheck={false} value={registrationCode} disabled={busy} onChange={e => setRegistrationCode(e.target.value)} className="h-11 w-full rounded-lg border border-line bg-app px-3" /></label>}
        <Button fullWidth type="submit" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create Account' : 'Sign In'}</Button>
      </form>
      <button type="button" disabled={busy} onClick={() => { setRegister(value => !value); setError(null); setPassword(''); setRegistrationCode(''); }} className="text-sm text-primary hover:text-primary-hover">{register ? 'Already registered? Sign in' : 'New here? Create an account'}</button>
    </div>
  </div>;
}

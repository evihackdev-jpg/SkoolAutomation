import type { AccountRecord } from '../types';

export interface AccountInput {
  cookieData: string;
}

export async function request<T>(path: string, options?: RequestInit, timeoutMs = 25000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options, signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error('Cannot reach the account backend. Start the API and check your connection.');
  }
  let data;
  try { data = await response.json(); } catch {
    throw new Error('The account backend is unavailable. Start it with npm run server.');
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
    throw new Error(data.error || 'The request failed.');
  }
  return data as T;
}

export const listAccounts = () => request<{ accounts: AccountRecord[] }>('/api/accounts');
export const addAccount = (input: AccountInput) => request<{ account: AccountRecord }>('/api/accounts', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});
export const removeAccount = (id: string) => request('/api/accounts/' + encodeURIComponent(id), { method: 'DELETE' });
export const updateAccountCookies = (id: string, input: AccountInput) => request<{ account: AccountRecord }>('/api/accounts/' + encodeURIComponent(id), {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});
export const verifyAccount = (id: string) => request<{ account: AccountRecord }>('/api/accounts/' + encodeURIComponent(id) + '/verify', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});

import { createContext, useContext } from 'react';

export interface User { id: string; email: string; localOwner: boolean }
interface Identity {
  user: User | null; loading: boolean; error: string | null;
  reload: () => void; signIn: (email: string, password: string, register: boolean, registrationCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
}
export const IdentityContext = createContext<Identity | null>(null);
export function useIdentity() {
  const context = useContext(IdentityContext);
  if (!context) throw new Error('IdentityProvider is missing.');
  return context;
}

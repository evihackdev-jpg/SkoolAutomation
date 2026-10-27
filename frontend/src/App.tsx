import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { AccountsPage } from './pages/AccountsPage';
import { AutoModePage } from './pages/AutoModePage';
import { PublishedPostsPage } from './pages/PublishedPostsPage';
import { SettingsPage } from './pages/SettingsPage';
import { DashboardPage } from './pages/DashboardPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { JoinedCommunitiesPage } from './pages/JoinedCommunitiesPage';
import { IdentityProvider, useIdentity } from './hooks/useIdentity';
import { Button } from './components/Button';

function PrivateLayout() {
  const { user, loading, error, reload } = useIdentity();
  if (loading) return <p role="status" className="p-8 text-ink-secondary">Opening your workspace…</p>;
  if (error) return <div role="alert" className="space-y-4 p-8 text-ink"><p>{error}</p><Button onClick={reload}>Retry</Button></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout key={user.id} />;
}

export default function App() {
  return (
    <IdentityProvider><BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<PrivateLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/auto-mode" element={<AutoModePage />} />
          <Route path="/published-posts" element={<PublishedPostsPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/communities" element={<Navigate to="/discover" replace />} />
          <Route path="/communities/:id" element={<Navigate to="/discover" replace />} />
          <Route path="/ai-search" element={<Navigate to="/auto-mode" replace />} />
          <Route path="/joined-communities" element={<JoinedCommunitiesPage />} />
          <Route path="/search-results" element={<Navigate to="/joined-communities" replace />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/saved" element={<Navigate to="/discover" replace />} />
          <Route path="/analytics" element={<Navigate to="/auto-mode" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter></IdentityProvider>
  );
}

import { Loader2 } from 'lucide-react';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Shell } from './components/Shell';
import { api, isMember, onUnauthorized, type Me } from './lib/api';
import { useRoute } from './lib/utils';
import { setBaseTitle } from './lib/attention';
import { Conversations } from './pages/Conversations';
import { Leads } from './pages/Leads';
import { Contact } from './pages/Contact';
import { Callbacks } from './pages/Callbacks';
import { Jobs } from './pages/Jobs';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Home } from './pages/Home';
import { Prompt } from './pages/Prompt';
import { Settings } from './pages/Settings';
import { Knowledge } from './pages/Knowledge';
import { Onboarding } from './pages/Onboarding';
import { Setup, SignIn } from './pages/Setup';

function App() {
  const [me, setMe] = useState<Me | null | 'signed-out'>(null);
  const [route] = useRoute();

  const load = useCallback(() => {
    api<Me>('/me').then(setMe, () => setMe('signed-out'));
  }, []);
  useEffect(load, [load]);
  useEffect(() => onUnauthorized(() => setMe('signed-out')), []);
  // Settings that change what the dashboard shows (live chat on or off) ask for a fresh `me`.
  useEffect(() => {
    window.addEventListener('hp-me-changed', load);
    return () => window.removeEventListener('hp-me-changed', load);
  }, [load]);
  useEffect(() => {
    // Through lib/attention, which adds the count of what waits.
    if (me && me !== 'signed-out' && me.sites[0]) setBaseTitle(`${me.sites[0].name} · Dashboard`);
  }, [me]);

  if (me === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  // One-time links work signed out: claim a fresh deployment, or sign in without a password.
  if (route.page === 'setup' && route.id && me === 'signed-out') return <Setup token={route.id} onDone={load} />;
  if (route.page === 'signin' && route.id) return <SignIn token={route.id} onDone={load} />;
  if (me === 'signed-out') return <Login onDone={load} />;

  // Members see the inbox: pages for admins send them to it.
  // A member has settings only with live chat on (their notifications).
  const adminOnly = ['home', 'analytics', 'prompt', 'knowledge', 'onboarding', 'setup', ...(me.sites[0]?.live ? [] : ['settings'])];
  if (isMember(me) && adminOnly.includes(route.page)) {
    window.location.hash = '#/conversations';
    return null;
  }

  const logout = async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    setMe('signed-out');
  };

  return (
    <Shell me={me} route={route} onLogout={() => void logout()}>
      {route.page === 'home' && <Home me={me} />}
      {route.page === 'analytics' && <Overview me={me} />}
      {route.page === 'conversations' && <Conversations id={route.id} me={me} />}
      {route.page === 'leads' && <Leads />}
      {route.page === 'contact' && route.id && <Contact id={route.id} me={me} />}
      {route.page === 'jobs' && <Jobs id={route.id} me={me} />}
      {route.page === 'callbacks' && <Callbacks />}
      {route.page === 'prompt' && <Prompt me={me} />}
      {route.page === 'settings' && <Settings me={me} section={route.id} />}
      {route.page === 'knowledge' && <Knowledge me={me} />}
      {(route.page === 'onboarding' || route.page === 'setup') && <Onboarding me={me} />}
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

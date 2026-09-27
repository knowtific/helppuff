import { Loader2 } from 'lucide-react';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Shell } from './components/Shell';
import { api, onUnauthorized, type Me } from './lib/api';
import { useRoute } from './lib/utils';
import { Conversations } from './pages/Conversations';
import { Leads } from './pages/Leads';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Prompt } from './pages/Prompt';
import { Settings } from './pages/Settings';

function App() {
  const [me, setMe] = useState<Me | null | 'signed-out'>(null);
  const [route] = useRoute();

  const load = useCallback(() => {
    api<Me>('/me').then(setMe, () => setMe('signed-out'));
  }, []);
  useEffect(load, [load]);
  useEffect(() => onUnauthorized(() => setMe('signed-out')), []);
  useEffect(() => {
    if (me && me !== 'signed-out' && me.sites[0]) document.title = `${me.sites[0].name} · Dashboard`;
  }, [me]);

  if (me === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  if (me === 'signed-out') return <Login onDone={load} />;

  const logout = async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    setMe('signed-out');
  };

  return (
    <Shell me={me} route={route} onLogout={() => void logout()}>
      {route.page === 'overview' && <Overview />}
      {route.page === 'conversations' && <Conversations id={route.id} me={me} />}
      {route.page === 'leads' && <Leads />}
      {route.page === 'prompt' && <Prompt me={me} />}
      {route.page === 'settings' && <Settings me={me} />}
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

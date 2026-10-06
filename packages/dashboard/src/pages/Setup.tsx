import { Loader2, MessagesSquare, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { replaceHash } from '../lib/utils';

/**
 * The two pages reached by a one-time link, before anyone is signed in:
 *
 *  - `#/setup/<token>` (from `helppuff deploy`): create the first account,
 *    then onboarding picks up from there — or Home, when the terminal (an
 *    AI agent, usually) already started learning the site;
 *  - `#/signin/<token>` (from `helppuff dashboard`): sign in without a password.
 *
 * The token lives in the URL fragment, which browsers never send to a
 * server, and is spent on first use.
 */

function Frame({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-subtle px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl border bg-card shadow-sm">
            <MessagesSquare className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Expired() {
  return (
    <Frame title="This link has expired" description="Setup and sign-in links work once, for a limited time.">
      <div className="rounded-lg border bg-card p-5 text-[13px] shadow-sm">
        <p>Get a fresh one from the folder you set up the assistant in:</p>
        <code className="mt-2 block rounded-md bg-muted px-2.5 py-2 text-xs">npx @knowtific/helppuff dashboard</code>
        <a href="#/" className="mt-4 inline-block text-xs text-muted-foreground hover:text-foreground">
          Sign in with a password instead
        </a>
      </div>
    </Frame>
  );
}

export function Setup({ token, onDone }: { token: string; onDone: () => void }) {
  const [state, setState] = useState<'checking' | 'ready' | 'expired'>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/setup?token=${encodeURIComponent(token)}`).then(
      () => setState('ready'),
      () => setState('expired'),
    );
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/setup', { method: 'POST', json: { token, email, password } });
      // Set up from the terminal (an agent chose the pages and the crawl is under
      // way or done): there is nothing to onboard, so go straight to Home.
      const learned = await api<{ run: unknown }>('/knowledge/status').then(
        (status) => Boolean(status.run),
        () => false,
      );
      // Replace the link in history: going back must not land on a spent token.
      replaceHash(learned ? '#/home' : '#/onboarding');
      onDone();
    } catch (thrown) {
      if (thrown instanceof ApiError && thrown.status === 404) setState('expired');
      else setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (state === 'checking') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Checking the link" />
      </div>
    );
  }
  if (state === 'expired') return <Expired />;

  return (
    <Frame title="Set up your chat assistant" description="First, create the account you’ll sign in with. Then we’ll pick the pages it learns from.">
      <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Your email</span>
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Choose a password</span>
          <Input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="pw-hint" />
          <span id="pw-hint" className="block text-[11px] text-muted-foreground">
            At least 10 characters.
          </span>
        </label>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Create account and continue
        </Button>
        <p className="flex items-start gap-1.5 pt-1 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          This link works once. Everything stays on your own Cloudflare account.
        </p>
      </form>
    </Frame>
  );
}

export function SignIn({ token, onDone }: { token: string; onDone: () => void }) {
  const [expired, setExpired] = useState(false);
  // A token is spent on first use: never send it twice (StrictMode runs effects twice in development).
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api('/login-link', { method: 'POST', json: { token } }).then(
      () => {
        replaceHash('#/home');
        onDone();
      },
      () => setExpired(true),
    );
  }, [token, onDone]);
  if (expired) return <Expired />;
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-label="Signing in" />
    </div>
  );
}

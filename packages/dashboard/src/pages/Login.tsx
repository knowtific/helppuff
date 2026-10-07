import { Loader2, MessagesSquare } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { api } from '../lib/api';
import { Button, Input } from '../components/ui';

type Turnstile = {
  render: (el: HTMLElement, options: { sitekey: string; action?: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string;
  reset: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let turnstileScript: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load.')));
    script.onerror = () => {
      turnstileScript = null;
      reject(new Error('Turnstile did not load. Check your connection and reload.'));
    };
    document.head.append(script);
  });
  return turnstileScript;
}

/** Turnstile on the form when the deployment has it (`security.signIn.captcha`): the token, and a reset for after a failed try. */
function useSignInCaptcha(): { slot: RefObject<HTMLDivElement | null>; needed: boolean; token: string | null; reset: () => void; error: string | null } {
  const slot = useRef<HTMLDivElement | null>(null);
  const widget = useRef<{ api: Turnstile; id: string } | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ captcha: { siteKey: string } | null }>('/login/options').then(
      (options) => setSiteKey(options.captcha?.siteKey ?? null),
      () => {},
    );
  }, []);

  useEffect(() => {
    if (!siteKey || !slot.current || widget.current) return;
    const el = slot.current;
    loadTurnstile().then(
      (turnstile) => {
        widget.current = {
          api: turnstile,
          id: turnstile.render(el, {
            sitekey: siteKey,
            action: 'dashboard-sign-in',
            callback: (value) => setToken(value),
            'expired-callback': () => setToken(null),
            'error-callback': () => setToken(null),
          }),
        };
      },
      (thrown: Error) => setError(thrown.message),
    );
  }, [siteKey]);

  return {
    slot,
    needed: Boolean(siteKey),
    token,
    error,
    reset: () => {
      setToken(null);
      if (widget.current) widget.current.api.reset(widget.current.id);
    },
  };
}

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = useSignInCaptcha();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (captcha.needed && !captcha.token) {
      setError('Please complete the check above the button.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/login', { method: 'POST', json: { email, password, ...(captcha.token ? { captchaToken: captcha.token } : {}) } });
      onDone();
    } catch (thrown) {
      setError((thrown as Error).message);
      // A Turnstile token is good for one try.
      captcha.reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-subtle px-4">
      <div className="w-full max-w-[340px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl border bg-card shadow-sm">
            <MessagesSquare className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Sign in to your dashboard</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">Conversations, leads and insights from your chat assistant.</p>
          </div>
        </div>
        <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Email</span>
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Password</span>
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {captcha.needed && <div ref={captcha.slot} className="min-h-[65px]" />}
          {(error ?? captcha.error) && (
            <p role="alert" className="text-xs text-danger">
              {error ?? captcha.error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Forgot it? Run <code className="rounded bg-muted px-1 py-0.5">helppuff users reset &lt;email&gt;</code>
        </p>
      </div>
    </div>
  );
}

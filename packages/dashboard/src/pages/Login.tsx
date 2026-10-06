import { Loader2, MessagesSquare } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Button, Input } from '../components/ui';

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/login', { method: 'POST', json: { email, password } });
      onDone();
    } catch (thrown) {
      setError((thrown as Error).message);
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
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
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

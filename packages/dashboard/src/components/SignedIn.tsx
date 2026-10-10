import { Eye, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { CopyBlock } from '../pages/Settings';
import { wikiHref } from './Shell';
import { Button, Card, CardHeader, ErrorNote } from './ui';

/**
 * Settings → Lead form → Signed-in visitors: the site's identity secret
 * (shown on request, rotated here), how to sign a visitor in on your server,
 * and the one line for the page. What a visitor types is a claim; a signed
 * token is proof (`{{user.*}}` in tools and the prompt).
 */
export function SignedInVisitors({ site }: { site: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = async (action: () => Promise<{ secret: string }>) => {
    setBusy(true);
    setError(null);
    try {
      setSecret((await action()).secret);
    } catch (thrown) {
      setError(thrown as Error);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Signed-in visitors"
        tip={{
          label: 'About signed-in visitors',
          text: 'For a site with accounts: your server signs who is logged in, and the assistant and tools know them for sure ({{user.id}}). Without it, a name or email a visitor types is only a claim.',
          href: wikiHref('Signed-In-Visitors'),
        }}
      />
      <ol className="space-y-4 px-4 pb-4 text-[13px]">
        <li className="space-y-1.5">
          <p className="font-medium">1. Your secret</p>
          {error && <ErrorNote error={error} />}
          {secret ? (
            <>
              <CopyBlock text={secret} label="identity secret" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                Keep it on your server only.
                {confirming ? (
                  <>
                    <span>Tokens signed with this one stop working.</span>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api('/identity/rotate', { method: 'POST', json: { site } }))}>
                      {busy && <Loader2 className="animate-spin" />} Rotate
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                    <RefreshCw /> Rotate
                  </Button>
                )}
              </div>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api(`/identity?site=${encodeURIComponent(site)}`))}>
              {busy ? <Loader2 className="animate-spin" /> : <Eye />} Show secret
            </Button>
          )}
        </li>
        <li className="space-y-1.5">
          <p className="font-medium">2. Sign who is logged in, on your server</p>
          <CopyBlock
            label="signing code"
            wrap
            text={`// Node, with the jsonwebtoken package (HS256)
const token = jwt.sign(
  { sub: user.id, email: user.email, name: user.name },
  process.env.HELPPUFF_IDENTITY_SECRET,
  { expiresIn: '1h' },
);`}
          />
        </li>
        <li className="space-y-1.5">
          <p className="font-medium">3. Pass it to the chat, on the page</p>
          <CopyBlock label="identify call" text="HelpPuff.identify({ name: user.name, email: user.email, token })" />
        </li>
      </ol>
    </Card>
  );
}

import { BellRing, Check, Loader2, Send, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { HelpLink } from './Shell';
import { forgetLabels, useLabels } from './inbox';
import { Button, Card, CardHeader, ErrorNote, InfoTip, Input, Select, Skeleton, Textarea } from './ui';
import { api, type Label, type LiveSettings, type LiveStatus, type Prefs, type SettingsView, type TelegramView } from '../lib/api';
import { askNotifications, notificationState, playSound, setAvailable, testNotification, unlockAudio } from '../lib/live';
import { cn, useData } from '../lib/utils';

/**
 * Settings → Live chat (the `live` section, and Telegram), Labels, and each
 * person's Notifications.
 */

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <div className={cn('flex items-start gap-1.5 text-[13px]', disabled && 'opacity-60')}>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint && (
        <span className="mt-0.5">
          <InfoTip label={`About “${label}”`}>{hint}</InfoTip>
        </span>
      )}
    </div>
  );
}

const DEFAULT_LIVE: LiveSettings = { enabled: false, waitSeconds: 120, closeAfterMinutes: 60, showAgentName: true, aiWhileWaiting: false };

export function LiveChatSettings() {
  const { data, error, reload } = useData(() => Promise.all([api<SettingsView>('/settings'), api<LiveStatus>('/live/status').catch(() => null)]), []);
  const [value, setValue] = useState<LiveSettings | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (data) setValue({ ...DEFAULT_LIVE, ...(data[0].settings.live ?? {}) });
  }, [data]);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data || !value) return <Skeleton className="h-48" />;
  const [view, status] = data;
  const older = !view.settings.live;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setState('saving');
    setSaveError(null);
    try {
      await api('/settings', { method: 'PUT', json: { settings: { live: value } } });
      setState('saved');
      reload();
      // The shell (the Available switch, Notifications, filters) follows at once.
      window.dispatchEvent(new Event('hp-me-changed'));
    } catch (thrown) {
      setSaveError((thrown as Error).message);
      setState('idle');
    }
  };
  const nobody = value.enabled && status && status.available === 0 && !status.telegram.linked;
  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={(e) => void save(e)} className="space-y-4 p-4">
          {older && <p className="text-xs text-muted-foreground">This Worker is older than live chat. Run helppuff upgrade first.</p>}
          <fieldset className="space-y-2" disabled={older}>
            <legend className="mb-1 text-[13px] font-medium">When a visitor asks for a person</legend>
            {(
              [
                [false, 'Take their details for a callback', 'The default. The assistant collects a name and a phone number or email, and the team calls back (Callbacks).'],
                [true, 'Connect them to someone on the team, live', 'The assistant hands the chat over and a “Talk to a person” button appears in the widget. Your team answers here or in Telegram. When nobody is available, visitors get the callback form instead.'],
              ] as const
            ).map(([enabled, label, hint]) => (
              <label key={label} className={cn('flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-[13px]', value.enabled === enabled && 'border-primary/50 bg-primary/5')}>
                <input type="radio" name="escalation" className="mt-0.5 size-4 accent-[var(--primary)]" checked={value.enabled === enabled} onChange={() => setValue({ ...value, enabled })} />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {nobody && (
            <p role="note" className="rounded-md border border-[#d97706]/40 bg-[#d97706]/5 px-3 py-2 text-xs">
              Nobody can take chats yet: switch yourself to Available (bottom of the menu), or connect Telegram below. Until then, visitors get the callback form.
            </p>
          )}
          {status && !status.hub && value.enabled && (
            <p role="note" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              This deployment has no live chat hub yet. Run helppuff upgrade (or helppuff deploy) once.
            </p>
          )}
          {value.enabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Wait before offering a callback (seconds)</span>
              <Input type="number" min={15} max={3600} value={value.waitSeconds} onChange={(e) => setValue({ ...value, waitSeconds: e.target.valueAsNumber })} />
              <span className="block text-[11px] text-muted-foreground">If nobody takes the chat by then, the visitor can leave their details (or keep waiting).</span>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Close conversations after (minutes without a message)</span>
              <Input type="number" min={5} max={1440} value={value.closeAfterMinutes} onChange={(e) => setValue({ ...value, closeAfterMinutes: e.target.valueAsNumber })} />
              <span className="block text-[11px] text-muted-foreground">Every conversation. If the visitor writes again, the assistant answers.</span>
            </label>
          </div>
          )}
          {value.enabled && (
            <>
              <Toggle checked={value.showAgentName} onChange={(showAgentName) => setValue({ ...value, showAgentName })} label="Show visitors your first name" hint="“Sam joined the chat”. Off: “Someone from the team joined”." />
              <Toggle checked={value.aiWhileWaiting} onChange={(aiWhileWaiting) => setValue({ ...value, aiWhileWaiting })} label="Let the assistant keep answering until someone takes the chat" />
            </>
          )}
          {saveError && (
            <p role="alert" className="text-xs text-danger">
              {saveError}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            {state === 'saved' && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3.5" /> Saved. Live within a minute.
              </span>
            )}
            <Button type="submit" disabled={state === 'saving' || older}>
              {state === 'saving' && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
      </Card>
      {value.enabled && <TelegramCard />}
    </div>
  );
}

function TelegramCard() {
  const { data, error, reload } = useData(() => api<TelegramView>('/live/telegram'), []);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      if (done) setMessage({ ok: true, text: done });
      reload();
    } catch (thrown) {
      setMessage({ ok: false, text: (thrown as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Telegram"
        tip={{ label: 'About telegram', text: 'Answer live chats from your phone: each chat is a thread in your team\'s Telegram group (or your own chat with the bot).' }}
        action={<HelpLink page="Telegram" label="Setup guide" />}
      />
      <div className="space-y-3 border-t px-4 py-3 text-[13px]">
        {error && <ErrorNote error={error} onRetry={reload} />}
        {!data && !error && <Skeleton className="h-16" />}
        {data && !data.connected && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api('/live/telegram', { method: 'POST', json: { token: token.trim() } }), 'Connected. Now link a chat (below).').then(() => setToken(''));
            }}
            className="space-y-2"
          >
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>
                In Telegram, message <span className="font-medium text-foreground">@BotFather</span>, send /newbot, pick a name, and copy the token it gives you.
              </li>
              <li>Paste it here. It is stored encrypted and never shown again.</li>
            </ol>
            <div className="flex gap-2">
              <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA…" aria-label="Bot token" autoComplete="off" spellCheck={false} className="font-mono text-xs" />
              <Button type="submit" disabled={busy || !token.trim()}>
                {busy && <Loader2 className="animate-spin" />} Connect
              </Button>
            </div>
          </form>
        )}
        {data?.connected && (
          <div className="space-y-2">
            <p>
              Bot: <span className="font-medium">{data.bot?.name}</span> <span className="text-muted-foreground">@{data.bot?.username}</span>
            </p>
            {data.linked ? (
              <p>
                Answering from <span className="font-medium">{data.chat?.title}</span>
                <span className="text-muted-foreground">{data.chat?.topics ? ' · one thread per chat' : ' · reply to a chat’s message to answer it'}</span>
              </p>
            ) : (
              <div className="space-y-1.5 rounded-md border bg-subtle p-3 text-xs">
                <p className="font-medium">Link the chat you’ll answer from</p>
                <p className="text-muted-foreground">
                  For a team: make a group, turn on <span className="text-foreground">Topics</span> (group settings), add the bot and make it an admin with “Manage topics”. Just you: open a chat with the bot, and turn on its topic mode in @BotFather for a thread per chat. Then send this there:
                </p>
                <code className="block rounded bg-background px-2 py-1.5 font-mono text-[13px]">/link {data.linkCode}</code>
                <Button variant="outline" size="sm" onClick={reload}>
                  I sent it
                </Button>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={data.shareContact}
                onChange={(e) => void run(() => api('/live/telegram', { method: 'PATCH', json: { shareContact: e.target.checked } }))}
              />
              Include visitors’ email and phone in Telegram (Telegram is a third party)
            </label>
            {data.lastError && <p className="text-xs text-danger">Last error: {data.lastError}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {data.linked && (
                <Button variant="outline" size="sm" onClick={() => void run(() => api('/live/telegram/test', { method: 'POST' }), 'Sent. Check Telegram.')} disabled={busy}>
                  <Send /> Send a test
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (window.confirm('Disconnect Telegram? Live chats will only reach the dashboard.')) void run(() => api('/live/telegram', { method: 'DELETE' }), 'Disconnected.');
                }}
                disabled={busy}
              >
                <Trash2 /> Disconnect
              </Button>
            </div>
          </div>
        )}
        {message && (
          <p role={message.ok ? 'status' : 'alert'} className={cn('text-xs', message.ok ? 'text-muted-foreground' : 'text-danger')}>
            {message.text}
          </p>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------- labels

export function LabelsSettings() {
  const { labels, colors, refresh } = useLabels();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      forgetLabels();
      refresh();
      return true;
    } catch (thrown) {
      setError((thrown as Error).message);
      return false;
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Labels" tip={{ label: 'About labels', text: 'Tag conversations to find them later. The AI labels conversations when they go quiet, using the labels it may use and what each means.' }} />
        <ul className="divide-y border-t">
          {labels.length === 0 && <li className="px-4 py-3 text-[13px] text-muted-foreground">No labels yet.</li>}
          {labels.map((label) => (
            <LabelRow key={label.id} label={label} colors={colors} onChange={(work) => void run(work)} />
          ))}
        </ul>
      </Card>
      <Card>
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api('/labels', { method: 'POST', json: { name, description, ...(color ? { color } : {}) } })).then((ok) => {
              if (ok) {
                setName('');
                setDescription('');
              }
            });
          }}
        >
          <h3 className="text-[13px] font-medium">New label</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Urgent" maxLength={40} aria-label="Label name" />
            <ColorPick colors={colors} value={color} onChange={setColor} />
          </div>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it means, for the AI: e.g. “The visitor needs an answer today”" maxLength={200} aria-label="Label description" />
          <div className="flex justify-end">
            <Button type="submit" disabled={!name.trim()}>
              Add label
            </Button>
          </div>
        </form>
      </Card>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function ColorPick({ colors, value, onChange }: { colors: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('size-5 rounded-full ring-offset-2 ring-offset-background', value === c && 'ring-2 ring-ring')}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

function LabelRow({ label, colors, onChange }: { label: Label; colors: string[]; onChange: (work: () => Promise<unknown>) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [description, setDescription] = useState(label.description ?? '');
  const [color, setColor] = useState(label.color);
  if (editing) {
    return (
      <li className="space-y-2 px-4 py-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Label name" />
          <ColorPick colors={colors} value={color} onChange={setColor} />
        </div>
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} aria-label="Label description" />
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onChange(() => api(`/labels/${label.id}`, { method: 'PATCH', json: { name, description, color } }));
              setEditing(false);
            }}
          >
            Save
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: label.color }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{label.name}</span>
        {label.description && <span className="block truncate text-xs text-muted-foreground">{label.description}</span>}
      </span>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="The AI may put this label on conversations">
        <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={label.ai} onChange={(e) => onChange(() => api(`/labels/${label.id}`, { method: 'PATCH', json: { ai: e.target.checked } }))} />
        AI may use
      </label>
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={`Delete ${label.name}`}
        onClick={() => {
          if (window.confirm(`Delete “${label.name}”? It comes off every conversation.`)) onChange(() => api(`/labels/${label.id}`, { method: 'DELETE' }));
        }}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

// ------------------------------------------------------------ notifications

export function NotificationSettings() {
  const { data, error, reload } = useData(() => api<Prefs>('/prefs'), []);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [permission, setPermission] = useState(notificationState());
  useEffect(() => {
    if (data) setPrefs(data);
  }, [data]);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!prefs) return <Skeleton className="h-48" />;
  const save = async (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    // Availability also tells the hub, at once.
    const saved = patch.available !== undefined ? await setAvailable(patch.available) : await api<Prefs>('/prefs', { method: 'PUT', json: patch });
    setPrefs(saved);
    // The live connection picks it up at once.
    window.dispatchEvent(new CustomEvent('hp-prefs', { detail: saved }));
  };
  const enableNotifications = async () => {
    setPermission(await askNotifications());
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Browser notifications" tip={{ label: 'About browser notifications', text: 'Shown while a dashboard tab is open, even in the background. For alerts with the dashboard closed, connect Telegram (Live chat).' }} />
        <div className="space-y-3 border-t px-4 py-3">
          {permission === 'unsupported' && <p className="text-xs text-muted-foreground">This browser has no notifications.</p>}
          {permission === 'default' && (
            <Button variant="outline" size="sm" onClick={() => void enableNotifications()}>
              <BellRing /> Allow notifications
            </Button>
          )}
          {permission === 'denied' && (
            <p role="note" className="rounded-md border border-[#d97706]/40 bg-[#d97706]/5 px-3 py-2 text-xs">
              Notifications are blocked for this site. In Chrome: click the icon left of the address, then Site settings → Notifications → Allow, and reload.
            </p>
          )}
          <Toggle checked={prefs.notifyNewChat} onChange={(v) => void save({ notifyNewChat: v })} label="A new live chat is waiting" />
          <Toggle checked={prefs.notifyNewMessage} onChange={(v) => void save({ notifyNewMessage: v })} label="A new message in a live chat" hint="Only when the dashboard tab is in the background." />
          {permission === 'granted' && (
            <Button variant="outline" size="sm" onClick={testNotification}>
              Test notification
            </Button>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Sound" tip={{ label: 'About sound', text: 'Browsers play sound only after you have clicked on the page once.' }} />
        <div className="space-y-3 border-t px-4 py-3">
          <Toggle checked={prefs.soundNewChat} onChange={(v) => void save({ soundNewChat: v })} label="A new live chat is waiting" />
          <Toggle checked={prefs.repeatUntilTaken} onChange={(v) => void save({ repeatUntilTaken: v })} label="Repeat it every 15 seconds until someone takes the chat" disabled={!prefs.soundNewChat} />
          <Toggle checked={prefs.soundNewMessage} onChange={(v) => void save({ soundNewMessage: v })} label="A new message in a live chat" />
          <div className="flex flex-wrap items-end gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Sound</span>
              <Select value={prefs.sound} onChange={(e) => void save({ sound: e.target.value as Prefs['sound'] })}>
                <option value="chime">Chime</option>
                <option value="bell">Bell</option>
                <option value="pop">Pop</option>
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Volume</span>
              <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={(e) => void save({ volume: e.target.valueAsNumber })} className="block w-40 accent-[var(--primary)]" aria-label="Volume" />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                unlockAudio();
                playSound(prefs.sound, prefs.volume);
              }}
            >
              <Volume2 /> Test sound
            </Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Availability" tip={{ label: 'About availability', text: 'Available: you get new live chats while a dashboard tab is open. Away: no alerts. The switch is also at the bottom of the menu.' }} />
        <div className="border-t px-4 py-3">
          <Toggle checked={prefs.available} onChange={(v) => void save({ available: v })} label="Available for live chats" />
        </div>
      </Card>
    </div>
  );
}

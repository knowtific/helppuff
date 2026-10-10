import { ShieldAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { HelpLink } from './Shell';
import type { Limits, SecuritySettings } from '../lib/api';
import { InfoTip, Input, Textarea } from './ui';

/**
 * The Advanced page's limits: every bound the Worker enforces, the
 * dashboard's sign-in limits, and the IP lists. Part of the settings object
 * (`security`), saved with the page's one Save button; `helppuff config pull`
 * writes what differs from the defaults into helppuff.json.
 */

type LimitKey = keyof Limits;
const VISITOR: { key: LimitKey; label: string; hint: string; max: number }[] = [
  { key: 'messagesPerIpPerMinute', label: 'Messages a minute, per visitor', hint: 'Per IP address.', max: 600 },
  { key: 'messagesPerIpPerDay', label: 'Messages a day, per visitor', hint: 'So one visitor cannot use up the daily cap.', max: 100_000 },
  { key: 'sessionsPerIpPerHour', label: 'New chats an hour, per visitor', hint: 'Per IP address.', max: 1000 },
  { key: 'sessionsPerIpPerDay', label: 'New chats a day, per visitor', hint: 'Per IP address.', max: 10_000 },
  { key: 'messagesPerSession', label: 'Messages in one chat', hint: 'Then the visitor starts a new chat.', max: 1000 },
  { key: 'messagesPerSitePerDay', label: 'Messages a day, whole site', hint: 'The cost backstop: past it, visitors see your contact details instead.', max: 1_000_000 },
  { key: 'maxMessageLength', label: 'Longest message (characters)', hint: 'What a visitor may type in one message.', max: 4000 },
];
const MORE: { key: LimitKey; label: string; hint: string; min?: number; max: number; fallback?: number }[] = [
  { key: 'maxLeadFieldLength', label: 'Longest form answer (characters)', hint: 'One field of the lead or callback form.', min: 20, max: 2000 },
  { key: 'maxLeadMessageLength', label: 'Longest form message (characters)', hint: 'A message box in a form.', min: 20, max: 4000 },
  { key: 'feedbackPerIpPerMinute', label: 'Ratings a minute, per visitor', hint: 'Thumbs up or down.', max: 600 },
  { key: 'pollsPerIpPerMinute', label: 'Checks for replies a minute, per visitor', hint: 'Backends that answer later, like Retell.', max: 600 },
  { key: 'endsPerIpPerMinute', label: 'Chats closed a minute, per visitor', hint: 'Each close can send a webhook.', max: 600 },
  { key: 'retellLookupsPerMinute', label: 'Retell knowledge lookups a minute', hint: 'For the whole site.', max: 6000 },
  { key: 'apiRequestsPerKeyPerMinute', label: 'API requests a minute, per new key', hint: 'The default for keys made from now on; each key can have its own.', max: 6000 },
  { key: 'apiKeysPerSite', label: 'Active API keys', hint: 'Revoke one to make room.', max: 500 },
  { key: 'handoversPerIpPerDay', label: 'Asks for a person a day, per visitor', hint: 'Live chat. Past it, the callback form.', max: 1000, fallback: 3 },
  { key: 'waitingPerSite', label: 'Live chats waiting at once', hint: 'Not yet taken by anyone. Past it, the callback form.', max: 1000, fallback: 20 },
  { key: 'liveSocketsPerIp', label: 'Live chat connections, per visitor', hint: 'Open at once (tabs).', max: 100, fallback: 3 },
];

function NumberField({ label, hint, value, min = 1, max, onChange }: { label: string; hint: string; value: number; min?: number; max: number; onChange: (value: number) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <InfoTip label={`About ${label.toLowerCase()}`}>{hint}</InfoTip>
      </div>
      <Input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} required value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.valueAsNumber)} />
    </div>
  );
}

/** One address or range a line; commas and spaces work too. */
const lines = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((line) => line.trim())
    .filter(Boolean);

function IpList({ label, hint, value, onChange }: { label: string; hint: string; value: string[]; onChange: (value: string[]) => void }) {
  // The text as typed; the list is what it parses to.
  const [text, setText] = useState(value.join('\n'));
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <InfoTip label={`About ${label.toLowerCase()}`}>{hint} One address or range (CIDR) a line, IPv4 or IPv6.</InfoTip>
      </div>
      <Textarea
        id={id}
        rows={3}
        spellCheck={false}
        className="font-mono text-xs"
        placeholder={'203.0.113.7\n198.51.100.0/24\n2001:db8::/32'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(lines(e.target.value));
        }}
      />
    </div>
  );
}

export function SecurityForm({ value, captcha, onChange }: { value: SecuritySettings; captcha: boolean; onChange: (value: SecuritySettings) => void }) {
  const setLimit = (key: LimitKey, n: number) => onChange({ ...value, limits: { ...value.limits, [key]: n } });
  const setSignIn = (patch: Partial<SecuritySettings['signIn']>) => onChange({ ...value, signIn: { ...value.signIn, ...patch } });
  return (
    <div className="space-y-5">
      {!captcha && (
        <div role="note" className="flex gap-2.5 rounded-md border border-[#d97706]/40 bg-[#d97706]/5 px-3 py-2.5">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[#d97706]" aria-hidden />
          <div className="space-y-1 text-xs">
            <p className="font-medium">Turnstile is off</p>
            <p className="text-muted-foreground">
              Fine for testing. Before real visitors arrive, turn it on: it is the only check that tells a person from a script, for new chats and for this dashboard’s sign-in. Until then, these limits are all that slow a script down.
            </p>
            <HelpLink page="Turnstile" label="How to turn it on (about five minutes)" />
          </div>
        </div>
      )}
      <div className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          Limits
          <InfoTip label="About limits">They stop one visitor (or a script) from using up your daily budget. Visitors who hit one see a short “try again” message.</InfoTip>
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {VISITOR.map((item) => (
            <NumberField key={item.key} label={item.label} hint={item.hint} max={item.max} value={value.limits[item.key] ?? 1} onChange={(n) => setLimit(item.key, n)} />
          ))}
          <NumberField
            label="How long a chat lasts (hours)"
            hint="The widget keeps a chat across pages and reloads for this long."
            min={0.25}
            max={720}
            value={value.sessionTtlHours}
            onChange={(n) => onChange({ ...value, sessionTtlHours: n })}
          />
        </div>
        <details className="group rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">More limits</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {MORE.map((item) => (
              <NumberField
                key={item.key}
                label={item.label}
                hint={item.hint}
                {...(item.min ? { min: item.min } : {})}
                max={item.max}
                value={value.limits[item.key] ?? item.fallback ?? 1}
                onChange={(n) => setLimit(item.key, n)}
              />
            ))}
          </div>
        </details>
      </div>

      <div className="space-y-3">
        <h3 className="text-[13px] font-semibold">IP addresses</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <IpList
            label="Never limit"
            hint="Your office or a monitor: no per-visitor limits. The chat and daily caps still apply."
            value={value.allowIps}
            onChange={(allowIps) => onChange({ ...value, allowIps })}
          />
          <IpList label="Block" hint="The chat is not available to these. The dashboard is not affected." value={value.blockIps} onChange={(blockIps) => onChange({ ...value, blockIps })} />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          Dashboard sign-in
          <InfoTip label="About sign-in limits">
            Attempts count per IP and per account over the window. Locked out? A one-time link from the CLI still works: npx @knowtific/helppuff dashboard
          </InfoTip>
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="Attempts per IP" hint="Sign-in attempts from one IP address, each window." max={1000} value={value.signIn.attemptsPerIp} onChange={(n) => setSignIn({ attemptsPerIp: n })} />
          <NumberField label="Wrong passwords per account" hint="Wrong passwords for one account from anywhere, each window." max={1000} value={value.signIn.attemptsPerAccount} onChange={(n) => setSignIn({ attemptsPerAccount: n })} />
          <NumberField label="Window (minutes)" hint="Both limits count over this many minutes." max={1440} value={value.signIn.windowMinutes} onChange={(n) => setSignIn({ windowMinutes: n })} />
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={value.signIn.captcha} onChange={(e) => setSignIn({ captcha: e.target.checked })} aria-describedby="signin-captcha-hint" />
          Turnstile on the sign-in form
        </label>
        <p id="signin-captcha-hint" className="pl-6 text-[11px] text-muted-foreground">
          {captcha
            ? 'Uses your chat’s Turnstile widget: add this dashboard’s hostname to it in Cloudflare.'
            : 'Takes effect once Turnstile is set up (see above).'}
        </p>
      </div>
    </div>
  );
}

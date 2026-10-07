import { render, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Message, WidgetConfig } from '@helppuff/protocol';
import { Composer } from '../src/components/Composer.js';
import { ErrorNotice } from '../src/components/ErrorNotice.js';
import { Header } from '../src/components/Header.js';
import { Home } from '../src/components/Home.js';
import { Icon } from '../src/components/Icon.js';
import { Launcher } from '../src/components/Launcher.js';
import { LeadForm } from '../src/components/LeadForm.js';
import { Teaser } from '../src/components/Teaser.js';
import { Thread, Typing } from '../src/components/Thread.js';
import { inertHandlers } from '../src/components/messages/index.js';
import { LOADER_CSS } from '../src/launcher-shell.js';
import { parseConfig } from '../src/app/validate.js';
import { makeStrings } from '../src/app/strings.js';
import { BASE_TOKENS, RESET, applyStyles, themeOverrides } from '../src/styles/tokens.js';
import { WIDGET_CSS } from '../src/styles/widget.css.js';
import type { WidgetError } from '../src/app/store.js';

/**
 * A gallery of every widget surface, rendered with the real components and
 * the real stylesheet — not mock-ups. Each specimen lives in its own shadow
 * root, exactly as the widget does on a host page, so what you see here is
 * what ships.
 */

const t = makeStrings();

const CONFIG = parseConfig({
  brand: { name: 'Knowtific', agentName: 'Alex', accent: '#5B5BF7', theme: 'light' },
  launcher: { position: 'bottom-right', label: 'Ask us' },
  home: { title: 'Hi there', subtitle: 'Ask anything, or pick a shortcut.' },
  leadForm: {
    enabled: true,
    title: 'Before we start',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Ada Lovelace', autocomplete: 'name' },
      { name: 'phone', label: 'Phone', type: 'tel', required: true, placeholder: '0400 000 000', autocomplete: 'tel' },
      { name: 'email', label: 'Email', type: 'email', placeholder: 'ada@example.com', autocomplete: 'email' },
      { name: 'when', label: 'When suits?', type: 'select', options: ['Today', 'Tomorrow', 'This week'] },
      { name: 'notes', label: 'Anything else?', type: 'textarea', placeholder: 'Tell us a little more…' },
    ],
    submitLabel: 'Start chat',
    privacy: { text: 'We only use this to reply to you.', url: 'https://example.com/privacy' },
    askFirstMessage: true,
  },
  chat: { placeholder: 'Type a message…', fallbackContact: { phone: '+61400000000', email: 'hello@example.com' } },
  teaser: { text: 'Questions? Ask away — we reply in a minute or two.', delayMs: 3000 },
  poweredBy: true,
}) as WidgetConfig;

const now = Date.now();
const m = (partial: Partial<Message> & Pick<Message, 'type'>, i: number): Message =>
  ({ id: `m${i}`, ts: now - (9 - i) * 60_000, role: 'agent', ...partial }) as Message;

const CONVERSATION: Message[] = [
  m({ type: 'text', text: "Hi — I'm Alex. What can I help with today?" }, 0),
  m({ type: 'text', text: 'I need a quote for a blocked drain in Richmond', role: 'user' }, 1),
  m(
    {
      type: 'text',
      text:
        'Happy to help with that.\n\nA standard drain callout in Richmond is **$180 + GST**, which covers:\n\n- the callout itself\n- up to 30 minutes on site\n- a camera inspection if needed\n\nIf it turns out to need jetting, that is quoted separately before any work starts. You can read the full [pricing breakdown](https://example.com/pricing) or call `1300 000 000`.',
    },
    2,
  ),
  m({ type: 'text', text: 'That works. How soon could someone come out?', role: 'user' }, 3),
  m({ type: 'notice', text: 'Alex is checking the schedule for Richmond.', tone: 'info', role: 'system' }, 4),
];

const MARKDOWN: Message[] = [
  m({ type: 'text', text: 'Plain paragraph text, which is the common case.' }, 0),
  m({ type: 'text', text: '**Bold**, *italic*, and `inline code` all render inline.' }, 1),
  m({ type: 'text', text: 'A [safe link](https://example.com) opens in a new tab with rel=noopener.' }, 2),
  m({ type: 'text', text: 'We cover:\n- Blocked drains\n- Hot water\n- Burst pipes' }, 3),
  m({ type: 'text', text: 'Two paragraphs.\n\nSeparated by a blank line.' }, 4),
  m({ type: 'text', text: 'Unsafe links stay as text: [x](javascript:alert(1)) — and <script>alert(1)</script> is escaped.' }, 5),
];

const NOTICES: Message[] = [
  m({ type: 'notice', text: 'An informational notice.', tone: 'info', role: 'system' }, 0),
  m({ type: 'notice', text: 'A warning notice — something needs attention.', tone: 'warn', role: 'system' }, 1),
];

const ERRORS: Array<[string, WidgetError]> = [
  ['rate_limited', { code: 'rate_limited', message: 'Too many messages. Try again shortly.', retryable: true, retryAfter: 12 }],
  ['connector_error', { code: 'connector_error', message: 'The assistant is unavailable right now.', retryable: true }],
  ['quota_exceeded', { code: 'quota_exceeded', message: 'Chat is unavailable right now.', retryable: false }],
  ['session_expired', { code: 'session_expired', message: 'This conversation has expired.', retryable: false }],
  ['offline', { code: 'offline', message: "You're offline. Check your connection and try again.", retryable: true }],
];

const ICONS = [
  'chat', 'phone', 'mail', 'calendar', 'quote', 'pin', 'clock', 'wrench', 'heart', 'info',
  'book', 'arrow-right', 'arrow-left', 'close', 'send', 'menu', 'sound', 'sound-off', 'check', 'external',
] as const;

/** One specimen: a shadow root with the widget's own stylesheet inside. */
function Specimen({
  title,
  note,
  height,
  theme,
  accent,
  children,
}: {
  title: string;
  note?: string;
  height?: number;
  theme: 'light' | 'dark';
  accent: string;
  children: ComponentChildren;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<(() => void) | null>(null);

  /**
   * The shadow root is attached once, but its stylesheet and contents are
   * refreshed whenever the theme or accent changes — otherwise the pickers
   * would appear to do nothing for specimens that had already mounted.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let shadow = host.shadowRoot;
    if (!shadow) {
      shadow = host.attachShadow({ mode: 'open' });
      const mountPoint = document.createElement('div');
      mountPoint.className = 'hp-root hp-specimen';
      shadow.appendChild(mountPoint);
      rootRef.current = mountPoint;
    }

    sheetRef.current?.();
    const config = { ...CONFIG, brand: { ...CONFIG.brand, accent } };
    // Token overrides come after every sheet that declares defaults.
    sheetRef.current = applyStyles(
      shadow,
      BASE_TOKENS + RESET + LOADER_CSS + WIDGET_CSS + themeOverrides(config) + HOST_OVERRIDE,
    );

    if (rootRef.current) render(children as never, rootRef.current);
  }, [accent, theme, children]);

  return (
    <figure class="spec">
      <figcaption>
        <b>{title}</b>
        {note ? <span>{note}</span> : null}
      </figcaption>
      <div class="stage" data-theme={theme}>
        <div
          class="shadow-host"
          data-theme={theme}
          style={{ height: height ? `${height}px` : undefined }}
          ref={hostRef}
        />
      </div>
    </figure>
  );
}

/**
 * The widget positions itself `fixed` on a real page. Inside a gallery cell
 * it has to sit still, so positioning is neutralised here only.
 */
const HOST_OVERRIDE = `
:host { position: static !important; display: block; height: 100%; }
.hp-specimen { height: 100%; }
.hp-panel, .hp-launcher, .hp-teaser {
  position: relative !important;
  inset: auto !important;
  animation: none !important;
}
.hp-panel { width: 100%; max-width: 400px; height: 100%; }
.hp-launcher, .hp-teaser { display: inline-flex; }
`;

function Gallery() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [accent, setAccent] = useState('#5B5BF7');
  const [draft, setDraft] = useState('A message being typed');

  const spec = { theme, accent };
  const shell = (children: ComponentChildren) => (
    <div class="hp-panel" data-position="bottom-right">
      {children}
    </div>
  );

  return (
    <>
      <header class="head">
        <div>
          <h1>HelpPuff component gallery</h1>
          <p>Every surface, rendered with the real components and the shipped stylesheet.</p>
        </div>
        <div class="controls">
          <label>
            Theme
            <select value={theme} onChange={(e) => setTheme((e.target as HTMLSelectElement).value as 'light' | 'dark')}>
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </label>
          <label>
            Accent
            <input type="color" value={accent} onInput={(e) => setAccent((e.target as HTMLInputElement).value)} />
          </label>
          <div class="swatches">
            {['#5B5BF7', '#0F9D58', '#E8590C', '#D6336C', '#F4C20D', '#111114'].map((c) => (
              <button key={c} style={{ background: c }} onClick={() => setAccent(c)} aria-label={c} />
            ))}
          </div>
          <a href="./">← Playground</a>
        </div>
      </header>

      <h2>Launcher</h2>
      <div class="grid">
        <Specimen title="Orb" note="Idle. Gradient drifts over 12s." {...spec} height={90}>
          <Launcher config={{ ...CONFIG, launcher: { ...CONFIG.launcher, label: undefined } }} open={false} unread={0} onClick={() => {}} />
        </Specimen>
        <Specimen title="Orb with label" note="Desktop only" {...spec} height={90}>
          <Launcher config={CONFIG} open={false} unread={0} onClick={() => {}} />
        </Specimen>
        <Specimen title="Unread" note="Dot while closed" {...spec} height={90}>
          <Launcher config={{ ...CONFIG, launcher: { ...CONFIG.launcher, label: undefined } }} open={false} unread={3} onClick={() => {}} />
        </Specimen>
        <Specimen title="Open" note="Morphs to a close glyph" {...spec} height={90}>
          <Launcher config={{ ...CONFIG, launcher: { ...CONFIG.launcher, label: undefined } }} open unread={0} onClick={() => {}} />
        </Specimen>
        <Specimen title="Teaser" note="Appears after delayMs, once per session" {...spec} height={120}>
          <Teaser text={CONFIG.teaser!.text} position="bottom-right" onOpen={() => {}} onDismiss={() => {}} />
        </Specimen>
      </div>

      <h2>Screens</h2>
      <div class="grid wide">
        <Specimen title="Home" note="Title, subtitle, accent wash" {...spec} height={520}>
          {shell(
            <>
              <Header config={CONFIG} thinking={false} showBack={false} t={t} onBack={() => {}} onClose={() => {}} />
              <Home config={CONFIG} shortcuts={[]} onShortcut={() => {}} hasSession={false} lastMessage={undefined} busy={false} t={t} onStart={() => {}} />
            </>,
          )}
        </Specimen>

        <Specimen title="Home — returning visitor" note="Resume with a preview" {...spec} height={520}>
          {shell(
            <>
              <Header config={CONFIG} thinking={false} showBack={false} t={t} onBack={() => {}} onClose={() => {}} />
              <Home config={CONFIG} shortcuts={[]} onShortcut={() => {}} hasSession lastMessage={CONVERSATION[2]} busy={false} t={t} onStart={() => {}} />
            </>,
          )}
        </Specimen>

        <Specimen title="Lead form" note="Every field type, with validation" {...spec} height={720}>
          {shell(
            <>
              <Header config={CONFIG} thinking={false} showBack t={t} onBack={() => {}} onClose={() => {}} />
              <div class="hp-screen">
                <div class="hp-scroll">
                  <LeadForm config={CONFIG} initial={null} busy={false} t={t} onSubmit={() => {}} />
                </div>
              </div>
            </>,
          )}
        </Specimen>

        <Specimen title="Conversation" note="Agent text has no bubble; user text does" {...spec} height={620}>
          {shell(
            <>
              <Header config={CONFIG} thinking={false} showBack={false} t={t} onBack={() => {}} onClose={() => {}} />
              <div class="hp-screen">
                <Thread messages={CONVERSATION} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />
                <Composer value="" disabled={false} offline={false} placeholder="Type a message…" t={t} onInput={() => {}} onSend={() => {}} />
              </div>
            </>,
          )}
        </Specimen>

        <Specimen title="Waiting for a reply" note="Header orb pulses, dots animate" {...spec} height={620}>
          {shell(
            <>
              <Header config={CONFIG} thinking showBack={false} t={t} onBack={() => {}} onClose={() => {}} />
              <div class="hp-screen">
                <Thread
                  messages={[...CONVERSATION.slice(0, 2)]}
                  busy
                  pendingIds={new Set(['m1'])}
                  handlers={inertHandlers}
                  t={t}
                />
                <Composer value="" disabled offline={false} placeholder="Type a message…" t={t} onInput={() => {}} onSend={() => {}} />
              </div>
            </>,
          )}
        </Specimen>
      </div>

      <h2>Messages</h2>
      <div class="grid wide">
        <Specimen title="Markdown subset" note="and the XSS cases, neutralised" {...spec} height={430}>
          {shell(<Thread messages={MARKDOWN} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />)}
        </Specimen>
        <Specimen title="Notices" note="info and warn" {...spec} height={180}>
          {shell(<Thread messages={NOTICES} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />)}
        </Specimen>
      </div>

      <h2>Composer</h2>
      <div class="grid wide">
        <Specimen title="Empty" note="Send button hidden until there is text" {...spec} height={110}>
          <Composer value="" disabled={false} offline={false} placeholder="Type a message…" t={t} onInput={() => {}} onSend={() => {}} />
        </Specimen>
        <Specimen title="Typing" note="Send scales in; try it" {...spec} height={110}>
          <Composer value={draft} disabled={false} offline={false} placeholder="Type…" t={t} onInput={setDraft} onSend={() => {}} />
        </Specimen>
        <Specimen title="Near the limit" note="Counter appears in the last 100 chars" {...spec} height={130}>
          <Composer value={'x'.repeat(940)} disabled={false} offline={false} placeholder="" t={t} onInput={() => {}} onSend={() => {}} />
        </Specimen>
        <Specimen title="Offline" note="Nothing is queued" {...spec} height={130}>
          <Composer value="" disabled offline placeholder="Type a message…" t={t} onInput={() => {}} onSend={() => {}} />
        </Specimen>
      </div>

      <h2>Errors and limits</h2>
      <div class="grid wide">
        {ERRORS.map(([name, error]) => (
          <Specimen key={name} title={name} note="Degrades in place — never hides" {...spec} height={150}>
            <ErrorNotice error={error} config={CONFIG} t={t} onRetry={() => {}} onNewChat={() => {}} onDismiss={() => {}} />
          </Specimen>
        ))}
      </div>

      <h2>Pieces</h2>
      <div class="grid">
        <Specimen title="Typing indicator" {...spec} height={70}>
          <div style={{ padding: '16px' }}>
            <Typing />
          </div>
        </Specimen>
        <Specimen title="Buttons" {...spec} height={150}>
          <div style={{ padding: '16px', display: 'grid', gap: '10px' }}>
            <button class="hp-btn">Primary action</button>
            <button class="hp-btn" disabled>Disabled</button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button class="hp-chip">Chip</button>
              <button class="hp-chip">Another</button>
            </div>
          </div>
        </Specimen>
        <Specimen title="Header" note="Orb, name, status, close" {...spec} height={80}>
          <Header config={CONFIG} thinking={false} showBack={false} t={t} onBack={() => {}} onClose={() => {}} />
        </Specimen>
        <Specimen title="Icon set" note="20 inline SVGs, no icon font" {...spec} height={150}>
          <div style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px', color: 'var(--hp-text-2)' }}>
            {ICONS.map((name) => (
              <span key={name} title={name}>
                <Icon name={name} />
              </span>
            ))}
          </div>
        </Specimen>
      </div>

      <h2>Mobile</h2>
      <div class="grid">
        <figure class="spec">
          <figcaption>
            <b>Full screen under 640px</b>
            <span>100dvh, safe-area insets, 16px inputs</span>
          </figcaption>
          <div class="stage" data-theme={theme}>
            <iframe src="gallery.html?frame=mobile" title="Mobile" style={{ width: '390px', height: '600px', border: 0 }} />
          </div>
        </figure>
      </div>

      <footer>
        Built from <code>packages/widget/src</code>. Rich message types (options, card, carousel, links, form) land in M4.
      </footer>
    </>
  );
}

/** The mobile frame renders one panel at phone width. */
function MobileFrame() {
  return (
    <div style={{ height: '100vh' }}>
      <Specimen title="" theme="light" accent="#5B5BF7" height={600}>
        <div class="hp-panel">
          <Header config={CONFIG} thinking={false} showBack={false} t={t} onBack={() => {}} onClose={() => {}} />
          <div class="hp-screen">
            <Thread messages={CONVERSATION} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />
            <Composer value="" disabled={false} offline={false} placeholder="Type a message…" t={t} onInput={() => {}} onSend={() => {}} />
          </div>
        </div>
      </Specimen>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  const frame = new URLSearchParams(location.search).get('frame');
  render(frame === 'mobile' ? <MobileFrame /> : <Gallery />, root);
}

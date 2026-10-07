import { render, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { iconNames, widgetConfigSchema } from '@helppuff/protocol';
import type { FromPreview, PreviewSetup, ToPreview } from './preview.js';
import { CHAT_SHORTCUTS, FIELD_LIBRARY, HOME_LINKS, HOME_SHORTCUTS, PRESETS, PRIVACY, SUPPORT_CONFIG, TEASER, type WidgetJson } from './presets.js';
import { OPTIONS, describe } from './reference.js';

/**
 * The options playground: every widget setting beside the real widget.
 *
 * The preview is an iframe (`preview.html`) running the real loader and app
 * against an in-page copy of the API, so this works as a static page with no
 * Worker — the copy on the website (`/playground/`) is this file. Changing an option
 * reloads the frame, and the config travels in the URL so a link reproduces
 * it.
 */

type Backend = { stream: boolean; delayMs: number };
type Embed = { fill: boolean };
type Tab = 'options' | 'json' | 'reference' | 'export';

const REPO = 'https://github.com/knowtific/helppuff';
const DOCS = 'https://knowtific.github.io/helppuff/docs';

// ---------------------------------------------------------------------------
// Config paths

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function getPath(root: WidgetJson, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** A copy with `path` set; `undefined` removes the key, and an emptied parent with it. */
function setPath(root: WidgetJson, path: string, value: unknown): WidgetJson {
  const next = clone(root);
  const keys = path.split('.');
  const parents: Record<string, unknown>[] = [];
  let node: Record<string, unknown> = next;
  for (const key of keys.slice(0, -1)) {
    parents.push(node);
    const child = node[key];
    if (!child || typeof child !== 'object' || Array.isArray(child)) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1]!;
  if (value === undefined) delete node[last];
  else node[last] = clone(value);
  // Tidy: `{ launcher: {} }` says nothing a missing key does not.
  for (let i = parents.length - 1; i >= 0; i--) {
    const key = keys[i]!;
    const child = parents[i]![key];
    if (child && typeof child === 'object' && Object.keys(child).length === 0) delete parents[i]![key];
  }
  return next;
}

// ---------------------------------------------------------------------------
// Shareable links: the config rides in the URL hash.

function encode(state: { widget: WidgetJson; backend: Backend; embed: Embed }): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(hash: string): { widget: WidgetJson; backend?: Backend; embed?: Embed; preset?: string } | null {
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const preset = PRESETS.find((p) => p.id === params.get('p'));
    if (preset) return { widget: clone(preset.widget), preset: preset.id };
    const raw = params.get('c');
    if (!raw) return null;
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as unknown;
    if (!parsed || typeof parsed !== 'object' || !('widget' in parsed)) return null;
    return parsed as { widget: WidgetJson; backend?: Backend; embed?: Embed };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Controls

let ids = 0;
const useId = () => useMemo(() => `pg-${++ids}`, []);

/** The schema's descriptions mark code with backticks. */
function Rich({ text }: { text: string }) {
  return <>{text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</>;
}

function Hint({ path, children }: { path?: string; children?: ComponentChildren }) {
  const text = children ?? (path ? <Rich text={describe(path)} /> : null);
  if (!children && !(path && describe(path))) return null;
  return text ? <p class="hint">{text}</p> : null;
}

function Row({ label, path, hint, children, id }: { label: string; path?: string; hint?: ComponentChildren; children: ComponentChildren; id?: string }) {
  return (
    <div class="field">
      <label class="label" for={id}>
        {label}
        {path && <code class="path" aria-hidden="true">{path}</code>}
      </label>
      {children}
      <Hint path={path}>{hint}</Hint>
    </div>
  );
}

function TextInput({ label, path, value, onChange, placeholder, multiline }: { label: string; path?: string; value: string; onChange: (v: string | undefined) => void; placeholder?: string; multiline?: boolean }) {
  const id = useId();
  const handle = (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    onChange(v === '' ? undefined : v);
  };
  return (
    <Row label={label} path={path} id={id}>
      {multiline ? (
        <textarea id={id} rows={2} value={value} placeholder={placeholder} onInput={handle} />
      ) : (
        <input id={id} type="text" value={value} placeholder={placeholder} onInput={handle} />
      )}
    </Row>
  );
}

function Choice<T extends string>({ label, path, value, options, onChange }: { label: string; path?: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <Row label={label} path={path}>
      <div class="seg" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={option === value} onClick={() => onChange(option)}>
            {option}
          </button>
        ))}
      </div>
    </Row>
  );
}

function Toggle({ label, path, checked, onChange, hint }: { label: string; path?: string; checked: boolean; onChange: (v: boolean) => void; hint?: ComponentChildren }) {
  const id = useId();
  return (
    <div class="field toggle">
      <label class="switch" for={id}>
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
        <span class="label">
          {label}
          {path && <code class="path" aria-hidden="true">{path}</code>}
        </span>
      </label>
      <Hint path={path}>{hint}</Hint>
    </div>
  );
}

function Slider({ label, path, value, min, max, step = 1, unit = '', onChange, hint }: { label: string; path?: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; hint?: ComponentChildren }) {
  const id = useId();
  return (
    <Row label={label} path={path} id={id} hint={hint}>
      <div class="slider">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))} />
        <output for={id}>{value}{unit}</output>
      </div>
    </Row>
  );
}

function Section({ title, children, open = false }: { title: string; children: ComponentChildren; open?: boolean }) {
  return (
    <details class="section" open={open}>
      <summary>{title}</summary>
      <div class="section-body">{children}</div>
    </details>
  );
}

const SWATCHES = ['#5B5BF7', '#0F766E', '#16A34A', '#F97316', '#DC2626', '#DB2777', '#111827'];
const FONTS = [
  { label: 'System', value: '' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Rounded', value: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
];

// ---------------------------------------------------------------------------
// The options form

function OptionsForm({ widget, update, backend, setBackend, embed, setEmbed }: {
  widget: WidgetJson;
  update: (path: string, value: unknown) => void;
  backend: Backend;
  setBackend: (b: Backend) => void;
  embed: Embed;
  setEmbed: (e: Embed) => void;
}) {
  const str = (path: string) => {
    const v = getPath(widget, path);
    return typeof v === 'string' ? v : '';
  };
  const num = (path: string, fallback: number) => {
    const v = getPath(widget, path);
    return typeof v === 'number' ? v : fallback;
  };
  const px = (path: string, fallback: number) => {
    const v = getPath(widget, path);
    return typeof v === 'string' && /^\d+px$/.test(v) ? parseInt(v, 10) : fallback;
  };
  const accent = str('brand.accent') || '#5B5BF7';
  const teaser = getPath(widget, 'teaser');
  const offset = getPath(widget, 'launcher.offset');
  const leadFields = (getPath(widget, 'leadForm.fields') as { name: string }[] | undefined) ?? FIELD_LIBRARY.slice(0, 2);
  const leadNames = new Set(leadFields.map((f) => f.name));
  const poweredBy = getPath(widget, 'poweredBy');
  const poweredByMode = poweredBy === false ? 'hidden' : poweredBy && typeof poweredBy === 'object' ? 'custom' : 'HelpPuff';

  /** Shortcuts open the quote flow and booking form, so switching them on brings those along. */
  const withSupport = (path: string, value: unknown) => {
    update(path, value);
    if (value !== undefined) {
      if (!getPath(widget, 'flows')) update('flows', SUPPORT_CONFIG.flows);
      if (!getPath(widget, 'forms')) update('forms', SUPPORT_CONFIG.forms);
    }
  };

  const toggleField = (name: string, on: boolean) => {
    const library = FIELD_LIBRARY.filter((f) => (f.name === name ? on : leadNames.has(f.name)));
    const custom = leadFields.filter((f) => !FIELD_LIBRARY.some((l) => l.name === f.name));
    const next = [...library, ...custom];
    update('leadForm.fields', next.length ? next : undefined);
  };

  return (
    <div class="form">
      <Section title="Brand" open>
        <TextInput label="Business name" path="brand.name" value={str('brand.name')} placeholder="Chat" onChange={(v) => update('brand.name', v)} />
        <TextInput label="Assistant name" path="brand.agentName" value={str('brand.agentName')} placeholder="Assistant" onChange={(v) => update('brand.agentName', v)} />
        <TextInput label="Avatar image URL" path="brand.avatar" value={str('brand.avatar')} placeholder="https://…/avatar.png" onChange={(v) => update('brand.avatar', v)} />
        <Row label="Accent colour" path="brand.accent">
          <div class="color">
            <input type="color" aria-label="Accent colour" value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#5B5BF7'} onInput={(e) => update('brand.accent', (e.target as HTMLInputElement).value.toUpperCase())} />
            <div class="swatches">
              {SWATCHES.map((c) => (
                <button key={c} type="button" style={{ background: c }} aria-label={`Accent ${c}`} aria-pressed={c.toLowerCase() === accent.toLowerCase()} onClick={() => update('brand.accent', c)} />
              ))}
            </div>
          </div>
        </Row>
        <Choice label="Theme" path="brand.theme" value={(str('brand.theme') || 'auto') as 'light' | 'dark' | 'auto'} options={['light', 'auto', 'dark'] as const} onChange={(v) => update('brand.theme', v)} />
      </Section>

      <Section title="Launcher" open>
        <Choice label="Position" path="launcher.position" value={(str('launcher.position') || 'bottom-right') as 'bottom-right' | 'bottom-left'} options={['bottom-left', 'bottom-right'] as const} onChange={(v) => update('launcher.position', v)} />
        <Choice label="Shape" path="launcher.shape" value={(str('launcher.shape') || 'orb') as 'orb' | 'pill'} options={['orb', 'pill'] as const} onChange={(v) => update('launcher.shape', v)} />
        <Row label="Icon" path="launcher.icon">
          <select aria-label="Icon" value={str('launcher.icon') || 'chat'} onChange={(e) => update('launcher.icon', (e.target as HTMLSelectElement).value)}>
            {iconNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </Row>
        <TextInput label="Label" path="launcher.label" value={str('launcher.label')} placeholder="Chat with us" onChange={(v) => update('launcher.label', v)} />
        <Toggle label="Move away from the corner" path="launcher.offset" checked={Boolean(offset)} onChange={(on) => update('launcher.offset', on ? { x: 24, y: 96 } : undefined)} />
        {Boolean(offset) && (
          <>
            <Slider label="From the side" value={num('launcher.offset.x', 24)} min={0} max={200} unit="px" onChange={(v) => update('launcher.offset.x', v)} />
            <Slider label="From the bottom" value={num('launcher.offset.y', 96)} min={0} max={200} unit="px" onChange={(v) => update('launcher.offset.y', v)} />
          </>
        )}
      </Section>

      <Section title="Teaser bubble">
        <Toggle label="Show a teaser" path="teaser" checked={Boolean(teaser)} onChange={(on) => update('teaser', on ? TEASER : undefined)} />
        {Boolean(teaser) && (
          <>
            <TextInput label="Text" path="teaser.text" value={str('teaser.text')} onChange={(v) => update('teaser.text', v ?? TEASER.text)} />
            <Slider label="After" path="teaser.delayMs" value={num('teaser.delayMs', 8000) / 1000} min={2} max={30} unit="s" onChange={(v) => update('teaser.delayMs', v * 1000)} />
            <Toggle label="Or after scrolling" path="teaser.afterScroll" checked={getPath(widget, 'teaser.afterScroll') !== undefined} onChange={(on) => update('teaser.afterScroll', on ? 25 : undefined)} />
            {getPath(widget, 'teaser.afterScroll') !== undefined && (
              <Slider label="Scrolled" value={num('teaser.afterScroll', 25)} min={1} max={100} unit="%" onChange={(v) => update('teaser.afterScroll', v)} />
            )}
          </>
        )}
      </Section>

      <Section title="Home screen">
        <TextInput label="Title" path="home.title" value={str('home.title')} placeholder="Hi there" onChange={(v) => update('home.title', v)} />
        <TextInput label="Subtitle" path="home.subtitle" value={str('home.subtitle')} placeholder="Ask anything, or pick a shortcut." onChange={(v) => update('home.subtitle', v)} />
        <Toggle label="Shortcut buttons" path="home.shortcuts" checked={Boolean(getPath(widget, 'home.shortcuts'))} onChange={(on) => withSupport('home.shortcuts', on ? HOME_SHORTCUTS : undefined)} hint="A guided quote flow, an example card, an inline booking form and a call button. Each shortcut runs an action: reply, flow, form, url, tel or email." />
        <Toggle label="Useful links" path="home.links" checked={Boolean(getPath(widget, 'home.links'))} onChange={(on) => update('home.links', on ? HOME_LINKS : undefined)} />
      </Section>

      <Section title="Lead form">
        <Toggle label="Ask for details first" path="leadForm.enabled" checked={getPath(widget, 'leadForm.enabled') !== false} onChange={(on) => update('leadForm.enabled', on)} />
        {getPath(widget, 'leadForm.enabled') !== false && (
          <>
            <TextInput label="Title" path="leadForm.title" value={str('leadForm.title')} placeholder="Before we start" onChange={(v) => update('leadForm.title', v)} />
            <Row label="Fields" path="leadForm.fields">
              <div class="checks">
                {FIELD_LIBRARY.map((field) => (
                  <label key={field.name} class="check">
                    <input type="checkbox" checked={leadNames.has(field.name)} onChange={(e) => toggleField(field.name, (e.target as HTMLInputElement).checked)} />
                    {field.label}
                    <span class="muted">{field.type}{field.required ? ', required' : ''}</span>
                  </label>
                ))}
              </div>
            </Row>
            <Toggle label="Ask for the first message too" path="leadForm.askFirstMessage" checked={getPath(widget, 'leadForm.askFirstMessage') === true} onChange={(on) => update('leadForm.askFirstMessage', on || undefined)} />
            <TextInput label="Button" path="leadForm.submitLabel" value={str('leadForm.submitLabel')} placeholder="Start chat" onChange={(v) => update('leadForm.submitLabel', v)} />
            <Toggle label="Privacy note" path="leadForm.privacy" checked={Boolean(getPath(widget, 'leadForm.privacy'))} onChange={(on) => update('leadForm.privacy', on ? PRIVACY : undefined)} />
          </>
        )}
      </Section>

      <Section title="Chat screen">
        <TextInput label="Welcome message" path="chat.initialMessages" value={str('chat.initialMessages.0')} placeholder="Hi! How can I help?" multiline onChange={(v) => update('chat.initialMessages', v ? [v] : undefined)} />
        <TextInput label="Message box hint" path="chat.placeholder" value={str('chat.placeholder')} placeholder="Type a message…" onChange={(v) => update('chat.placeholder', v)} />
        <Toggle label="Quick replies" path="chat.shortcuts" checked={Boolean(getPath(widget, 'chat.shortcuts'))} onChange={(on) => withSupport('chat.shortcuts', on ? CHAT_SHORTCUTS : undefined)} />
        <TextInput label="Fallback phone" path="chat.fallbackContact.phone" value={str('chat.fallbackContact.phone')} placeholder="+61 400 000 000" onChange={(v) => update('chat.fallbackContact.phone', v)} />
        <TextInput label="Fallback email" path="chat.fallbackContact.email" value={str('chat.fallbackContact.email')} placeholder="hello@example.com" onChange={(v) => update('chat.fallbackContact.email', v)} />
        <p class="hint">Send <code>/error</code> in the chat to see the fallback contact.</p>
      </Section>

      <Section title="Style">
        <Row label="Font" path="brand.tokens.font">
          <select aria-label="Font" value={str('brand.tokens.font')} onChange={(e) => update('brand.tokens.font', (e.target as HTMLSelectElement).value || undefined)}>
            {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
        </Row>
        <Slider label="Panel corners" path="brand.tokens.radius-panel" value={px('brand.tokens.radius-panel', 28)} min={0} max={32} unit="px" onChange={(v) => update('brand.tokens.radius-panel', `${v}px`)} />
        <Slider label="Button corners" path="brand.tokens.radius-lg" value={px('brand.tokens.radius-lg', 24)} min={0} max={28} unit="px" onChange={(v) => update('brand.tokens.radius-lg', `${v}px`)} />
        <Slider label="Panel width" path="brand.tokens.panel-w" value={px('brand.tokens.panel-w', 400)} min={320} max={520} step={10} unit="px" onChange={(v) => update('brand.tokens.panel-w', `${v}px`)} />
        <p class="hint">Every token in <code>brand.tokens</code> is listed under Reference; edit any of them in JSON.</p>
      </Section>

      <Section title="Extras">
        <Toggle label="Reply sound" path="sound" checked={getPath(widget, 'sound.enabled') === true} onChange={(on) => update('sound', on ? { enabled: true } : undefined)} />
        <Choice label="Footer credit" path="poweredBy" value={poweredByMode as 'HelpPuff' | 'hidden' | 'custom'} options={['HelpPuff', 'custom', 'hidden'] as const} onChange={(v) => update('poweredBy', v === 'hidden' ? false : v === 'custom' ? { text: 'Your own credit' } : true)} />
        {poweredByMode === 'custom' && (
          <TextInput label="Credit text" path="poweredBy.text" value={str('poweredBy.text')} onChange={(v) => update('poweredBy.text', v ?? 'Your own credit')} />
        )}
      </Section>

      <Section title="Embed and replies">
        <Toggle label="Fill the page" checked={embed.fill} onChange={(fill) => setEmbed({ ...embed, fill })} hint={<>The <code>data-fill</code> attribute: a full-page chat with no launcher, for a chat link or an embedded panel.</>} />
        <Toggle label="Stream replies" checked={backend.stream} onChange={(stream) => setBackend({ ...backend, stream })} hint="Words appear as they are written, the way Workers AI and the other model backends answer." />
        <Slider label="Reply delay" value={backend.delayMs / 1000} min={0} max={5} step={0.5} unit="s" onChange={(v) => setBackend({ ...backend, delayMs: v * 1000 })} hint="Simulated thinking time, to watch the typing indicator." />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON, reference and export tabs

function JsonEditor({ widget, onApply, issues }: { widget: WidgetJson; onApply: (w: WidgetJson) => void; issues: string[] }) {
  const pretty = JSON.stringify(widget, null, 2);
  const [text, setText] = useState(pretty);
  const [error, setError] = useState('');
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(pretty);
  }, [pretty]);

  const apply = (value: string) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The widget config is an object: { "brand": { … }, … }');
      setError('');
      onApply(parsed as WidgetJson);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  };

  return (
    <div class="json">
      <p class="hint">
        The <code>widget</code> section of <code>helppuff.json</code>. Edit it directly: the preview follows as soon as it parses.
      </p>
      <textarea
        aria-label="Widget config JSON"
        spellcheck={false}
        value={text}
        onFocus={() => (editing.current = true)}
        onBlur={() => {
          editing.current = false;
          setText(JSON.stringify(widget, null, 2));
        }}
        onInput={(e) => {
          const value = (e.target as HTMLTextAreaElement).value;
          setText(value);
          apply(value);
        }}
      />
      {error && <p class="problem" role="alert">JSON: {error}</p>}
      {!error && issues.map((issue) => <p key={issue} class="problem" role="alert">{issue}</p>)}
    </div>
  );
}

function Reference() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = q ? OPTIONS.filter((row) => `${row.path} ${row.description}`.toLowerCase().includes(q)) : OPTIONS;
  return (
    <div class="reference">
      <p class="hint">
        Every widget option, generated from the schema HelpPuff validates with. The full <code>helppuff.json</code> reference, including backends,
        knowledge and security, is in the <a href={`${DOCS}/Configuration-Reference`} target="_blank" rel="noopener">docs</a>.
      </p>
      <input type="search" placeholder={`Filter ${OPTIONS.length} options…`} aria-label="Filter options" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
      <dl>
        {rows.map((row) => (
          <div key={row.path} class="ref-row">
            <dt>
              <code>widget.{row.path}</code>
              <span class="type">{row.type}</span>
              {row.defaultValue !== undefined && <span class="default">default {row.defaultValue}</span>}
            </dt>
            <dd>{row.description ? <Rich text={row.description} /> : <span class="muted">—</span>}</dd>
          </div>
        ))}
      </dl>
      {rows.length === 0 && <p class="muted">No option matches “{query}”.</p>}
    </div>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="copy">
      <div class="copy-head">
        <span>{label}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

function Export({ widget, embed, share }: { widget: WidgetJson; embed: Embed; share: string }) {
  const json = JSON.stringify({ widget }, null, 2);
  const snippet = `<script src="https://<your worker>/loader.js" data-site="<your site>"${embed.fill ? ' data-fill' : ''} async></script>`;
  return (
    <div class="export">
      <h3>Use it on your site</h3>
      <ol>
        <li>
          Set up HelpPuff in your Cloudflare account: <code>npx @knowtific/helppuff</code>, or hand your coding agent the{' '}
          <a href={`${REPO}#install-it`} target="_blank" rel="noopener">install prompt</a>.
        </li>
        <li>Merge this into <code>helppuff.json</code> and run <code>helppuff deploy</code>. Most of it can also be changed in the dashboard's Settings.</li>
        <li>Add the script tag the dashboard gives you to your pages.</li>
      </ol>
      <CopyBlock label="helppuff.json" text={json} />
      <CopyBlock label="Embed" text={snippet} />
      <CopyBlock label="Link to this exact setup" text={share} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page

function Playground() {
  const initial = useMemo(() => decode(location.hash), []);
  const [widget, setWidget] = useState<WidgetJson>(() => initial?.widget ?? clone(PRESETS[0]!.widget));
  const [backend, setBackend] = useState<Backend>(() => initial?.backend ?? { stream: true, delayMs: 0 });
  const [embed, setEmbed] = useState<Embed>(() => initial?.embed ?? { fill: false });
  const [tab, setTab] = useState<Tab>('options');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [frameKey, setFrameKey] = useState(0);
  const [preset, setPreset] = useState(initial ? (initial.preset ?? '') : PRESETS[0]!.id);
  const frame = useRef<HTMLIFrameElement>(null);
  const isOpen = useRef(false);

  const result = useMemo(() => widgetConfigSchema.safeParse(widget), [widget]);
  const issues = result.success ? [] : result.error.issues.map((i) => `widget.${i.path.join('.')}: ${i.message}`);

  // An untouched preset gets a short link; anything else carries the whole config.
  const untouched = preset !== '' && backend.stream && backend.delayMs === 0 && !embed.fill;
  const hash = untouched ? `#p=${preset}` : `#c=${encode({ widget, backend, embed })}`;
  const share = `${location.origin}${location.pathname}${hash}`;

  // The setup the next frame boots with. Read by the message handler, so it is always the latest.
  const setup = useRef<PreviewSetup>({ widget, ...backend, open: false, fill: embed.fill });

  // Debounced: typing in a field reloads the preview once, when you pause.
  // The first frame already boots with the initial setup, so mounting skips it.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!result.success) return;
    const timer = setTimeout(() => {
      setup.current = { widget, ...backend, open: isOpen.current, fill: embed.fill };
      setFrameKey((k) => k + 1);
      try {
        history.replaceState(null, '', hash);
      } catch {
        // A sandboxed host page may forbid it; the share box still works.
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [widget, backend, embed, result.success]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<FromPreview>) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === 'hp-pg:ready') {
        frame.current?.contentWindow?.postMessage({ type: 'hp-pg:setup', setup: setup.current } satisfies ToPreview, location.origin);
      } else if (data?.type === 'hp-pg:event') {
        if (data.name === 'open') isOpen.current = true;
        if (data.name === 'close') isOpen.current = false;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const update = (path: string, value: unknown) => {
    setPreset('');
    setWidget((current) => setPath(current, path, value));
  };

  const restart = () => {
    isOpen.current = false;
    setup.current = { ...setup.current, open: false };
    setFrameKey((k) => k + 1);
  };

  return (
    <div class="app">
      <header class="top">
        <div class="title">
          <h1>HelpPuff playground</h1>
          <p>Try every widget option on the real widget. Nothing to install; this page talks to no server.</p>
        </div>
        <div class="top-actions">
          <label class="preset">
            <span>Start from</span>
            <select
              aria-label="Start from"
              value={preset}
              onChange={(e) => {
                const id = (e.target as HTMLSelectElement).value;
                const found = PRESETS.find((p) => p.id === id);
                if (!found) return;
                setPreset(id);
                setWidget(clone(found.widget));
              }}
            >
              {!preset && <option value="">Your changes</option>}
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <a href="gallery.html">Component gallery</a>
          <a href={`${DOCS}/Widget`} target="_blank" rel="noopener">Widget docs</a>
          <a href={REPO} target="_blank" rel="noopener">GitHub</a>
        </div>
      </header>

      <main class="layout">
        <aside class="panel" aria-label="Widget options">
          <div class="tabs" role="tablist">
            {(['options', 'json', 'reference', 'export'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {{ options: 'Options', json: 'JSON', reference: 'Reference', export: 'Use it' }[t]}
                {t === 'json' && issues.length > 0 && <span class="badge" aria-label={`${issues.length} problems`}>{issues.length}</span>}
              </button>
            ))}
          </div>
          <div class="tab-body" role="tabpanel">
            {tab === 'options' && <OptionsForm widget={widget} update={update} backend={backend} setBackend={setBackend} embed={embed} setEmbed={setEmbed} />}
            {tab === 'json' && <JsonEditor widget={widget} issues={issues} onApply={(w) => { setPreset(''); setWidget(w); }} />}
            {tab === 'reference' && <Reference />}
            {tab === 'export' && <Export widget={widget} embed={embed} share={share} />}
          </div>
        </aside>

        <section class="stage" aria-label="Preview">
          <div class="toolbar">
            <div class="seg" role="radiogroup" aria-label="Device">
              {(['desktop', 'mobile'] as const).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={device === d} onClick={() => setDevice(d)}>{d}</button>
              ))}
            </div>
            <p class="toolbar-hint">Message types, the JavaScript API and the event log are in the preview page.</p>
            <div class="api">
              <button type="button" onClick={restart}>Restart</button>
            </div>
          </div>
          <div class={`device ${device}`}>
            <iframe key={frameKey} ref={frame} src="preview.html" title="Widget preview" />
          </div>
        </section>
      </main>
    </div>
  );
}

render(<Playground />, document.getElementById('root')!);

import { renderControls } from './controls.js';
import { MOCK_API, installMockBackend } from './mock-backend.js';
import { PRESETS } from './presets.js';
import { showcaseReply } from './showcase.js';

/**
 * The page inside the options playground's preview frame: the host site,
 * embedding the widget the way a real one does, with a script tag. Its own
 * content is the controls (`controls.ts`): every message type, the
 * JavaScript API and an event log.
 *
 * The playground posts the config here; this installs the in-page API that
 * serves it (`mock-backend.ts`) and then adds the loader. A config change
 * reloads the frame, so every change boots the widget from scratch, exactly
 * as a visitor's page load would.
 *
 * It also works on its own, configured by its URL — the website embeds it and
 * the screenshot script drives it this way:
 *   ?preset=trades          a preset from `presets.ts`
 *   ?setup=<base64url JSON> a whole `PreviewSetup` (overrides the preset)
 *   &open=1 &fill=1 &stream=0
 *   &demo=showcase          scripted answers from `showcase.ts` instead of echo's
 */

/** `/src/loader.ts` under the dev server, the built `widget/loader.js` on the hosted page. */
declare const __HELPPUFF_PLAYGROUND_LOADER__: string;

export type PreviewSetup = {
  widget: unknown;
  stream: boolean;
  delayMs: number;
  /** Open the chat once it loads (`data-open`): kept across reloads while it is open. */
  open: boolean;
  /** `data-fill`: the chat fills the frame, with no launcher. */
  fill: boolean;
  /** Answer with `showcase.ts` rather than echo. */
  showcase?: boolean;
};

export type ToPreview = { type: 'hp-pg:setup'; setup: PreviewSetup } | { type: 'hp-pg:call'; method: string; args: unknown[] };
export type FromPreview = { type: 'hp-pg:ready' } | { type: 'hp-pg:event'; name: string; detail?: unknown };

type Method = (...args: unknown[]) => unknown;
type HelpPuffApi = { [name: string]: unknown; q?: unknown[][] };
declare global {
  interface Window {
    HelpPuff?: HelpPuffApi;
  }
}

const embedded = window.parent !== window;
const post = (message: FromPreview) => {
  if (embedded) window.parent.postMessage(message, location.origin);
};

/** Each preview is a first visit: no saved chat, no teaser already seen. */
function forgetVisit(): void {
  for (const store of [localStorage, sessionStorage]) {
    try {
      for (const key of Object.keys(store)) if (key.startsWith('hp')) store.removeItem(key);
    } catch {
      // Storage blocked: the widget copes, and so does the preview.
    }
  }
}

let booted = false;

function boot(setup: PreviewSetup): void {
  if (booted) return;
  booted = true;
  forgetVisit();
  const controls = renderControls(document.getElementById('controls')!, {
    widget: setup.widget,
    showcase: setup.showcase === true,
    fill: setup.fill,
  });
  installMockBackend({
    widget: setup.widget,
    stream: setup.stream,
    delayMs: setup.delayMs,
    ...(setup.showcase ? { respond: showcaseReply } : {}),
    onRequest: (line) => {
      controls.log(line);
      post({ type: 'hp-pg:event', name: 'request', detail: line });
    },
  });

  // The queue pattern a host page uses: calls before the loader finishes are replayed.
  const api: HelpPuffApi = window.HelpPuff ?? { q: [] };
  for (const name of ['open', 'close', 'toggle', 'send', 'identify', 'reset', 'on', 'off', 'destroy', 'debug']) {
    if (typeof api[name] !== 'function') api[name] = ((...args: unknown[]) => void api.q?.push([name, ...args])) satisfies Method;
  }
  window.HelpPuff = api;
  for (const name of ['open', 'close', 'lead', 'message']) {
    (api['on'] as Method)(name, (detail: unknown) => {
      controls.log(detail === undefined ? name : `${name} ${JSON.stringify(detail)}`);
      post({ type: 'hp-pg:event', name, detail });
    });
  }

  const loader = __HELPPUFF_PLAYGROUND_LOADER__;
  const script = document.createElement('script');
  script.src = loader;
  // The dev server serves the loader's TypeScript source as a module; the build is a classic script.
  if (loader.endsWith('.ts')) script.type = 'module';
  script.async = true;
  script.dataset['site'] = 'playground';
  script.dataset['api'] = MOCK_API;
  if (setup.open) script.dataset['open'] = '';
  if (setup.fill) script.dataset['fill'] = '';
  document.body.appendChild(script);
}

window.addEventListener('message', (event: MessageEvent<ToPreview>) => {
  if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
  const data = event.data;
  if (data.type === 'hp-pg:setup') boot(data.setup);
  if (data.type === 'hp-pg:call') {
    const method = window.HelpPuff?.[data.method];
    if (typeof method === 'function') (method as Method)(...data.args);
  }
});

const fallback: PreviewSetup = { widget: PRESETS[0]!.widget, stream: true, delayMs: 0, open: false, fill: false };

/** A setup from the URL, or null when the URL does not configure one. */
function fromUrl(): PreviewSetup | null {
  const params = new URLSearchParams(location.search);
  const preset = PRESETS.find((p) => p.id === params.get('preset'));
  const raw = params.get('setup');
  if (!preset && !raw) return null;
  let given: Partial<PreviewSetup> = {};
  try {
    if (raw) {
      const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
      given = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as Partial<PreviewSetup>;
    }
  } catch {
    // An unreadable setup falls back to the preset, or the default.
  }
  return {
    ...fallback,
    ...(preset ? { widget: preset.widget } : {}),
    open: params.get('open') === '1',
    fill: params.get('fill') === '1',
    stream: params.get('stream') !== '0',
    showcase: params.get('demo') === 'showcase',
    ...given,
  };
}

const configured = fromUrl();
if (configured) {
  boot(configured);
} else if (embedded) {
  post({ type: 'hp-pg:ready' });
  // Opened outside the playground's frame, or the playground never answered.
  setTimeout(() => boot(fallback), 2000);
} else {
  boot(fallback);
}

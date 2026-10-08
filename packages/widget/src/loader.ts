import { debugEnabled, isSupported, log, setDebug } from './lib/env.js';
import { Disposer } from './lib/safe.js';
import { LOADER_CSS, accentCss, launcherMarkup } from './launcher-shell.js';
import { fetchConfig, launcherHints, type LauncherHints, type RawConfig } from './loader-config.js';

/**
 * The loader. Under 4 kb gzipped, no Preact: it puts a launcher on the
 * page, fetches the config, and pulls in the app on the first sign of intent.
 *
 * It also owns the fail-safe contract. Every path through this file
 * either results in a working widget or in `hide()` — never in an exception
 * reaching the host page, and never in a visible broken element.
 *
 * Commands that arrive before the app exists are queued rather than
 * implemented twice, so this file holds no duplicate of the app's behaviour.
 */

/** Content-hashed filename of the app chunk, injected at build time. */
declare const __HELPPUFF_APP_FILE__: string;
declare const __HELPPUFF_VERSION__: string;

/** Everything on `window.HelpPuff` that the app ultimately handles. */
const METHODS = ['open', 'close', 'toggle', 'send', 'identify', 'reset'] as const;
type Method = (typeof METHODS)[number];

type Call = [Method, ...unknown[]];
type Handler = (payload?: unknown) => void;
type HelpPuffGlobal = Record<string, unknown> & { __loaded?: boolean; q?: unknown[] };

/** What the loader hands to the app when it mounts. */
export type Runtime = {
  host: HTMLElement;
  root: ShadowRoot;
  apiBase: string;
  siteId: string;
  /**
   * The unparsed `widget` object. The app runs the full `parseConfig` on it
   * and calls `hide()` if that fails — the loader read only the handful of
   * fields the launcher needed.
   */
  rawConfig: unknown;
  capabilities: { poll: boolean; end: boolean; stream: boolean; feedback?: boolean; live?: boolean };
  disposer: Disposer;
  version: string;
  /** Tear everything down, silently. */
  hide: (reason: string) => void;
  emit: (event: string, payload?: unknown) => void;
};

export type AppHandle = Record<Method, (...args: never[]) => void> & { state: () => unknown };

const HOST_TAG = 'helppuff-widget';

/**
 * Inline styles on the host element, so no page stylesheet can reach it
 * (inline beats any non-important document rule).
 *
 * The host covers the viewport but is `pointer-events: none`, with only the
 * widget's own surfaces re-enabling them. A zero-sized host with fixed
 * children leaves hit-testing ambiguous — the pixels paint, but the point
 * resolves to a box of no size. Being out of flow, a full-viewport fixed
 * element still contributes nothing to layout, so there is no shift.
 */
const HOST_STYLE =
  'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;';

function version(): string {
  try {
    return __HELPPUFF_VERSION__;
  } catch {
    return '0.0.0';
  }
}

function currentPath(): string {
  try {
    return location.pathname;
  } catch {
    return '/';
  }
}

/** `*` within a segment, `**` across segments. */
function globMatch(pattern: string, path: string): boolean {
  try {
    const source = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      // eslint-disable-next-line no-control-regex -- NUL is the placeholder for `**`
      .replace(/\u0000/g, '.*');
    return new RegExp(`^${source}$`).test(path);
  } catch {
    return false;
  }
}

function applyStyles(root: ShadowRoot, css: string): void {
  try {
    if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in root) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return;
    }
  } catch {
    // Fall through to the element-based path.
  }
  const style = document.createElement('style');
  style.textContent = css;
  root.appendChild(style);
}

/**
 * `document.currentScript` is correct while the script executes; the fallback
 * covers a bundler or tag manager that re-executes the source later.
 */
function findScript(): HTMLScriptElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement) return current;
  return document.querySelector<HTMLScriptElement>('script[data-site][src*="loader"]');
}

function apiBaseFrom(script: HTMLScriptElement | null): string {
  const override = script?.getAttribute('data-api')?.trim();
  if (override) return override.replace(/\/+$/, '');
  try {
    return script?.src ? new URL(script.src).origin : '';
  } catch {
    return '';
  }
}

/**
 * The app chunk sits next to `loader.js` on the server, so it is resolved
 * against the loader's own `src` — not the host document, whose URL has
 * nothing to do with where the widget is hosted.
 */
function appUrlFrom(script: HTMLScriptElement | null): string {
  try {
    if (script?.src) return new URL(__HELPPUFF_APP_FILE__, script.src).href;
  } catch {
    // Fall through.
  }
  return __HELPPUFF_APP_FILE__;
}

/**
 * Leave `window.HelpPuff` callable and inert, so host-page code that calls
 * `HelpPuff.open()` never throws.
 */
function inertGlobal(): void {
  const stub: HelpPuffGlobal = { __loaded: true };
  for (const name of [...METHODS, 'on', 'off', 'destroy']) stub[name] = () => undefined;
  stub['debug'] = () => ({ state: 'hidden', version: version() });
  (window as { HelpPuff?: HelpPuffGlobal }).HelpPuff = stub;
}

/** Fatal before a Loader exists: leave the page exactly as it was. */
function fail(reason: string): void {
  log(`fatal:${reason}`);
  try {
    document.querySelectorAll(HOST_TAG).forEach((node) => node.remove());
    inertGlobal();
  } catch {
    // Nothing further to try.
  }
}

function boot(): void {
  // Guard against the script tag appearing twice.
  if ((window as { HelpPuff?: HelpPuffGlobal }).HelpPuff?.__loaded) return log('already loaded');

  const script = findScript();
  const siteId = script?.getAttribute('data-site')?.trim() ?? '';

  setDebug(debugEnabled());

  if (!siteId) return fail('no_site_id');
  if (!isSupported()) return fail('unsupported_browser');
  if (!document.body) return fail('no_body');

  const apiBase = apiBaseFrom(script);
  if (!apiBase) return fail('no_api_base');

  new Loader(siteId, apiBase, script).start();
}

class Loader {
  private readonly disposer = new Disposer();
  private readonly listeners = new Map<string, Set<Handler>>();
  /** Commands made before the app mounted, replayed in order once it does. */
  private readonly queue: Call[] = [];
  private readonly appUrl: string;

  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private shell: Element | null = null;
  private raw: RawConfig | null = null;
  private hints: LauncherHints | null = null;
  private app: AppHandle | null = null;
  private loading: Promise<void> | null = null;
  private dead = false;

  constructor(
    private readonly siteId: string,
    private readonly apiBase: string,
    private readonly script: HTMLScriptElement | null,
  ) {
    this.appUrl = appUrlFrom(script);
  }

  start(): void {
    this.installGlobal();
    void this.loadConfig();
  }

  // ------------------------------------------------------------ public API

  /**
   * One factory covers every command: forward it to the app, or queue it and
   * start loading. Nothing here can throw into the host page.
   */
  private command(name: Method) {
    return (...args: unknown[]): undefined => {
      try {
        if (this.dead) return;
        if (this.app) (this.app[name] as (...a: unknown[]) => void)(...args);
        else {
          this.queue.push([name, ...args]);
          void this.ensureApp();
        }
      } catch (error) {
        log(`caught:${name}`, error);
      }
      return undefined;
    };
  }

  private installGlobal(): void {
    const previous = (window as { HelpPuff?: HelpPuffGlobal }).HelpPuff;
    const api: HelpPuffGlobal = { __loaded: true };

    for (const name of METHODS) api[name] = this.command(name);

    api['on'] = (event: string, handler: Handler) => {
      if (typeof handler !== 'function') return;
      const set = this.listeners.get(event) ?? new Set<Handler>();
      set.add(handler);
      this.listeners.set(event, set);
    };
    api['off'] = (event: string, handler: Handler) => this.listeners.get(event)?.delete(handler);
    api['destroy'] = () => this.hide('destroy');
    api['debug'] = () => ({
      state: this.app?.state() ?? (this.dead ? 'hidden' : 'loader'),
      config: this.raw?.widget ?? null,
      version: version(),
      siteId: this.siteId,
    });

    (window as { HelpPuff?: HelpPuffGlobal }).HelpPuff = api;

    // Replay calls the site made before the script finished loading.
    const pending = Array.isArray(previous?.q) ? previous.q : [];
    for (const call of pending) {
      if (!Array.isArray(call) || typeof call[0] !== 'string') continue;
      const method = api[call[0]];
      if (typeof method !== 'function') continue;
      try {
        (method as (...a: unknown[]) => unknown)(...call.slice(1));
      } catch {
        // A bad queued call must not stop the rest.
      }
    }
  }

  /** A host page's analytics handler must not be able to break the widget. */
  private emit = (event: string, payload?: unknown): void => {
    for (const handler of this.listeners.get(event) ?? []) {
      try {
        handler(payload);
      } catch (error) {
        log(`caught:handler:${event}`, error);
      }
    }
  };

  // ------------------------------------------------------------ lifecycle

  private async loadConfig(): Promise<void> {
    let result: RawConfig;
    try {
      result = await fetchConfig(this.apiBase, this.siteId);
    } catch (error) {
      // A config that fails, times out or is malformed is fatal.
      log('config_failed', error);
      return this.hide('config_failed');
    }
    if (this.dead) return;

    this.raw = result;
    this.hints = launcherHints(result.widget);
    this.mountShell();
  }

  /**
   * The launcher is rendered only once the config has arrived. Painting it
   * earlier would risk an orb in the wrong colour, or on a path where
   * `hideOnPaths` says it does not belong — and then removing it, which is
   * the visible flash the fail-safe forbids. The launcher is `position: fixed`, so
   * waiting costs no layout shift either way.
   */
  private mountShell(): void {
    const hints = this.hints;
    if (!hints || this.dead) return;

    try {
      const host = document.createElement(HOST_TAG);
      host.setAttribute('style', HOST_STYLE);
      host.setAttribute('data-theme', this.script?.getAttribute('data-theme') ?? hints.theme);
      if (this.script?.hasAttribute('data-fill')) host.setAttribute('data-fill', '');

      const root = host.attachShadow({ mode: 'open' });
      applyStyles(root, LOADER_CSS + accentCss(hints));

      document.body.appendChild(host);
      this.host = host;
      this.root = root;
      this.disposer.add(() => host.remove());

      this.renderLauncher();
      // Host-page API calls can arrive while /config is still in flight.
      // They are already queued; now that the shell exists, start the app
      // immediately so those calls do not wait for the idle-load timer.
      if (this.queue.length > 0) void this.ensureApp();
      this.scheduleIdleLoad();

      if (this.script?.hasAttribute('data-open')) this.command('open')();
    } catch (error) {
      log('mount_failed', error);
      this.hide('shell_mount_failed');
    }
  }

  /** The static launcher, replaced by the app's own once it mounts. */
  private renderLauncher(): void {
    const hints = this.hints;
    if (!this.root || !hints) return;

    // `hideOnPaths` is an exclusion list. Once the app mounts it re-evaluates
    // this on every route change; before then the page cannot have navigated.
    if (hints.hideOnPaths.some((pattern) => globMatch(pattern, currentPath()))) return;

    const shell = document.createElement('div');
    shell.innerHTML = launcherMarkup(hints);
    const button = shell.querySelector('button');

    if (button) {
      // Any of these means the visitor is about to need the app.
      const warm = () => void this.ensureApp();
      this.disposer.listen(button, 'pointerdown', warm);
      this.disposer.listen(button, 'mouseenter', warm);
      this.disposer.listen(button, 'focus', warm);
      this.disposer.listen(button, 'click', this.command('open'));
    }

    this.root.appendChild(shell);
    this.shell = shell;
  }

  /**
   * Load while the page is idle, so the first click is instant.
   *
   * A teaser is drawn by the app, so the chunk has to be in place before its
   * trigger fires — otherwise a 2s teaser would not appear until 6s. Scroll
   * counts as intent too, and is what a scroll-triggered teaser waits on.
   */
  private scheduleIdleLoad(): void {
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const teaserAt = this.hints?.teaserAt;
    const when = teaserAt === null || teaserAt === undefined ? 6000 : Math.min(6000, Math.max(0, teaserAt - 1200));

    this.disposer.timeout(() => {
      if (typeof idle === 'function') idle(() => void this.ensureApp());
      else void this.ensureApp();
    }, when);

    if (this.hints?.teaserOnScroll) {
      const onScroll = () => void this.ensureApp();
      this.disposer.listen(window, 'scroll', onScroll);
    }
  }

  // ------------------------------------------------------------ app handoff

  private ensureApp(): Promise<void> {
    if (this.dead || this.app) return Promise.resolve();
    // Do not cache a no-op promise when an API call arrives before /config.
    // mountShell() retries queued calls as soon as these prerequisites exist.
    if (!this.raw || !this.root || !this.host) return Promise.resolve();
    this.loading ??= this.importApp();
    return this.loading;
  }

  private async importApp(): Promise<void> {
    const raw = this.raw;
    const root = this.root;
    const host = this.host;
    if (!raw || !root || !host) return;

    const runtime: Runtime = {
      host,
      root,
      apiBase: this.apiBase,
      siteId: this.siteId,
      rawConfig: raw.widget,
      capabilities: raw.capabilities,
      disposer: this.disposer,
      version: version(),
      hide: (reason) => this.hide(reason),
      emit: this.emit,
    };

    let handle: AppHandle;
    try {
      // A failed import — offline, CSP, network — is fatal.
      const module = await import(/* @vite-ignore */ this.appUrl);
      const mount = (module as { mount?: (r: Runtime) => AppHandle }).mount;
      if (typeof mount !== 'function') return this.hide('app_missing_mount');
      // A throw during initial mount is fatal too.
      handle = mount(runtime);
    } catch (error) {
      log('app_load_failed', error);
      this.loading = null;
      return this.hide('app_load_failed');
    }

    if (this.dead) return;

    this.app = handle;
    // The app owns the whole shadow root from here.
    this.shell?.remove();
    this.shell = null;

    for (const [name, ...args] of this.queue.splice(0)) {
      try {
        (handle[name] as (...a: unknown[]) => void)(...args);
      } catch (error) {
        log(`caught:replay:${name}`, error);
      }
    }
  }

  /**
   * What "hide" means exactly: the host element goes, every listener
   * and timer goes, `window.HelpPuff` stays callable and inert, nothing is
   * written to the console, localStorage is left untouched so a later page
   * load can still restore, and nothing is retried in this page view.
   */
  private hide(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    log(`fatal:${reason}`);

    try {
      this.app = null;
      this.shell = null;
      this.disposer.dispose();
      this.host?.remove();
      this.host = null;
      this.root = null;
      this.listeners.clear();
      this.queue.length = 0;
    } catch {
      // Teardown is best effort; what matters is the stub below.
    }

    inertGlobal();
  }
}

// The whole entry point is wrapped: a throw here must never reach the page.
try {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        try {
          boot();
        } catch {
          fail('boot_threw');
        }
      },
      { once: true },
    );
  } else {
    boot();
  }
} catch {
  try {
    fail('boot_threw');
  } catch {
    // Give up silently — the page is unaffected either way.
  }
}

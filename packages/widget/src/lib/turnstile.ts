/**
 * Cloudflare Turnstile, for the one request that costs money: starting a
 * session.
 *
 * The server already verifies the token with siteverify and fails closed. This
 * is the missing half — without it the server demands a token the browser
 * never produces, and every session is rejected as `captcha_failed`.
 *
 * Three things shape the implementation:
 *
 * - **`api.js` must load in the host document.** It is a global script that
 *   defines `window.turnstile`; there is no module build. That is the one
 *   thing the widget puts outside its own shadow root, and it is loaded only
 *   when a site actually configures a captcha. The challenge itself renders
 *   into a container *inside* the shadow root, so the host page's layout is
 *   still untouched.
 *
 * - **Tokens are single-use.** Siteverify redeems a token exactly once, so a
 *   retry after a failed start needs a fresh one. Each call here renders,
 *   reads one token, and removes the widget again rather than holding a stale
 *   one.
 *
 * - **It must not be able to hang.** Everything is bounded: script load,
 *   challenge completion, and the interactive case where the visitor simply
 *   never solves it. A caller that never resolves would leave the panel
 *   spinning for ever, which reads as "working" rather than "broken".
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'hp-turnstile';

/** Loading the script. Generous: a cold CDN fetch on a bad connection. */
const LOAD_TIMEOUT_MS = 10_000;

/**
 * Solving the challenge. Long, because "managed" may show an interactive
 * puzzle and a person needs time to do it — but not unbounded, because a
 * visitor who walks away must not leave the panel spinning.
 */
const SOLVE_TIMEOUT_MS = 120_000;

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      callback: (token: string) => void;
      'error-callback': (code?: string) => void;
      'timeout-callback'?: () => void;
      'expired-callback'?: () => void;
      appearance?: 'always' | 'execute' | 'interaction-only';
      theme?: 'light' | 'dark' | 'auto';
      size?: 'normal' | 'flexible' | 'compact';
    },
  ) => string | undefined;
  remove: (widgetId: string) => void;
};

function api(): TurnstileApi | undefined {
  return (globalThis as { turnstile?: TurnstileApi }).turnstile;
}

/** The error a caller sees. `reason` is for logs, never for the visitor. */
export class CaptchaError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super('captcha_unavailable');
    this.name = 'CaptchaError';
    this.reason = reason;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/**
 * Load `api.js` once per page, however many widgets ask for it. The promise is
 * cached on success and cleared on failure, so a transient network error does
 * not poison every later attempt.
 */
function loadScript(doc: Document): Promise<TurnstileApi> {
  const ready = api();
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;

  loading = new Promise<TurnstileApi>((resolve, reject) => {
    let settled = false;
    const finish = (error?: CaptchaError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        loading = null;
        reject(error);
        return;
      }
      const loaded = api();
      if (loaded) resolve(loaded);
      else {
        loading = null;
        reject(new CaptchaError('script_loaded_without_api'));
      }
    };

    const timer = setTimeout(() => finish(new CaptchaError('script_timeout')), LOAD_TIMEOUT_MS);

    // A second widget on the same page, or a host that already uses Turnstile.
    const existing = doc.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? doc.createElement('script');
    script.addEventListener('load', () => finish(), { once: true });
    script.addEventListener('error', () => finish(new CaptchaError('script_error')), { once: true });

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      doc.head.appendChild(script);
    }
  });

  return loading;
}

/**
 * Render a challenge into `mount` and resolve with one fresh token.
 *
 * Rejects with a `CaptchaError` rather than resolving empty: a missing token
 * is not something to paper over, because the server will refuse the session
 * anyway and the visitor deserves the clearer message.
 */
export async function getCaptchaToken(
  siteKey: string,
  mount: HTMLElement,
  options: { action?: string; theme?: 'light' | 'dark' | 'auto' } = {},
): Promise<string> {
  const doc = mount.ownerDocument;
  const turnstile = await loadScript(doc);

  return new Promise<string>((resolve, reject) => {
    let widgetId: string | undefined;
    let settled = false;
    /*
     * Set when the challenge settles before `render` has returned its id —
     * a synchronous callback. Without it the widget would never be removed,
     * because there was nothing to remove it by at the time.
     */
    let removeWhenRendered = false;

    const remove = () => {
      if (widgetId === undefined) {
        removeWhenRendered = true;
        return;
      }
      // Removing rather than resetting: the next attempt renders afresh, so
      // a redeemed token can never be handed out twice.
      try {
        turnstile.remove(widgetId);
      } catch {
        /* already gone */
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      mount.dataset['active'] = 'no';
      remove();
    };

    const succeed = (token: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(token);
    };

    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new CaptchaError(reason));
    };

    const timer = setTimeout(() => fail('solve_timeout'), SOLVE_TIMEOUT_MS);

    try {
      mount.dataset['active'] = 'yes';
      widgetId = turnstile.render(mount, {
        sitekey: siteKey,
        // Verified server-side, so a token minted for another surface on the
        // same site cannot be replayed into starting a conversation.
        action: options.action ?? 'start_session',
        // Only takes up space when a person actually has to do something.
        appearance: 'interaction-only',
        size: 'flexible',
        theme: options.theme ?? 'auto',
        callback: succeed,
        'error-callback': (code) => fail(`error:${code ?? 'unknown'}`),
        'timeout-callback': () => fail('challenge_timeout'),
        'expired-callback': () => fail('expired'),
      });
      if (widgetId === undefined) fail('render_returned_nothing');
      else if (removeWhenRendered) remove();
    } catch (thrown) {
      fail(thrown instanceof Error ? `render_threw:${thrown.name}` : 'render_threw');
    }
  });
}

/** Test seam: forget the cached script promise. */
export function resetTurnstileForTests(): void {
  loading = null;
}

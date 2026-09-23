import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptchaError, getCaptchaToken, resetTurnstileForTests } from '../src/lib/turnstile.js';

/**
 * Covers the widget's half of Turnstile without touching Cloudflare.
 *
 * `.tsx` despite holding no JSX: that extension is what puts a file in the
 * happy-dom project, and this needs a real DOM to mount into.
 *
 *
 * `api.js` itself is not ours to test, and loading it put a CDN round-trip in
 * front of every session — which is exactly why the e2e suite does not enable
 * a captcha. What is ours is everything around it: that a token is produced,
 * that a redeemed widget is torn down so the next attempt is fresh, and that
 * no failure mode can leave the caller waiting for ever.
 */

type RenderOptions = {
  sitekey: string;
  action?: string;
  callback: (token: string) => void;
  'error-callback': (code?: string) => void;
  'timeout-callback'?: () => void;
  'expired-callback'?: () => void;
};

let rendered: RenderOptions[];
let removed: string[];
let mount: HTMLDivElement;

/** Stand in for the script Cloudflare would have injected. */
function installTurnstile(behaviour: (options: RenderOptions, id: string) => void) {
  (globalThis as Record<string, unknown>)['turnstile'] = {
    render: (_container: HTMLElement, options: RenderOptions) => {
      rendered.push(options);
      const id = `w${rendered.length}`;
      behaviour(options, id);
      return id;
    },
    remove: (id: string) => removed.push(id),
  };
}

beforeEach(() => {
  rendered = [];
  removed = [];
  resetTurnstileForTests();
  mount = document.createElement('div');
  document.body.appendChild(mount);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['turnstile'];
  mount.remove();
  vi.useRealTimers();
});

describe('obtaining a token', () => {
  it('resolves with the token Turnstile hands back', async () => {
    installTurnstile((options) => options.callback('token-abc'));
    await expect(getCaptchaToken('site-key', mount)).resolves.toBe('token-abc');
    expect(rendered[0]?.sitekey).toBe('site-key');
  });

  it('sends an action, so a token minted elsewhere cannot be replayed here', async () => {
    installTurnstile((options) => options.callback('t'));
    await getCaptchaToken('site-key', mount);
    expect(rendered[0]?.action).toBe('start_session');
  });

  it('tears the widget down once the token is taken', async () => {
    installTurnstile((options) => options.callback('t'));
    await getCaptchaToken('site-key', mount);
    // Tokens are single-use, so nothing may survive to be handed out twice.
    expect(removed).toEqual(['w1']);
    expect(mount.dataset['active']).toBe('no');
  });

  it('renders afresh for each attempt rather than reusing a redeemed widget', async () => {
    installTurnstile((options) => options.callback('t'));
    await getCaptchaToken('site-key', mount);
    await getCaptchaToken('site-key', mount);
    expect(rendered).toHaveLength(2);
    expect(removed).toEqual(['w1', 'w2']);
  });

  it('marks the mount active only while a challenge is live', async () => {
    let resolveIt: (() => void) | undefined;
    installTurnstile((options) => {
      resolveIt = () => options.callback('t');
    });
    const pending = getCaptchaToken('site-key', mount);
    // The script load is awaited first, so the mount is marked on a later
    // microtask rather than synchronously.
    await Promise.resolve();
    expect(mount.dataset['active']).toBe('yes');
    resolveIt?.();
    await pending;
    expect(mount.dataset['active']).toBe('no');
  });
});

describe('failures', () => {
  it.each([
    ['an error callback', (o: RenderOptions) => o['error-callback']('300030'), 'error:300030'],
    ['a challenge timeout', (o: RenderOptions) => o['timeout-callback']?.(), 'challenge_timeout'],
    ['an expired token', (o: RenderOptions) => o['expired-callback']?.(), 'expired'],
  ])('rejects on %s', async (_label, trigger, reason) => {
    installTurnstile((options) => trigger(options));
    await expect(getCaptchaToken('site-key', mount)).rejects.toSatisfy(
      (error: unknown) => error instanceof CaptchaError && error.reason === reason,
    );
    // Cleaned up even on the failing path, or the next attempt renders twice.
    expect(removed).toEqual(['w1']);
    expect(mount.dataset['active']).toBe('no');
  });

  it('rejects rather than hanging when the visitor never solves it', async () => {
    vi.useFakeTimers();
    installTurnstile(() => {
      /* never calls back */
    });
    const pending = getCaptchaToken('site-key', mount);
    const assertion = expect(pending).rejects.toSatisfy(
      (error: unknown) => error instanceof CaptchaError && error.reason === 'solve_timeout',
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
  });

  it('rejects when render throws', async () => {
    (globalThis as Record<string, unknown>)['turnstile'] = {
      render: () => {
        throw new TypeError('boom');
      },
      remove: () => {},
    };
    await expect(getCaptchaToken('site-key', mount)).rejects.toSatisfy(
      (error: unknown) => error instanceof CaptchaError && error.reason === 'render_threw:TypeError',
    );
  });

  it('rejects when render returns no id', async () => {
    (globalThis as Record<string, unknown>)['turnstile'] = {
      render: () => undefined,
      remove: () => {},
    };
    await expect(getCaptchaToken('site-key', mount)).rejects.toSatisfy(
      (error: unknown) => error instanceof CaptchaError && error.reason === 'render_returned_nothing',
    );
  });

  it('never leaks a reason to the visitor through the message', async () => {
    installTurnstile((options) => options['error-callback']('secret-ish-code'));
    await getCaptchaToken('site-key', mount).catch((error: CaptchaError) => {
      expect(error.message).toBe('captcha_unavailable');
      expect(error.message).not.toContain('secret-ish-code');
    });
  });
});

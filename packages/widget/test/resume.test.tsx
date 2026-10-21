import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../src/app/persist.js';

/**
 * "Continue the chat" from an email (`#hp-resume=<token>`, Customer emails):
 * the loader takes the token out of the address, turns it into the session,
 * and saves it where the app restores chats from. Fail-safe: a bad link
 * leaves the widget starting as usual.
 */

const TOKEN = 'eyJzIjoiZGVtbyIsImMiOiJjb252LTEifQ.c2lnbmF0dXJlc2lnbmF0dXJl';

function page(hash: string) {
  history.replaceState(null, '', `/hot-water${hash}`);
  document.body.innerHTML = '';
  const script = document.createElement('script');
  script.setAttribute('data-site', 'demo');
  script.src = 'https://chat.example.com/loader.js';
  document.body.appendChild(script);
}

async function boot() {
  vi.resetModules();
  (globalThis as { __HELPPUFF_APP_FILE__?: string }).__HELPPUFF_APP_FILE__ = 'app-test.js';
  (globalThis as { __HELPPUFF_VERSION__?: string }).__HELPPUFF_VERSION__ = '0.0.0';
  delete (window as { HelpPuff?: unknown }).HelpPuff;
  await import('../src/loader.js');
  await vi.waitFor(() => expect(document.querySelector('helppuff-widget')).not.toBeNull());
}

const config = () => Response.json({ widget: { brand: { name: 'Acme' } }, capabilities: { poll: false, end: false } });

let calls: { url: string; body: string | null }[] = [];
beforeEach(() => {
  calls = [];
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('continue the chat', () => {
  it('turns the link into the conversation the app restores, and takes it out of the address', async () => {
    page(`#hp-resume=${TOKEN}`);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
      if (url.includes('/sessions/resume')) {
        return Response.json({ sessionToken: 'session.token', sessionId: 'conv-1', expiresAt: Date.now() + 3600_000, messages: [{ id: 'm1', ts: 1, role: 'user', type: 'text', text: 'Tomorrow?' }], capabilities: {} });
      }
      return config();
    });
    await boot();
    await vi.waitFor(() => expect(localStorage.getItem('hp:demo')).not.toBeNull());
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/hot-water');
    const resume = calls.find((c) => c.url === 'https://chat.example.com/v1/sites/demo/sessions/resume')!;
    expect(JSON.parse(resume.body!)).toEqual({ token: TOKEN });
    // Exactly what the app reads back: the session and the thread.
    const restored = load('demo');
    expect(restored?.session?.id).toBe('conv-1');
    expect(restored?.messages?.map((m) => ('text' in m ? m.text : null))).toEqual(['Tomorrow?']);
    // It opened the chat at once: the app was asked for (there is none in this test, so the loader hides, leaving the chat saved).
    await vi.waitFor(() => expect((window as unknown as { HelpPuff: { debug: () => { state: string } } }).HelpPuff.debug().state).toBe('hidden'));
    expect(localStorage.getItem('hp:demo')).not.toBeNull();
  });

  it('ignores a link the server refuses: the widget starts as usual', async () => {
    page(`#section&hp-resume=${TOKEN}`);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (String(input).includes('/sessions/resume') ? Response.json({ error: { code: 'unauthorized' } }, { status: 401 }) : config()));
    await boot();
    expect(localStorage.getItem('hp:demo')).toBeNull();
    // The page's own anchor stays.
    expect(location.hash).toBe('#section');
    expect(document.querySelector('helppuff-widget')).not.toBeNull();
  });

  it('asks for nothing without a link', async () => {
    page('');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls.push({ url: String(input), body: null });
      return config();
    });
    await boot();
    expect(calls.some((c) => c.url.includes('resume'))).toBe(false);
  });
});

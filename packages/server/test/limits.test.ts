import { describe, expect, it, vi } from 'vitest';
import { TOKEN_HEADER, errorEnvelopeSchema } from '@murmur/protocol';
import { memoryKv } from '../src/core/platform.js';
import { dailyKey, hitDaily, hitTotal, hitWindow, sessionMessageKey } from '../src/core/ratelimit.js';
import { verifyTurnstile } from '../src/core/turnstile.js';
import { ORIGIN, harness, startBody, startSession, testConfig, testEnv } from './helpers.js';

async function envelope(response: Response) {
  const parsed = errorEnvelopeSchema.safeParse(await response.json());
  return parsed.success ? parsed.data.error : null;
}

describe('hitWindow', () => {
  it('allows exactly the limit, then refuses with a retry hint', async () => {
    const kv = memoryKv();
    for (let i = 0; i < 3; i += 1) {
      expect((await hitWindow(kv, 's', 'ip', 3, 60)).allowed, `call ${i}`).toBe(true);
    }
    const blocked = await hitWindow(kv, 's', 'ip', 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(60);
  });

  it('counts each key separately', async () => {
    const kv = memoryKv();
    await hitWindow(kv, 's', 'a', 1, 60);
    expect((await hitWindow(kv, 's', 'b', 1, 60)).allowed).toBe(true);
    expect((await hitWindow(kv, 's', 'a', 1, 60)).allowed).toBe(false);
  });

  it('counts each scope separately', async () => {
    const kv = memoryKv();
    await hitWindow(kv, 'msg', 'ip', 1, 60);
    expect((await hitWindow(kv, 'sess', 'ip', 1, 60)).allowed).toBe(true);
  });

  it('starts fresh in the next window', async () => {
    const kv = memoryKv();
    const now = 1_700_000_000_000;
    await hitWindow(kv, 's', 'ip', 1, 60, now);
    expect((await hitWindow(kv, 's', 'ip', 1, 60, now)).allowed).toBe(false);
    expect((await hitWindow(kv, 's', 'ip', 1, 60, now + 60_000)).allowed).toBe(true);
  });

  it('degrades open when KV is unavailable, since it bounds abuse and never bills', async () => {
    const broken = { get: async () => null, put: async () => {}, delete: async () => {} };
    for (let i = 0; i < 5; i += 1) {
      expect((await hitWindow(broken, 's', 'ip', 1, 60)).allowed).toBe(true);
    }
  });
});

describe('hitTotal', () => {
  it('counts without a window', async () => {
    const kv = memoryKv();
    expect((await hitTotal(kv, 'k', 2, 3600)).count).toBe(1);
    expect((await hitTotal(kv, 'k', 2, 3600)).count).toBe(2);
    expect((await hitTotal(kv, 'k', 2, 3600)).allowed).toBe(false);
  });
});

describe('hitDaily', () => {
  it('keys by UTC day and rolls over at midnight', async () => {
    const kv = memoryKv();
    const day = Date.UTC(2026, 0, 15, 23, 0, 0);
    expect(dailyKey('site', day)).toBe('quota:site:2026-01-15');

    await hitDaily(kv, 'site', 1, day);
    const blocked = await hitDaily(kv, 'site', 1, day);
    expect(blocked.allowed).toBe(false);
    // An hour to midnight UTC.
    expect(blocked.retryAfter).toBeCloseTo(3600, -2);

    expect((await hitDaily(kv, 'site', 1, day + 2 * 3600_000)).allowed).toBe(true);
  });
});

describe('the session cap cannot be rewound by replaying a token', () => {
  /**
   * This is the hole the KV counter closes. `count` used to be read from the
   * session token, and the client picks which token it sends — so replaying
   * the original one reset the count on every request and the cap never
   * tripped.
   */
  it('counts server-side, so an old token does not reset the count', async () => {
    const config = testConfig({
      origins: [ORIGIN],
      connector: { type: 'echo' },
      security: { limits: { messagesPerSession: 3 } },
    });
    const h = harness(config);
    const { sessionToken: original } = await startSession(h);

    const send = (token: string) =>
      h.post('/v1/sessions/messages', { kind: 'text', text: 'hi', clientId: 'c' }, {
        headers: { Authorization: `Bearer ${token}` },
      });

    // Always replay the very first token, never the refreshed one.
    for (let i = 0; i < 3; i += 1) {
      expect((await send(original)).status, `message ${i + 1}`).toBe(200);
    }

    const blocked = await send(original);
    expect(blocked.status).toBe(429);
    expect((await envelope(blocked))?.code).toBe('quota_exceeded');
  });

  it('still counts normally when the refreshed token is used', async () => {
    const config = testConfig({
      origins: [ORIGIN],
      connector: { type: 'echo' },
      security: { limits: { messagesPerSession: 2 } },
    });
    const h = harness(config);
    let token = (await startSession(h)).sessionToken;

    for (let i = 0; i < 2; i += 1) {
      const response = await h.post('/v1/sessions/messages', { kind: 'text', text: 'hi', clientId: 'c' }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      token = response.headers.get(TOKEN_HEADER) ?? token;
    }

    const blocked = await h.post('/v1/sessions/messages', { kind: 'text', text: 'hi', clientId: 'c' }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(blocked.status).toBe(429);
  });
});

describe('rate limits on the routes', () => {
  it('bounds sessions per IP per hour', async () => {
    const config = testConfig({
      origins: [ORIGIN],
      connector: { type: 'echo' },
      security: { limits: { sessionsPerIpPerHour: 2 } },
    });
    const h = harness(config, testEnv());

    expect((await h.post('/v1/sites/demo/sessions', startBody)).status).toBe(200);
    expect((await h.post('/v1/sites/demo/sessions', startBody)).status).toBe(200);

    const blocked = await h.post('/v1/sites/demo/sessions', startBody);
    expect(blocked.status).toBe(429);
    const error = await envelope(blocked);
    expect(error?.code).toBe('rate_limited');
    expect(error?.retryAfter).toBeGreaterThan(0);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  it('bounds messages per IP per minute', async () => {
    const config = testConfig({
      origins: [ORIGIN],
      connector: { type: 'echo' },
      security: { limits: { messagesPerIpPerMinute: 2 } },
    });
    const h = harness(config);
    const { sessionToken } = await startSession(h);
    const send = () =>
      h.post('/v1/sessions/messages', { kind: 'text', text: 'hi', clientId: 'c' }, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  it('the daily site quota is the backstop, and stops new sessions too', async () => {
    const config = testConfig({
      origins: [ORIGIN],
      connector: { type: 'echo' },
      security: { limits: { messagesPerSitePerDay: 1 } },
    });
    const h = harness(config);

    expect((await h.post('/v1/sites/demo/sessions', startBody)).status).toBe(200);

    const blocked = await h.post('/v1/sites/demo/sessions', startBody);
    expect(blocked.status).toBe(429);
    const error = await envelope(blocked);
    expect(error?.code).toBe('quota_exceeded');
    // The widget shows the fallback contact for this code (§8.7).
    expect(error?.message).not.toMatch(/quota|limit/i);
  });

  it('one site hitting its limit does not starve another', async () => {
    const { defineConfig } = await import('../src/config/load.js');
    const site = {
      origins: [ORIGIN],
      connector: { type: 'echo' },
      security: { limits: { sessionsPerIpPerHour: 1 } },
      widget: { leadForm: { enabled: false } },
    };
    const h = harness(defineConfig({ sites: { a: { ...site }, b: { ...site } } }));

    expect((await h.post('/v1/sites/a/sessions', startBody)).status).toBe(200);
    expect((await h.post('/v1/sites/a/sessions', startBody)).status).toBe(429);
    // Same visitor, same IP, different site — its own budget.
    expect((await h.post('/v1/sites/b/sessions', startBody)).status).toBe(200);
  });
});

describe('Turnstile', () => {
  const ok = () => new Response(JSON.stringify({ success: true }), { status: 200 });
  const bad = (codes: string[]) =>
    new Response(JSON.stringify({ success: false, 'error-codes': codes }), { status: 200 });

  it('passes a token Cloudflare accepts', async () => {
    const doFetch = vi.fn(async () => ok()) as unknown as typeof fetch;
    expect(await verifyTurnstile('secret', 'token', { fetch: doFetch })).toEqual({ success: true, codes: [] });
  });

  it('sends the secret, the token and the IP', async () => {
    const doFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(body.get('secret')).toBe('secret');
      expect(body.get('response')).toBe('token');
      expect(body.get('remoteip')).toBe('203.0.113.9');
      return ok();
    }) as unknown as typeof fetch;
    await verifyTurnstile('secret', 'token', { ip: '203.0.113.9', fetch: doFetch });
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it('fails a rejected token and reports the codes', async () => {
    const doFetch = vi.fn(async () => bad(['invalid-input-response'])) as unknown as typeof fetch;
    expect(await verifyTurnstile('s', 't', { fetch: doFetch })).toEqual({
      success: false,
      codes: ['invalid-input-response'],
    });
  });

  it('fails a missing token without a round trip', async () => {
    const doFetch = vi.fn() as unknown as typeof fetch;
    expect(await verifyTurnstile('s', undefined, { fetch: doFetch })).toMatchObject({ success: false });
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('treats an unreachable Cloudflare as a failure, not a pass', async () => {
    const doFetch = vi.fn(async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    // Otherwise taking siteverify offline would take the captcha offline.
    expect(await verifyTurnstile('s', 't', { fetch: doFetch })).toEqual({
      success: false,
      codes: ['verification-unreachable'],
    });
  });

  it('treats a non-200 as a failure', async () => {
    const doFetch = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    expect((await verifyTurnstile('s', 't', { fetch: doFetch })).success).toBe(false);
  });
});

describe('the session key', () => {
  it('is namespaced per session', () => {
    expect(sessionMessageKey('abc')).toBe('msg:abc');
  });
});

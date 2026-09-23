import { describe, expect, it, vi } from 'vitest';
import webhookSink from '@murmur/sink-webhook';
import { signBody, type LeadEvent, type SinkContext } from '@murmur/sink-types';
import { ORIGIN, harness, startBody, testConfig, testEnv } from './helpers.js';

const event: LeadEvent = {
  siteId: 'demo',
  sessionId: 'sid-1',
  lead: { name: 'Ada', phone: '0400 000 000' },
  context: { pageUrl: 'https://example.com/pricing', pageTitle: 'Pricing' },
  firstMessage: 'I need a quote',
  at: 1_700_000_000_000,
};

function ctx(options: unknown, doFetch: typeof fetch): SinkContext<unknown> {
  return {
    options: webhookSink.parseOptions(options),
    siteId: 'demo',
    fetch: doFetch,
    log: () => {},
  };
}

const ok = () => new Response('', { status: 200 });

describe('the webhook sink', () => {
  it('posts the lead, the context and the first message as JSON', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const doFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return ok();
    }) as unknown as typeof fetch;

    await webhookSink.onLead(ctx({ url: 'https://hook.example/lead' }, doFetch), event);

    expect(seen!.url).toBe('https://hook.example/lead');
    expect(seen!.init.method).toBe('POST');
    expect((seen!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(seen!.init.body as string);
    expect(body).toMatchObject({
      siteId: 'demo',
      sessionId: 'sid-1',
      lead: { name: 'Ada', phone: '0400 000 000' },
      context: { pageUrl: 'https://example.com/pricing' },
      firstMessage: 'I need a quote',
    });
    expect(body.at).toBe('2023-11-14T22:13:20.000Z');
  });

  it('sends configured headers, for a receiver that wants an API key', async () => {
    let headers: Record<string, string> = {};
    const doFetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return ok();
    }) as unknown as typeof fetch;

    await webhookSink.onLead(
      ctx({ url: 'https://hook.example', headers: { 'X-Api-Key': 'abc123' } }, doFetch),
      event,
    );
    expect(headers['X-Api-Key']).toBe('abc123');
  });

  it('signs the body so a receiver can verify the sender', async () => {
    let headers: Record<string, string> = {};
    let body = '';
    const doFetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      body = init.body as string;
      return ok();
    }) as unknown as typeof fetch;

    await webhookSink.onLead(
      ctx({ url: 'https://hook.example', signingSecret: 'shhh' }, doFetch),
      event,
    );

    const signature = headers['X-Murmur-Signature'];
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signature).toBe(await signBody('shhh', body));
  });

  it('is unsigned when no secret is configured', async () => {
    let headers: Record<string, string> = {};
    const doFetch = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return ok();
    }) as unknown as typeof fetch;
    await webhookSink.onLead(ctx({ url: 'https://hook.example' }, doFetch), event);
    expect(headers['X-Murmur-Signature']).toBeUndefined();
  });

  it('swallows a non-2xx rather than throwing at the visitor', async () => {
    const doFetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(webhookSink.onLead(ctx({ url: 'https://hook.example' }, doFetch), event)).resolves
      .toBeUndefined();
  });

  it('swallows a network failure', async () => {
    const doFetch = (async () => {
      throw new TypeError('unreachable');
    }) as unknown as typeof fetch;
    await expect(webhookSink.onLead(ctx({ url: 'https://hook.example' }, doFetch), event)).resolves
      .toBeUndefined();
  });

  it('gives up rather than hanging on a receiver that never answers', async () => {
    vi.useFakeTimers();
    try {
      const doFetch = ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })) as unknown as typeof fetch;

      const promise = webhookSink.onLead(ctx({ url: 'https://hook.example', timeoutMs: 2000 }, doFetch), event);
      await vi.advanceTimersByTimeAsync(2500);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects options it cannot use', () => {
    expect(() => webhookSink.parseOptions({})).toThrow();
    expect(() => webhookSink.parseOptions({ url: '' })).toThrow();
    expect(() => webhookSink.parseOptions({ url: 'https://a.co', timeoutMs: 1 })).toThrow();
  });
});

describe('leads reaching a sink from a real session', () => {
  it('fires after the session starts, without blocking the response', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return ok();
    }) as unknown as typeof fetch;

    try {
      const config = testConfig({
        origins: [ORIGIN],
        connector: { type: 'echo' },
        sinks: [{ type: 'webhook', options: { url: 'https://hook.example/lead' } }],
      });

      // The harness runs waitUntil work inline, so awaiting the response is
      // enough to observe the dispatch.
      const pending: Promise<unknown>[] = [];
      const h = harness(config, testEnv(), ORIGIN, (p) => pending.push(p));

      const response = await h.post('/v1/sites/demo/sessions', startBody);
      expect(response.status).toBe(200);

      await Promise.all(pending);
      expect(calls).toContain('https://hook.example/lead');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('a broken sink config never reaches the visitor', async () => {
    const config = testConfig({
      origins: [ORIGIN],
      connector: { type: 'echo' },
      // No such sink type, and a secret that does not resolve.
      sinks: [{ type: 'nope', options: {} }, { type: 'webhook', options: { url: { env: 'MISSING' } } }],
    });
    const pending: Promise<unknown>[] = [];
    const h = harness(config, testEnv(), ORIGIN, (p) => pending.push(p));

    const response = await h.post('/v1/sites/demo/sessions', startBody);
    expect(response.status).toBe(200);
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });
});

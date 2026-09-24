import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, startSessionResponseSchema, configResponseSchema, TOKEN_HEADER } from '@murmur/protocol';
import { FALLBACK_NOTICE_TEXT } from '../src/core/sanitize.js';
import { ORIGIN, harness, startBody, startSession, testConfig, testEnv } from './helpers.js';

async function envelope(response: Response) {
  const body = await response.json();
  const parsed = errorEnvelopeSchema.safeParse(body);
  expect(parsed.success, `not an error envelope: ${JSON.stringify(body)}`).toBe(true);
  return parsed.success ? parsed.data.error : null;
}

describe('GET /v1/sites/:siteId/config', () => {
  it('serves a valid config response', async () => {
    const response = await harness().fetch('/v1/sites/demo/config');
    expect(response.status).toBe(200);
    const parsed = configResponseSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBe('demo');
      expect(parsed.data.capabilities).toEqual({ poll: false, end: true, stream: false });
    }
  });

  it('is cacheable at the edge', async () => {
    const response = await harness().fetch('/v1/sites/demo/config');
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=300');
  });

  it('404s an unknown site with an envelope, not HTML', async () => {
    const response = await harness().fetch('/v1/sites/nope/config');
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect((await envelope(response))?.code).toBe('not_found');
  });
});

describe('POST /v1/sites/:siteId/sessions', () => {
  it('starts a session and returns the greeting', async () => {
    const { response, messages, sessionToken } = await startSession(harness());
    expect(response.status).toBe(200);
    expect(sessionToken).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(messages[0]).toMatchObject({ type: 'text', text: 'Hello from echo' });
  });

  it('returns a response the protocol schema accepts', async () => {
    const response = await harness().post('/v1/sites/demo/sessions', startBody);
    expect(startSessionResponseSchema.safeParse(await response.json()).success).toBe(true);
  });

  it('answers firstMessage in the same call', async () => {
    const { messages } = await startSession(harness(), { ...startBody, firstMessage: '/options' });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ type: 'options' });
  });

  it.each([
    ['a disallowed origin', 'https://evil.example'],
    ['no origin at all', null],
  ])('rejects %s', async (_name, origin) => {
    const h = harness(testConfig(), testEnv(), null);
    const response = await h.post('/v1/sites/demo/sessions', startBody, {
      headers: origin ? { Origin: origin } : {},
    });
    expect(response.status).toBe(403);
    expect((await envelope(response))?.code).toBe('forbidden_origin');
  });

  it('accepts an allowlisted origin regardless of case and trailing slash', async () => {
    const h = harness(testConfig(), testEnv(), null);
    const response = await h.post('/v1/sites/demo/sessions', startBody, {
      headers: { Origin: 'HTTPS://Example.com' },
    });
    expect(response.status).toBe(200);
  });

  it('rejects a missing required lead field', async () => {
    const response = await harness().post('/v1/sites/demo/sessions', {
      ...startBody,
      lead: { email: 'ada@example.com' },
    });
    expect(response.status).toBe(400);
    const error = await envelope(response);
    expect(error?.code).toBe('bad_request');
    expect(error?.message).toContain('Name');
  });

  it('rejects an invalid email', async () => {
    const response = await harness().post('/v1/sites/demo/sessions', {
      ...startBody,
      lead: { name: 'Ada', email: 'not-an-email' },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a body that is not valid JSON', async () => {
    const h = harness();
    const response = await h.fetch('/v1/sites/demo/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    expect(response.status).toBe(400);
    expect((await envelope(response))?.code).toBe('bad_request');
  });

  it('rejects a body missing the required context', async () => {
    const response = await harness().post('/v1/sites/demo/sessions', { lead: { name: 'Ada' } });
    expect(response.status).toBe(400);
  });

  it('never caches a session response', async () => {
    const { response } = await startSession(harness());
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns internal, not a crash, when MURMUR_SECRET is missing', async () => {
    const h = harness(testConfig(), testEnv({ MURMUR_SECRET: undefined }));
    const response = await h.post('/v1/sites/demo/sessions', startBody);
    expect(response.status).toBe(500);
    expect((await envelope(response))?.code).toBe('internal');
  });
});

describe('POST /v1/sessions/messages', () => {
  async function session() {
    const h = harness();
    const { sessionToken } = await startSession(h);
    const send = (body: unknown, token = sessionToken) =>
      h.post('/v1/sessions/messages', body, { headers: { Authorization: `Bearer ${token}` } });
    return { h, sessionToken, send };
  }

  it('exchanges a message with echo', async () => {
    const { send } = await session();
    const response = await send({ kind: 'text', text: 'hello', clientId: 'c1' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { messages: Array<{ text?: string }> };
    expect(body.messages[0]?.text).toBe('You said: **hello**');
  });

  it('issues a refreshed token on every reply', async () => {
    const { send, sessionToken } = await session();
    const response = await send({ kind: 'text', text: 'hello', clientId: 'c1' });
    const refreshed = response.headers.get(TOKEN_HEADER);
    expect(refreshed).toBeTruthy();
    expect(refreshed).not.toBe(sessionToken);
  });

  it('exposes the token header to the browser', async () => {
    const { send } = await session();
    const response = await send({ kind: 'text', text: 'hi', clientId: 'c1' });
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain(TOKEN_HEADER);
  });

  it('accepts an action input', async () => {
    const { send } = await session();
    const response = await send({
      kind: 'action', actionId: 'a1', value: 'quote', label: 'Get a quote', clientId: 'c1',
    });
    const body = (await response.json()) as { messages: Array<{ text?: string }> };
    expect(body.messages[0]?.text).toContain('Get a quote');
  });

  it.each([
    ['no Authorization header', undefined],
    ['a token that is not ours', 'Bearer aaaa.bbbb'],
    ['an empty bearer token', 'Bearer '],
    ['a non-bearer scheme', 'Basic abc'],
  ])('rejects %s', async (_name, authorization) => {
    const h = harness();
    const response = await h.post('/v1/sessions/messages', { kind: 'text', text: 'hi', clientId: 'c1' }, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    expect(response.status).toBe(401);
    expect((await envelope(response))?.code).toBe('unauthorized');
  });

  it('rejects a valid token sent from a disallowed origin', async () => {
    const h = harness();
    const { sessionToken } = await startSession(h);
    const response = await h.post('/v1/sessions/messages', { kind: 'text', text: 'hi', clientId: 'c1' }, {
      headers: { Authorization: `Bearer ${sessionToken}`, Origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
  });

  it('rejects a message over the configured length', async () => {
    const { send } = await session();
    const response = await send({ kind: 'text', text: 'x'.repeat(1001), clientId: 'c1' });
    expect(response.status).toBe(400);
    // The internal `detail` is for logs only and must not reach the visitor.
    expect(Object.keys((await response.json() as { error: object }).error)).toEqual(['code', 'message']);
  });

  it('enforces the per-session message cap', async () => {
    const config = testConfig({
      origins: [ORIGIN],
      connector: { type: 'echo' },
      security: { limits: { messagesPerSession: 2 } },
    });
    const h = harness(config);
    let token = (await startSession(h)).sessionToken;

    for (let i = 0; i < 2; i += 1) {
      const response = await h.post('/v1/sessions/messages', { kind: 'text', text: 'hi', clientId: `c${i}` }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      token = response.headers.get(TOKEN_HEADER) ?? token;
    }

    const blocked = await h.post('/v1/sessions/messages', { kind: 'text', text: 'hi', clientId: 'c3' }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(blocked.status).toBe(429);
    expect((await envelope(blocked))?.code).toBe('quota_exceeded');
  });

  it('turns a connector error into a safe envelope with no backend detail', async () => {
    const { send } = await session();
    const response = await send({ kind: 'text', text: '/error', clientId: 'c1' });
    expect(response.status).toBe(502);
    const error = await envelope(response);
    expect(error?.code).toBe('connector_error');
    expect(error?.message).not.toContain('echo_forced_error');
  });

  it('rejects polling on a connector that does not support it', async () => {
    const h = harness();
    const { sessionToken } = await startSession(h);
    const response = await h.fetch('/v1/sessions/messages', {
      headers: { Authorization: `Bearer ${sessionToken}`, Origin: ORIGIN },
    });
    expect(response.status).toBe(400);
  });

  it('ends a session with 204 and no body', async () => {
    const h = harness();
    const { sessionToken } = await startSession(h);
    const response = await h.post('/v1/sessions/end', {}, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(response.status).toBe(204);
  });
});

describe('CORS and transport', () => {
  it('answers a preflight for an allowlisted origin', async () => {
    const response = await harness().fetch('/v1/sessions/messages', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
  });

  it('does not reflect an origin that is not allowlisted', async () => {
    const response = await harness().fetch('/v1/sessions/messages', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('returns an envelope for an unknown route', async () => {
    const response = await harness().fetch('/v1/nope');
    expect(response.status).toBe(404);
    expect((await envelope(response))?.code).toBe('not_found');
  });

  it('answers the health check', async () => {
    const response = await harness().fetch('/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, protocol: 'v1' });
  });
});

describe('connector output sanitizing', () => {
  it('replaces an all-invalid batch with one friendly notice', async () => {
    const { sanitizeConnectorMessages } = await import('../src/core/sanitize.js');
    const log = () => {};
    const messages = sanitizeConnectorMessages([{ type: 'video' }, null], { log, now: () => 1 });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'notice', text: FALLBACK_NOTICE_TEXT });
  });

  it('keeps the valid messages from a mixed batch', async () => {
    const { sanitizeConnectorMessages } = await import('../src/core/sanitize.js');
    const good = { id: 'm1', ts: 1, role: 'agent', type: 'text', text: 'ok' };
    const messages = sanitizeConnectorMessages([good, { type: 'video' }], { log: () => {}, now: () => 1 });
    expect(messages).toEqual([good]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { identitySecret, MAX_TOKEN_AGE_S, signIdentity, verifyIdentity } from '../src/core/identity.js';
import { forgetTools } from '../src/tools/store.js';
import { say, world } from './inbox-helpers.js';
import { harness, SECRET, testConfig } from './helpers.js';

/**
 * Signed-in visitors: a token the site's server signed makes the visitor's
 * claims verified (`{{user.*}}`, the lead's email); anything else is ignored,
 * and tools that need a verified user never run without one.
 */

type Json = Record<string, any>;
const json = async (response: Response) => (await response.json()) as Json;
const now = () => Math.floor(Date.now() / 1000);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checking a signed identity', () => {
  it('accepts a good token and keeps its claims; refuses anything forged, unsigned, expired or too long-lived', async () => {
    const secret = await identitySecret(SECRET, 'demo', 1);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(await identitySecret(SECRET, 'demo', 2)).not.toBe(secret);
    const good = await signIdentity({ sub: 'u_1', email: 'ada@acme.test', name: 'Ada', plan: 'pro', seats: 5, exp: now() + 3600 }, secret);
    expect(await verifyIdentity(good, secret, Date.now())).toEqual({ user: { id: 'u_1', email: 'ada@acme.test', name: 'Ada', plan: 'pro', seats: '5' } });

    expect(await verifyIdentity(good, await identitySecret(SECRET, 'other', 1), Date.now())).toEqual({ problem: 'signature' });
    const [head, body] = good.split('.');
    const none = `${btoa(JSON.stringify({ alg: 'none' })).replace(/=+$/, '')}.${body}.`;
    expect(await verifyIdentity(none, secret, Date.now())).toEqual({ problem: 'malformed' });
    const tampered = `${head}.${btoa(JSON.stringify({ sub: 'admin', exp: now() + 3600 })).replace(/=+$/, '')}.${good.split('.')[2]}`;
    expect(await verifyIdentity(tampered, secret, Date.now())).toEqual({ problem: 'signature' });
    expect(await verifyIdentity(await signIdentity({ sub: 'u_1', exp: now() - 1 }, secret), secret, Date.now())).toEqual({ problem: 'expired' });
    expect(await verifyIdentity(await signIdentity({ sub: 'u_1' }, secret), secret, Date.now())).toEqual({ problem: 'expired' });
    expect(await verifyIdentity(await signIdentity({ sub: 'u_1', exp: now() + MAX_TOKEN_AGE_S + 120 }, secret), secret, Date.now())).toEqual({ problem: 'too_long' });
    expect(await verifyIdentity(await signIdentity({ email: 'x@y.z', exp: now() + 60 }, secret), secret, Date.now())).toEqual({ problem: 'no_subject' });
  });
});

const assistant = {
  connector: {
    type: 'assistant',
    options: {
      provider: { type: 'openai-compatible', baseUrl: 'https://llm.test/v1', apiKey: 'k' },
      model: 'fake',
      knowledge: { type: 'none' },
      stream: false,
      instructions: 'You help Acme. The visitor is {{user.name}} on the {{account.plan}} plan. To change their plan, use {{change_plan}}.',
    },
  },
  widget: { leadForm: { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text' }, { name: 'email', label: 'Email', type: 'email' }] } },
} as never;

/** The model (it calls change_plan when asked) and the site's API, which records what it was asked. */
function fakeInternet() {
  const calls: { url: string; body: string }[] = [];
  const prompts: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? '') });
    if (url === 'https://llm.test/v1/chat/completions') {
      const request = JSON.parse(String(init?.body)) as Json;
      prompts.push(String(request['messages'][0].content));
      const last = (request['messages'] as Json[]).at(-1)!;
      if (last['role'] === 'tool') return Response.json({ choices: [{ message: { content: `Tool said: ${String(last['content'])}` } }] });
      if (/plan/.test(String(last['content']))) {
        return Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'change_plan', arguments: '{"plan":"team"}' } }] } }] });
      }
      return Response.json({ choices: [{ message: { content: 'Hello!' } }] });
    }
    if (url.startsWith('https://app.acme.test/accounts/')) return Response.json({ plan: 'pro', seats: 5 });
    if (url.startsWith('https://app.acme.test/plan')) return Response.json({ changed: true });
    return new Response('not found', { status: 404 });
  });
  return { calls, prompts };
}

async function setUp() {
  const w = await world(assistant);
  for (const tool of [
    { name: 'account', description: 'The signed-in visitor’s account.', url: 'https://app.acme.test/accounts/{{user.id}}', before: true },
    { name: 'change_plan', description: 'Change the visitor’s plan.', method: 'POST', url: 'https://app.acme.test/plan', body: '{"user": "{{user.id}}", "plan": "{{args.plan}}"}', parameters: [{ name: 'plan', description: 'The new plan.' }] },
  ]) {
    expect((await w.owner.send('POST', '/tools', tool)).status).toBe(201);
  }
  forgetTools('demo');
  const { secret } = await json(await w.owner.get('/identity'));
  return { w, secret: secret as string };
}

describe('signed-in visitors in a chat', () => {
  it('verifies the token: the claims win over what was typed, and tools for signed-in visitors run', async () => {
    const { w, secret } = await setUp();
    const net = fakeInternet();
    const identity = await signIdentity({ sub: 'u_1', email: 'ada@acme.test', name: 'Ada', exp: now() + 3600 }, secret);
    const started = await w.h.post('/v1/sites/demo/sessions', { lead: { name: 'Mallory', email: 'mallory@evil.test' }, identity, context: { pageUrl: 'https://acme.test/app' }, firstMessage: 'Hi' });
    expect(started.status).toBe(200);
    const { sessionId, sessionToken } = await json(started);
    expect(net.calls.some((c) => c.url === 'https://app.acme.test/accounts/u_1')).toBe(true);
    expect(net.prompts[0]).toContain('The visitor is "Ada" on the "pro" plan');

    const reply = await json(await say(w.h, sessionToken, { kind: 'text', text: 'Move me to the team plan' }));
    expect(reply['messages'][0].text).toContain('changed');
    expect(JSON.parse(net.calls.find((c) => c.url === 'https://app.acme.test/plan')!.body)).toEqual({ user: 'u_1', plan: 'team' });
    await w.settle();

    const detail = await json(await w.owner.get(`/conversations/${sessionId}`));
    expect(detail['conversation']['user']).toEqual({ id: 'u_1', email: 'ada@acme.test', name: 'Ada' });
    expect(detail['lead']).toMatchObject({ email: 'ada@acme.test', name: 'Ada' });
  });

  it('ignores a forged or stale token: no user, and tools for signed-in visitors never run', async () => {
    const { w, secret } = await setUp();
    const net = fakeInternet();
    const forged = await signIdentity({ sub: 'u_1', exp: now() + 3600 }, 'not-the-secret');
    const started = await w.h.post('/v1/sites/demo/sessions', { lead: { name: 'Mallory' }, identity: forged, context: { pageUrl: 'https://acme.test/' }, firstMessage: 'Hi' });
    expect(started.status).toBe(200);
    const { sessionId, sessionToken } = await json(started);
    expect(net.calls.some((c) => c.url.startsWith('https://app.acme.test/accounts/'))).toBe(false);

    // The assistant tries the plan change anyway: refused before any call, with what to tell the visitor.
    const reply = await json(await say(w.h, sessionToken, { kind: 'text', text: 'Change my plan' }));
    expect(reply['messages'][0].text).toContain('not_signed_in');
    expect(net.calls.some((c) => c.url.startsWith('https://app.acme.test/plan'))).toBe(false);
    await w.settle();
    expect((await json(await w.owner.get(`/conversations/${sessionId}`)))['conversation']['user']).toBeNull();

    // Rotating the secret retires every token signed with the old one.
    const good = await signIdentity({ sub: 'u_2', exp: now() + 3600 }, secret);
    const rotated = await json(await w.owner.send('POST', '/identity/rotate', {}));
    expect(rotated).toMatchObject({ version: 2 });
    expect(rotated['secret']).not.toBe(secret);
    net.calls.length = 0;
    await w.h.post('/v1/sites/demo/sessions', { identity: good, lead: { name: 'Bo' }, context: { pageUrl: 'https://acme.test/' }, firstMessage: 'Hi' });
    expect(net.calls.some((c) => c.url.startsWith('https://app.acme.test/accounts/'))).toBe(false);
  });

  it('keeps the secret from members', async () => {
    const { w } = await setUp();
    const member = await w.member();
    expect((await member.get('/identity')).status).toBe(403);
  });
});

describe('signed-in visitors through the API', () => {
  it('takes the server’s user as it is: the key is the proof', async () => {
    const { w } = await setUp();
    const net = fakeInternet();
    const created = await json(await w.owner.send('POST', '/keys', { name: 'backend', scopes: ['chat', 'conversations:read'] }));
    const key = created['key'] as string;
    // A server calls the API: no browser Origin.
    const pending: Promise<unknown>[] = [];
    const api = harness(testConfig({ widget: { leadForm: { enabled: false, fields: [] } }, ...(assistant as object) }), w.env, null, (p) => pending.push(p));
    const started = await api.fetch('/api/v1/conversations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hi', user: { id: 'u_9', email: 'bo@acme.test', plan: 'team' } }),
    });
    expect(started.status, JSON.stringify(await started.clone().json())).toBe(201);
    const { id } = await json(started);
    expect(net.calls.some((c) => c.url === 'https://app.acme.test/accounts/u_9')).toBe(true);
    await Promise.all(pending);
    const detail = await json(await api.fetch(`/api/v1/conversations/${id}`, { headers: { Authorization: `Bearer ${key}` } }));
    expect(detail['conversation']['user']).toEqual({ id: 'u_9', email: 'bo@acme.test', plan: 'team' });
    // Without an id it is refused, not half-trusted.
    const bad = await api.fetch('/api/v1/conversations', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hi', user: { email: 'x@y.z' } }) });
    expect(bad.status).toBe(400);
  });
});

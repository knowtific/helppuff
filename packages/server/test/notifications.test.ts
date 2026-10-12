import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitTo, forgetWebhooks, signDelivery } from '../src/webhooks/deliver.js';
import { emailKind, forgetEmailService, writeEmail } from '../src/notifications/email.js';
import { OWNER, world } from './inbox-helpers.js';

/**
 * Email notifications and custom webhooks: the owner's own request, sent by
 * HelpPuff. The email service is one request for any provider; each person
 * chooses their emails; a webhook can send a body in the receiver's format.
 */

const SITE = 'demo';
const RESEND = {
  url: 'https://api.resend.com/emails',
  headers: [
    { name: 'Content-Type', value: 'application/json', secret: false },
    { name: 'Authorization', value: 'Bearer re_live_secret', secret: true },
  ],
  body: '{"from": "HelpPuff <assistant@acme.example>", "to": ["{{email.to}}"], "subject": "{{email.subject}}", "text": "{{email.text}}", "html": "{{email.html}}"}',
};

type Sent = { url: string; headers: Headers; body: Record<string, unknown> };
let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  forgetEmailService(SITE);
  forgetWebhooks(SITE);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const text = typeof init?.body === 'string' ? init.body : '';
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { raw: text };
    }
    sent.push({ url: String(input), headers: new Headers(init?.headers), body });
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());

async function setUp() {
  const w = await world();
  const deps = { db: w.db, fetch: globalThis.fetch, secret: String(w.env['HELPPUFF_SECRET']), owner: OWNER };
  const emit = (type: Parameters<typeof emitTo>[2], data: Record<string, unknown>) => emitTo(deps, SITE, type, data);
  return { w, deps, emit };
}

describe('the email service', () => {
  it('needs {{email.to}} and the message, keeps the key sealed, and only admins set it up', async () => {
    const { w } = await setUp();
    const missing = await w.owner.send('PUT', '/notifications/email', { ...RESEND, body: '{"subject": "{{email.subject}}", "text": "{{email.text}}"}' });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { message: string } }).error.message).toContain('{{email.to}}');

    const saved = await w.owner.send('PUT', '/notifications/email', RESEND);
    expect(saved.status).toBe(200);
    const view = (await saved.json()) as { headers: unknown[]; enabled: boolean; dashboardUrl: string };
    expect(view.headers).toContainEqual({ name: 'Authorization', value: '', secret: true, set: true });
    expect(view.dashboardUrl).toBe('http://server.test');
    expect(JSON.stringify(w.db.raw.prepare('SELECT headers FROM email_service').get())).not.toContain('re_live_secret');

    const member = await w.member();
    const about = (await (await member.get('/notifications')).json()) as { email: Record<string, unknown>; choices: { type: string }[] };
    expect(about.email).toEqual({ configured: true, enabled: true });
    expect(about.choices.map((c) => c.type)).not.toContain('budget.exhausted');
    expect(about.choices.map((c) => c.type)).toContain('lead.captured');
    expect((await member.send('PUT', '/notifications/email', RESEND)).status).toBe(403);
    expect((await member.get('/notifications/email')).status).toBe(403);
  });

  it('sends a test email to you through the saved request', async () => {
    const { w } = await setUp();
    await w.owner.send('PUT', '/notifications/email', RESEND);
    const tested = (await (await w.owner.send('POST', '/notifications/email/test', {})).json()) as { ok: boolean; to: string };
    expect(tested).toMatchObject({ ok: true, to: OWNER });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('authorization')).toBe('Bearer re_live_secret');
    expect(sent[0]!.body).toMatchObject({ to: [OWNER], subject: 'A test from HelpPuff' });
  });
});

describe('who gets which email', () => {
  it('sends each chosen email once per person, written by HelpPuff, escaped in HTML', async () => {
    const { w, emit } = await setUp();
    await w.owner.send('PUT', '/notifications/email', RESEND);
    await w.owner.send('PUT', '/prefs', { emails: ['lead.captured'] });
    const member = await w.member();
    const prefs = (await (await member.send('PUT', '/prefs', { emails: ['lead.captured', 'budget.exhausted', 'not-a-thing'] })).json()) as { emails: string[] };
    // A member cannot choose an admin's email, nor one that does not exist.
    expect(prefs.emails).toEqual(['lead.captured']);

    await emit('lead.captured', { conversationId: 'c_1', name: 'Ada <b>Lovelace</b>', email: 'ada@example.com', phone: '0400 111 222' });
    expect(sent.map((s) => s.body['to'])).toEqual(expect.arrayContaining([[OWNER], ['mo@acme.com']]));
    expect(sent).toHaveLength(2);
    const email = sent[0]!.body as { subject: string; text: string; html: string };
    expect(email.subject).toBe('New contact: Ada <b>Lovelace</b>');
    expect(email.text).toContain('Phone: 0400 111 222');
    expect(email.text).toContain('http://server.test/admin/#/conversations/c_1');
    expect(email.html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
    expect(email.html).not.toContain('<b>');

    sent = [];
    await emit('budget.exhausted', { resetsAt: '2026-10-13T00:00:00.000Z' });
    await emit('job.created', { job: { id: 'job_1', number: 7, title: 'Blocked drain' } });
    expect(sent).toEqual([]);
  });

  it('gives a chat only to the person it was given to, and a hot lead only when the AI says hot', async () => {
    const { w, emit } = await setUp();
    await w.owner.send('PUT', '/notifications/email', RESEND);
    await w.owner.send('PUT', '/prefs', { emails: ['conversation.assigned', 'lead.hot'] });
    const member = await w.member();
    await member.send('PUT', '/prefs', { emails: ['conversation.assigned', 'lead.hot'] });

    await emit('conversation.assigned', { conversationId: 'c_2', assignedTo: 'mo@acme.com', by: OWNER });
    expect(sent.map((s) => s.body['to'])).toEqual([['mo@acme.com']]);
    sent = [];
    // Taking it yourself is no news.
    await emit('conversation.assigned', { conversationId: 'c_2', assignedTo: 'mo@acme.com', by: 'mo@acme.com' });
    expect(sent).toEqual([]);

    await emit('conversation.completed', { conversationId: 'c_3', labels: { leadQuality: 'warm' }, lead: { name: 'Ben' } });
    expect(sent).toEqual([]);
    await emit('conversation.completed', { conversationId: 'c_3', labels: { leadQuality: 'hot' }, lead: { name: 'Ben', phone: '0411' }, summary: 'Ben wants a quote this week.', followUp: 'Call today.' });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toMatchObject({ subject: 'Hot lead: Ben' });
    expect(String(sent[0]!.body['text'])).toContain('Ben wants a quote this week.');
    expect(String(sent[0]!.body['text'])).toContain('Next step: Call today.');
  });

  it('sends nothing to a removed teammate, nor while the service is paused', async () => {
    const { w, emit } = await setUp();
    await w.owner.send('PUT', '/notifications/email', RESEND);
    await w.owner.send('PUT', '/prefs', { emails: ['callback.requested'] });
    const member = await w.member();
    await member.send('PUT', '/prefs', { emails: ['callback.requested'] });
    expect((await w.owner.send('DELETE', '/admins/mo%40acme.com')).status).toBe(200);

    await emit('callback.requested', { name: 'Cy', phone: '0422' });
    expect(sent.map((s) => s.body['to'])).toEqual([[OWNER]]);

    sent = [];
    await w.owner.send('PUT', '/notifications/email', { enabled: false });
    forgetEmailService(SITE);
    await emit('callback.requested', { name: 'Cy', phone: '0422' });
    expect(sent).toEqual([]);
  });

  it('knows which events are emails', () => {
    expect(emailKind('conversation.completed', { labels: { leadQuality: 'hot' } })).toBe('lead.hot');
    expect(emailKind('conversation.completed', { labels: { leadQuality: 'cold' } })).toBeNull();
    expect(emailKind('message.received', {})).toBeNull();
    expect(emailKind('appointment.cancelled', {})).toBe('appointment.cancelled');
    const booking = writeEmail('appointment.created', { appointment: { title: 'Site visit', start: Date.UTC(2026, 9, 13, 22, 0), timezone: 'Australia/Sydney', attendee: { name: 'Ada', phone: '0400' } } }, null);
    expect(booking.subject).toBe('New booking: Site visit, Wed 14 Oct, 09:00 GMT+11');
    expect(booking.text).not.toContain('dashboard');
  });
});

describe('custom webhooks', () => {
  it('send the owner’s own request, signed over what is sent, with the secret header opened', async () => {
    const { w, deps, emit } = await setUp();
    const added = await w.owner.send('POST', '/webhooks', {
      url: 'https://slack.example.com/api/chat.postMessage',
      format: 'custom',
      events: ['callback.requested'],
      headers: [{ name: 'Authorization', value: 'Bearer xoxb-secret', secret: true }],
      body: '{"channel": "#sales", "text": "Call {{data.name}} on {{data.phone}} ({{event.type}})"}',
    });
    expect(added.status).toBe(201);
    const hook = (await added.json()) as { id: string; secret: string; format: string; headers: unknown[] };
    expect(hook.format).toBe('custom');
    expect(hook.headers).toEqual([{ name: 'Authorization', value: '', secret: true, set: true }]);
    expect(JSON.stringify(w.db.raw.prepare('SELECT headers FROM webhooks').get())).not.toContain('xoxb-secret');

    await emit('callback.requested', { name: 'Ada "the" Countess', phone: '0400' });
    expect(sent).toHaveLength(1);
    const [delivery] = sent;
    expect(delivery!.url).toBe('https://slack.example.com/api/chat.postMessage');
    expect(delivery!.body).toEqual({ channel: '#sales', text: 'Call Ada "the" Countess on 0400 (callback.requested)' });
    expect(delivery!.headers.get('authorization')).toBe('Bearer xoxb-secret');
    const timestamp = Number(delivery!.headers.get('x-helppuff-timestamp'));
    expect(delivery!.headers.get('x-helppuff-signature')).toBe(await signDelivery(hook.secret, timestamp, JSON.stringify(delivery!.body)));

    // Without HELPPUFF_SECRET the header cannot be opened: nothing is sent, and the endpoint says why.
    sent = [];
    await emitTo({ ...deps, secret: undefined }, SITE, 'callback.requested', { name: 'Ada' });
    expect(sent).toEqual([]);
    expect(w.db.raw.prepare('SELECT last_status, last_error FROM webhooks WHERE id = ?').get(hook.id)).toMatchObject({ last_status: 'failed', last_error: expect.stringContaining('secret header') });

    // Back to the signed envelope.
    const back = (await (await w.owner.send('PATCH', `/webhooks/${hook.id}`, { format: 'helppuff' })).json()) as Record<string, unknown>;
    expect(back['format']).toBe('helppuff');
    expect(back).not.toHaveProperty('body');
    forgetWebhooks(SITE);
    await emit('callback.requested', { name: 'Ada' });
    expect(sent[0]!.body).toMatchObject({ type: 'callback.requested', data: { name: 'Ada' } });
  });

  it('may use {{data}} in the address path, never in its host', async () => {
    const { w } = await setUp();
    expect((await w.owner.send('POST', '/webhooks', { url: 'https://{{data.host}}/x', format: 'custom' })).status).toBe(400);
    expect((await w.owner.send('POST', '/webhooks', { url: 'https://api.example.com/leads/{{data.email}}', format: 'custom', method: 'PUT' })).status).toBe(201);
  });
});

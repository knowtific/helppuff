import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_PRESETS } from '@helppuff/protocol';
import type { StepLike } from '@helppuff/rag';
import { emailKind, forgetEmailService } from '../src/notifications/email.js';
import {
  customerCopy,
  readReplyAddress,
  readResume,
  replyAddress,
  resumeLink,
  runCustomerReplyJob,
  writeCustomerEmail,
  type CustomerContext,
  type CustomerReplyParams,
} from '../src/notifications/customer.js';
import { handleInboundEmail, htmlToText, isAutomatic, newPart, type InboundMessage } from '../src/email/inbound.js';
import { renderBody } from '../src/tools/template.js';
import { resolveSite } from '../src/config/site.js';
import { SECRET, ORIGIN } from './helpers.js';
import { OWNER, world } from './inbox-helpers.js';

/**
 * Emails to customers (wiki Customer-Emails): the copy (A), the team's
 * replies when the customer left (B), answers by email (C), and what they
 * share: the reply address, the resume link, unsubscribing and the limits.
 */

const SITE = 'demo';
const CONV = 'conv-1';
const DOMAIN = 'chat.example.com';
const RESEND = EMAIL_PRESETS.find((p) => p.id === 'resend')!.request('Acme <hello@acme.example>', 're_live_secret');

type Sent = { url: string; body: Record<string, unknown> };
let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  forgetEmailService(SITE);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const text = typeof init?.body === 'string' ? init.body : '';
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { raw: text };
    }
    sent.push({ url: String(input), body });
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());

const context = (over: Partial<CustomerContext> = {}): CustomerContext => ({
  siteId: SITE,
  brand: 'Acme Plumbing',
  showAgentName: true,
  origins: [ORIGIN],
  replyDomain: null,
  perContactPerDay: 5,
  perSitePerDay: 200,
  ...over,
});

const now = () => Date.now();

type World = Awaited<ReturnType<typeof world>>;

/** A conversation with a contact: two visitor messages, an answer, and a team-only summary. */
function seed(w: World, options: { id?: string; email?: string | null; visitor?: number; emailOff?: number | null } = {}) {
  const id = options.id ?? CONV;
  const t = Date.now() - 60_000;
  w.db.raw
    .prepare("INSERT INTO leads (id, site_id, conversation_id, name, email, source, status, created_at, updated_at, email_off) VALUES (?, ?, ?, 'Sarah Jones', ?, 'form', 'new', ?, ?, ?)")
    .run(`lead_${id}`, SITE, id, options.email === undefined ? 'sarah@example.com' : options.email, t, t, options.emailOff ?? null);
  w.db.raw
    .prepare("INSERT INTO conversations (id, site_id, started_at, last_at, page_url, message_count, lead_id, summary) VALUES (?, ?, ?, ?, ?, 3, ?, ?)")
    .run(id, SITE, t, t, `${ORIGIN}/hot-water`, `lead_${id}`, JSON.stringify({ summary: 'Hot lead, ready to book', leadQuality: 'hot', followUp: 'Call her before 8am', recap: 'You asked about a leaking tank. We said someone can come tomorrow.' }));
  const lines: [string, string][] = [
    ['user', 'My hot water tank is leaking, can someone come tomorrow?'],
    ['agent', 'Sorry to hear that. I’ll ask the team. <script>alert(1)</script>'],
    ['user', 'Thanks, morning is best.'],
  ];
  lines.slice(0, (options.visitor ?? 2) === 1 ? 2 : 3).forEach(([role, text], i) => {
    w.db.raw.prepare("INSERT INTO messages (id, conversation_id, role, type, text, payload, ts) VALUES (?, ?, ?, 'text', ?, '{}', ?)").run(`${id}:m${i}`, id, role, text, t + i);
  });
}

async function emailService(w: World, request: { method: string; url: string; headers: unknown; body: string } = RESEND) {
  expect((await w.owner.send('PUT', '/notifications/email', request)).status).toBe(200);
  forgetEmailService(SITE);
}

const deps = (w: World) => ({ db: w.db, fetch: globalThis.fetch.bind(globalThis), secret: SECRET, now });

/** Workflow steps run at once; sleeps are skipped. */
const steps: StepLike = { do: (_name, run) => run() as never, sleep: async () => {} };

describe('what a customer gets', () => {
  it('is written for them: the recap and what they saw, escaped; never the team’s summary', async () => {
    const w = await world();
    seed(w);
    await emailService(w);
    const result = await customerCopy(deps(w), context(), CONV);
    expect(result).toMatchObject({ status: 'sent', to: 'sarah@example.com' });
    const body = sent[0]!.body;
    expect(body['subject']).toBe('Your conversation with Acme Plumbing');
    expect(String(body['text'])).toContain('You asked about a leaking tank.');
    expect(String(body['text'])).toContain('You: Thanks, morning is best.');
    const all = JSON.stringify(body);
    for (const internal of ['Hot lead', 'leadQuality', 'Call her before 8am']) expect(all).not.toContain(internal);
    expect(String(body['html'])).toContain('&lt;script&gt;');
    expect(String(body['html'])).not.toContain('<script>');
    // The continue link and the unsubscribe link, both signed.
    expect(String(body['text'])).toMatch(new RegExp(`${ORIGIN}/hot-water#hp-resume=[\\w.-]+`));
    expect(String(body['text'])).toContain('/v1/email/unsubscribe?t=');
  });

  it('leaves Reply-To out when there is no reply address, and threads answers when there is', async () => {
    const w = await world();
    seed(w);
    await emailService(w);
    await customerCopy(deps(w), context(), CONV);
    expect(sent[0]!.body).not.toHaveProperty('reply_to');
    expect((sent[0]!.body['headers'] as Record<string, string>)['List-Unsubscribe']).toMatch(/^<http:\/\/server\.test\/v1\/email\/unsubscribe\?t=/);
    expect((sent[0]!.body['headers'] as Record<string, string>)['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    await customerCopy(deps(w), context({ replyDomain: DOMAIN }), CONV, { manual: true });
    const answered = sent[1]!.body;
    expect(answered['reply_to']).toBe(await replyAddress(SECRET, SITE, CONV, DOMAIN));
    expect(String(answered['reply_to'])).toMatch(/^reply\+conv-1\.[a-z2-7]{10}@chat\.example\.com$/);
    expect(String(answered['subject'])).toMatch(/\[#[a-z2-7]{7}\]$/);
    expect((answered['headers'] as Record<string, string>)['List-Unsubscribe']).toContain(`<mailto:${answered['reply_to']}?subject=unsubscribe>`);
  });

  it('sends a copy once, not for one message, never to someone who unsubscribed, and within the day’s limits', async () => {
    const w = await world();
    seed(w);
    seed(w, { id: 'conv-2', email: 'one@example.com', visitor: 1 });
    seed(w, { id: 'conv-3', email: 'gone@example.com', emailOff: Date.now() });
    await emailService(w);
    expect((await customerCopy(deps(w), context(), CONV)).status).toBe('sent');
    expect(await customerCopy(deps(w), context(), CONV)).toMatchObject({ status: 'skipped', reason: 'already_sent' });
    expect(await customerCopy(deps(w), context(), 'conv-2')).toMatchObject({ status: 'skipped', reason: 'too_short' });
    expect(await customerCopy(deps(w), context(), 'conv-3', { manual: true })).toMatchObject({ status: 'skipped', reason: 'unsubscribed' });
    // By hand it goes again, until the limit for that customer.
    expect((await customerCopy(deps(w), context({ perContactPerDay: 2 }), CONV, { manual: true })).status).toBe('sent');
    expect(await customerCopy(deps(w), context({ perContactPerDay: 2 }), CONV, { manual: true })).toMatchObject({ status: 'skipped', reason: 'limit' });
    expect(sent).toHaveLength(2);
    const log = w.db.raw.prepare("SELECT kind, to_email, status FROM customer_emails WHERE kind = 'copy'").all();
    expect(log).toEqual([
      { kind: 'copy', to_email: 'sarah@example.com', status: 'ok' },
      { kind: 'copy', to_email: 'sarah@example.com', status: 'ok' },
    ]);
  });

  it('has nothing to send without an email service, or an address', async () => {
    const w = await world();
    seed(w);
    seed(w, { id: 'conv-2', email: null });
    expect(await customerCopy(deps(w), context(), CONV)).toMatchObject({ status: 'skipped', reason: 'no_email_service' });
    await emailService(w);
    expect(await customerCopy(deps(w), context(), 'conv-2')).toMatchObject({ status: 'skipped', reason: 'no_email' });
  });

  it('can be emailed by hand from the conversation, by anyone on the team', async () => {
    const w = await world();
    seed(w);
    await emailService(w);
    const member = await w.member();
    const response = await member.send('POST', `/conversations/${CONV}/email-copy`, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'sent', to: 'sarah@example.com' });
    seed(w, { id: 'conv-2', email: null });
    const none = await w.owner.send('POST', '/conversations/conv-2/email-copy', {});
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: { message: string } }).error.message).toContain('no email address');
  });
});

describe('unsubscribing', () => {
  it('shows a button, then stops every email to that address; an admin can allow them again', async () => {
    const w = await world();
    seed(w);
    await emailService(w);
    await customerCopy(deps(w), context(), CONV);
    const link = /(http:\/\/server\.test\/v1\/email\/unsubscribe\?t=\S+)/.exec(String(sent[0]!.body['text']))![1]!;
    const path = link.replace('http://server.test', '');
    const page = await w.h.fetch(path);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Unsubscribe');
    // Opening the link changes nothing (link scanners open links too).
    expect(w.db.raw.prepare('SELECT email_off FROM leads WHERE id = ?').get(`lead_${CONV}`)).toEqual({ email_off: null });
    const done = await w.h.fetch(path, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('unsubscribed');
    expect(await customerCopy(deps(w), context(), CONV, { manual: true })).toMatchObject({ status: 'skipped', reason: 'unsubscribed' });

    const lead = (await (await w.owner.get(`/leads/lead_${CONV}`)).json()) as { email_off: number | null };
    expect(lead.email_off).toBeGreaterThan(0);
    expect((await (await w.member()).send('POST', `/leads/lead_${CONV}/emails`, { allowed: true })).status).toBe(403);
    expect((await w.owner.send('POST', `/leads/lead_${CONV}/emails`, { allowed: true })).status).toBe(200);
    expect((await customerCopy(deps(w), context(), CONV, { manual: true })).status).toBe('sent');

    expect((await w.h.fetch('/v1/email/unsubscribe?t=forged.token')).status).toBe(404);
  });
});

describe('continue the chat', () => {
  it('turns the link into a session for that conversation, with what was said', async () => {
    const w = await world();
    seed(w);
    const link = await resumeLink(SECRET, SITE, CONV, `${ORIGIN}/hot-water`, now());
    const token = link.split('#hp-resume=')[1]!;
    expect(await readResume(SECRET, SITE, token, now())).toBe(CONV);
    expect(await readResume(SECRET, 'other', token, now())).toBeNull();
    expect(await readResume(SECRET, SITE, token, now() + 31 * 86_400_000)).toBeNull();

    const response = await w.h.post(`/v1/sites/${SITE}/sessions/resume`, { token });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sessionId: string; sessionToken: string; messages: { role: string; text?: string }[] };
    expect(body.sessionId).toBe(CONV);
    expect(body.messages.map((m) => m.text)).toContain('Thanks, morning is best.');
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    expect((await w.h.post(`/v1/sites/${SITE}/sessions/resume`, { token: `${token}x` })).status).toBe(401);
    expect((await w.h.post(`/v1/sites/${SITE}/sessions/resume`, { token }, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });
});

describe('the team’s replies, when the customer has left (B)', () => {
  async function setUp() {
    const created: { id?: string; params: unknown }[] = [];
    const w = await world({ live: { enabled: true }, customerEmails: { replies: { enabled: true } } }, { CRAWL_WORKFLOW: { create: async (options: { id?: string; params: unknown }) => void created.push(options) } });
    seed(w);
    await emailService(w);
    return { w, created };
  }
  const job = (w: World, connected = false) => (params: CustomerReplyParams) =>
    runCustomerReplyJob(steps, { ...deps(w), connected: async () => connected }, params);

  it('starts one job per burst of replies, and emails them all once', async () => {
    const { w, created } = await setUp();
    await w.owner.send('POST', `/conversations/${CONV}/reply`, { text: 'Yes, I can be there at 10am.' });
    await w.owner.send('POST', `/conversations/${CONV}/reply`, { text: 'Does that work?' });
    await w.settle();
    expect(created.map((c) => c.id)).toEqual([`cr-${CONV}-0`, `cr-${CONV}-0`]);
    const params = created[0]!.params as CustomerReplyParams;
    expect(params).toMatchObject({ kind: 'customer-reply', siteId: SITE, conversationId: CONV, delayMs: 120_000 });

    expect(await job(w)(params)).toMatchObject({ status: 'sent', to: 'sarah@example.com' });
    const email = sent.at(-1)!.body;
    expect(String(email['subject'])).toMatch(/ replied$/);
    expect(String(email['text'])).toContain('You asked: Thanks, morning is best.');
    expect(String(email['text'])).toContain('Yes, I can be there at 10am.');
    expect(String(email['text'])).toContain('Does that work?');
    // Dealt with: the same job again has nothing new.
    expect(await job(w)(params)).toMatchObject({ status: 'skipped', reason: 'nothing_new' });
  });

  it('emails nothing to someone on the site, an unticked reply, or nobody', async () => {
    const { w, created } = await setUp();
    await w.owner.send('POST', `/conversations/${CONV}/reply`, { text: 'Are you there?' });
    await w.settle();
    expect(await job(w, true)(created[0]!.params as CustomerReplyParams)).toMatchObject({ status: 'skipped', reason: 'on_the_site' });

    await w.owner.send('POST', `/conversations/${CONV}/reply`, { text: 'Only for the chat', email: false });
    await w.settle();
    expect(created).toHaveLength(1);
    expect(sent.filter((s) => s.url.includes('resend'))).toHaveLength(0);
    // The unticked reply never reaches the visitor's poll with its mark.
    const stored = w.db.raw.prepare("SELECT payload FROM messages WHERE text = 'Only for the chat'").get() as { payload: string };
    expect(JSON.parse(stored.payload)).toMatchObject({ noEmail: 1 });

    seed(w, { id: 'conv-2', email: null });
    await w.owner.send('POST', '/conversations/conv-2/reply', { text: 'Hello?' });
    await w.settle();
    expect(created).toHaveLength(1);
  });

  it('starts no job while the switch is off', async () => {
    const created: unknown[] = [];
    const w = await world({ live: { enabled: true } }, { CRAWL_WORKFLOW: { create: async (o: unknown) => void created.push(o) } });
    seed(w);
    await w.owner.send('POST', `/conversations/${CONV}/reply`, { text: 'Hi' });
    await w.settle();
    expect(created).toHaveLength(0);
    const detail = (await (await w.owner.get(`/conversations/${CONV}`)).json()) as { customerEmail: unknown };
    expect(detail.customerEmail).toBeNull();
  });

  it('sends at once without a Workflow when there is no wait, and not at all when there is one', async () => {
    const at = await world({ live: { enabled: true }, customerEmails: { replies: { enabled: true } }, security: { limits: { customerReplyDelaySeconds: 0 } } });
    seed(at);
    await emailService(at);
    await at.owner.send('POST', `/conversations/${CONV}/reply`, { text: 'On my way.' });
    await at.settle();
    expect(sent.filter((s) => s.url.includes('resend')).map((s) => String(s.body['text']))).toEqual([expect.stringContaining('On my way.')]);

    sent = [];
    const later = await world({ live: { enabled: true }, customerEmails: { replies: { enabled: true } } });
    seed(later);
    await emailService(later);
    await later.owner.send('POST', `/conversations/${CONV}/reply`, { text: 'Later.' });
    await later.settle();
    expect(sent.filter((s) => s.url.includes('resend'))).toHaveLength(0);
  });

  it('tells the reply box who it reaches', async () => {
    const { w } = await setUp();
    const detail = (await (await w.owner.get(`/conversations/${CONV}`)).json()) as { customerEmail: unknown };
    expect(detail.customerEmail).toEqual({ to: 'sarah@example.com', unsubscribed: false, onSite: false, byEmail: false });
  });
});

/** A raw email as Cloudflare hands it to the Worker. */
function inbound(raw: string, envelope: { from: string; to: string }): InboundMessage & { rejected: string | null } {
  const head = raw.split(/\r?\n\r?\n/)[0]!.replace(/\r?\n[ \t]+/g, ' ');
  const headers = new Headers();
  for (const line of head.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const message = {
    from: envelope.from,
    to: envelope.to,
    headers,
    raw: new Response(raw).body!,
    rawSize: raw.length,
    rejected: null as string | null,
    setReject(reason: string) {
      message.rejected = reason;
    },
  };
  return message;
}

const mime = (headers: Record<string, string>, body: string, type = 'text/plain; charset=utf-8') =>
  [...Object.entries({ 'MIME-Version': '1.0', 'Content-Type': type, Subject: 'Re: Mike from Acme Plumbing replied', From: 'Sarah Jones <sarah@example.com>', ...headers }).map(([k, v]) => `${k}: ${v}`), '', body].join('\r\n');

describe('answers by email (C)', () => {
  async function setUp(limits: Record<string, number> = {}) {
    const w = await world({ live: { enabled: true }, customerEmails: { inbound: { enabled: true, domain: DOMAIN } }, security: { limits } });
    seed(w);
    const pending: Promise<unknown>[] = [];
    const run = (message: InboundMessage) =>
      handleInboundEmail(message, {
        sites: async () => ({ [SITE]: await resolveSite({ config: { sites: { [SITE]: (await import('./helpers.js')).testConfig({ live: { enabled: true }, customerEmails: { inbound: { enabled: true, domain: DOMAIN } }, security: { limits } }).sites[SITE]! } }, platform: { kv: w.env['HELPPUFF_KV'] as never, log: () => {} } }, SITE) }),
        db: w.db,
        env: w.env,
        secret: SECRET,
        now,
        log: () => {},
        waitUntil: (p) => void pending.push(p),
        owner: OWNER,
      });
    const settle = async () => {
      while (pending.length) await Promise.all(pending.splice(0));
    };
    const to = await replyAddress(SECRET, SITE, CONV, DOMAIN);
    return { w, run, settle, to };
  }

  it('saves a Gmail reply without the quote, as a live chat waiting for the team', async () => {
    const { w, run, settle, to } = await setUp();
    const raw = mime({ To: to }, '10am is perfect, see you then.\r\n\r\nOn Mon, 20 Oct 2026 at 07:17, Acme Plumbing <' + to + '> wrote:\r\n> Yes, I can be there at 10am.\r\n');
    expect(await run(inbound(raw, { from: 'sarah@example.com', to }))).toBe('saved');
    await settle();
    const message = w.db.raw.prepare("SELECT role, text, payload FROM messages WHERE conversation_id = ? AND payload LIKE '%email%'").get(CONV) as { role: string; text: string; payload: string };
    expect(message).toEqual({ role: 'user', text: '10am is perfect, see you then.', payload: '{"via":"email"}' });
    const conversation = w.db.raw.prepare('SELECT status, waiting_since, assigned_to FROM conversations WHERE id = ?').get(CONV) as { status: string; waiting_since: number | null };
    expect(conversation.status).toBe('live');
    expect(conversation.waiting_since).toBeGreaterThan(0);
    // The team is alerted as for a new live chat; the assistant never answers it.
    expect(w.hub.events.map((e) => e.type)).toEqual(['email']);
    expect(w.db.raw.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'agent'").get(CONV)).toEqual({ n: 1 });
  });

  it('reads Outlook’s and HTML-only replies, and marks one from another address', async () => {
    const { w, run, to } = await setUp();
    const outlook = mime({ To: to, From: 'Sarah <s.jones@work.example>' }, 'Can we make it 11?\r\n\r\nFrom: Acme Plumbing <' + to + '>\r\nSent: Monday, 20 October 2026 7:17 AM\r\nSubject: Mike replied\r\n\r\nYes, 10am.');
    expect(await run(inbound(outlook, { from: 's.jones@work.example', to }))).toBe('saved');
    const html = mime({ To: to }, '<div>Perfect, <b>thanks</b>!</div><div class="gmail_quote">On Mon wrote: old stuff</div>', 'text/html; charset=utf-8');
    expect(await run(inbound(html, { from: 'sarah@example.com', to }))).toBe('saved');
    const rows = w.db.raw.prepare("SELECT text, payload FROM messages WHERE conversation_id = ? AND payload LIKE '%email%' ORDER BY ts").all(CONV) as { text: string; payload: string }[];
    expect(rows).toEqual([
      { text: 'Can we make it 11?', payload: '{"via":"email","from":"s.jones@work.example"}' },
      { text: 'Perfect, thanks!', payload: '{"via":"email"}' },
    ]);
  });

  it('drops auto-replies and bounces, and refuses a forged address or a domain it does not serve', async () => {
    const { w, run, to } = await setUp();
    const away = inbound(mime({ To: to, 'Auto-Submitted': 'auto-replied' }, 'I am away until Monday.'), { from: 'sarah@example.com', to });
    expect(await run(away)).toBe('dropped');
    expect(away.rejected).toBeNull();
    expect(await run(inbound(mime({ To: to }, 'Delivery failed'), { from: 'MAILER-DAEMON@mx.example.com', to }))).toBe('dropped');

    const forged = to.replace(/\.[a-z2-7]{10}@/, '.aaaaaaaaaa@');
    const bad = inbound(mime({ To: forged }, 'Let me in'), { from: 'mallory@example.com', to: forged });
    expect(await run(bad)).toBe('rejected');
    expect(bad.rejected).toBe('Unknown conversation');
    const elsewhere = inbound(mime({}, 'Hi'), { from: 'x@example.com', to: 'reply@other.example' });
    expect(await run(elsewhere)).toBe('rejected');
    const dmarc = inbound(mime({ To: to, 'Authentication-Results': 'mx.cloudflare.net; dmarc=fail header.from=example.com' }, 'Hi'), { from: 'sarah@example.com', to });
    expect(await run(dmarc)).toBe('rejected');
    expect(w.db.raw.prepare("SELECT COUNT(*) AS n FROM messages WHERE payload LIKE '%email%'").get()).toEqual({ n: 0 });
  });

  it('finds the conversation from the subject when the address lost its tag', async () => {
    const { w, run } = await setUp();
    await emailService(w);
    await customerCopy(deps(w), context({ replyDomain: DOMAIN }), CONV, { manual: true });
    const subject = String(sent[0]!.body['subject']);
    expect(await run(inbound(mime({ To: `reply@${DOMAIN}`, Subject: `Re: ${subject}` }, 'Thanks!'), { from: 'sarah@example.com', to: `reply@${DOMAIN}` }))).toBe('saved');
  });

  it('counts answers against the day’s limits', async () => {
    const { run, to } = await setUp({ inboundEmailsPerConversationPerDay: 1 });
    expect(await run(inbound(mime({ To: to }, 'One'), { from: 'sarah@example.com', to }))).toBe('saved');
    const second = inbound(mime({ To: to }, 'Two'), { from: 'sarah@example.com', to });
    expect(await run(second)).toBe('rejected');
    expect(second.rejected).toMatch(/Too many/);
  });

  it('unsubscribes from the List-Unsubscribe mailto', async () => {
    const { w, run, to } = await setUp();
    expect(await run(inbound(mime({ To: to, Subject: 'unsubscribe' }, ''), { from: 'sarah@example.com', to }))).toBe('unsubscribed');
    expect((w.db.raw.prepare('SELECT email_off FROM leads WHERE id = ?').get(`lead_${CONV}`) as { email_off: number | null }).email_off).toBeGreaterThan(0);
  });

  it('records the CLI’s test, and turns on only once one arrived', async () => {
    const { w, run } = await setUp();
    const test = await replyAddress(SECRET, SITE, 'test', DOMAIN);
    expect(await readReplyAddress(SECRET, SITE, test)).toEqual({ conversationId: 'test', domain: DOMAIN });
    const before = (await (await w.owner.get('/customer-emails/status')).json()) as { inbound: { verifiedAt: number | null } };
    expect(before.inbound.verifiedAt).toBeNull();
    expect(await run(inbound(mime({ To: test, Subject: 'A test from Acme' }, 'Answers by email work once this arrives.'), { from: 'hello@acme.example', to: test }))).toBe('test');
    const after = (await (await w.owner.get('/customer-emails/status')).json()) as { inbound: { verifiedAt: number | null; address: string } };
    expect(after.inbound).toMatchObject({ address: `reply@${DOMAIN}` });
    expect(after.inbound.verifiedAt).toBeGreaterThan(0);
  });

  it('emails whoever has the chat that the customer answered', () => {
    expect(emailKind('message.received', { channel: 'email' })).toBe('customer.replied');
    expect(emailKind('message.received', { kind: 'text' })).toBeNull();
  });
});

describe('the switches', () => {
  it('turns answers by email on only once the reply address is set up and a test arrived', async () => {
    const w = await world({ live: { enabled: true } });
    const on = { settings: { customerEmails: { inbound: { enabled: true } } } };
    const none = await w.owner.send('PUT', '/settings', on);
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: { message: string } }).error.message).toContain('helppuff email replies on');

    const set = await w.owner.send('PUT', '/customer-emails/inbound', { domain: DOMAIN, ruleId: 'rule-1' });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { customerEmails: unknown }).customerEmails).toMatchObject({ inbound: { enabled: false, domain: DOMAIN, ruleId: 'rule-1' } });
    expect((await w.owner.send('PUT', '/settings', on)).status).toBe(400);

    w.db.raw.prepare("INSERT INTO customer_emails (id, site_id, kind, to_email, status, sent_at) VALUES ('t1', ?, 'inbound-test', ?, 'ok', ?)").run(SITE, DOMAIN, Date.now());
    expect((await w.owner.send('PUT', '/settings', on)).status).toBe(200);
    // A domain from the dashboard's settings is ignored: only the CLI's route sets it.
    await w.owner.send('PUT', '/settings', { settings: { customerEmails: { inbound: { domain: 'evil.example' } } } });
    const status = (await (await w.owner.get('/customer-emails/status')).json()) as { settings: { inbound: { enabled: boolean; domain: string } } };
    expect(status.settings.inbound).toMatchObject({ enabled: true, domain: DOMAIN });
  });

  it('says what each still needs, and adds the reply-to field to a preset’s request', async () => {
    const w = await world({ live: { enabled: true } });
    const empty = (await (await w.owner.get('/customer-emails/status')).json()) as { ready: Record<string, boolean>; service: unknown };
    expect(empty).toMatchObject({ service: null, ready: { copy: false, replies: false, inbound: false } });
    // A Resend request from before customer emails: no {{email.replyTo}}.
    await emailService(w, { ...RESEND, body: '{"from": "Acme <hello@acme.example>", "to": ["{{email.to}}"], "subject": "{{email.subject}}", "text": "{{email.text}}"}' });
    const older = (await (await w.owner.get('/customer-emails/status')).json()) as { ready: Record<string, boolean>; service: { sendsReplyTo: boolean; canAddReplyTo: boolean; name: string } };
    expect(older.service).toMatchObject({ name: 'Resend', sendsReplyTo: false, canAddReplyTo: true });
    expect(older.ready).toMatchObject({ copy: true, replies: true, inbound: false });
    expect((await w.owner.send('POST', '/customer-emails/reply-to', {})).status).toBe(200);
    const added = (await (await w.owner.get('/customer-emails/status')).json()) as { service: { sendsReplyTo: boolean } };
    expect(added.service.sendsReplyTo).toBe(true);
    expect((await (await w.member()).get('/customer-emails/status')).status).toBe(403);
  });

  it('previews each email from the site’s names', async () => {
    const w = await world();
    const reply = (await (await w.owner.get('/customer-emails/preview?kind=reply')).json()) as { subject: string };
    expect(reply.subject).toMatch(/replied$/);
  });
});

describe('the pieces', () => {
  it('keeps only what was written now', () => {
    expect(newPart('Sounds good\n\nOn Tue, 21 Oct 2026, 09:00 Acme <reply+x.y@chat.example.com>\nwrote:\n> old')).toBe('Sounds good');
    expect(newPart('Yes\n-----Original Message-----\nFrom: Acme')).toBe('Yes');
    expect(newPart('Yes please\n> quoted\nThanks\n-- \nSarah\nCEO')).toBe('Yes please\nThanks');
    expect(newPart('On my way!\nSee you')).toBe('On my way!\nSee you');
    expect(htmlToText('<p>Hi&nbsp;there</p><blockquote>old</blockquote>').trim()).toBe('Hi there');
  });

  it('knows mail no person wrote', () => {
    expect(isAutomatic(new Headers({ 'Auto-Submitted': 'auto-replied' }), 'a@b.c')).toBe(true);
    expect(isAutomatic(new Headers({ Precedence: 'bulk' }), 'a@b.c')).toBe(true);
    expect(isAutomatic(new Headers(), '<>')).toBe(true);
    expect(isAutomatic(new Headers({ 'Auto-Submitted': 'no' }), 'sarah@example.com')).toBe(false);
  });

  it('leaves an optional field out of a JSON body when it is empty, and the whole object it empties', () => {
    const body = JSON.stringify({ to: '{{email.to}}', reply_to: { email: '{{email.replyTo}}' }, headers: '{{email.headers}}', note: '{{email.missing}}' });
    const scope = { email: { to: 'a@b.c', replyTo: '', headers: {} } };
    const rendered = JSON.parse(renderBody(body, scope, { omitEmpty: (p) => p === 'email.replyTo' || p === 'email.headers' }).text) as Record<string, unknown>;
    expect(rendered).toEqual({ to: 'a@b.c', note: null });
    // Without the option, nothing changes for tools and webhooks.
    expect(JSON.parse(renderBody(body, scope).text)).toEqual({ to: 'a@b.c', reply_to: { email: '' }, headers: {}, note: null });
  });

  it('gives every preset a reply-to field', () => {
    for (const preset of EMAIL_PRESETS) expect(preset.request('a@b.c', 'k').body).toContain('{{email.replyTo}}');
  });

  it('writes a reply email with the agent’s name, or the brand alone', () => {
    expect(writeCustomerEmail({ kind: 'reply', brand: 'Acme', agentName: 'Mike', asked: 'Tomorrow?', replies: ['Yes'] }).subject).toBe('Mike from Acme replied');
    expect(writeCustomerEmail({ kind: 'reply', brand: 'Acme', agentName: null, asked: null, replies: ['Yes'] }).subject).toBe('Acme replied');
  });
});

describe('the copy at the end of a conversation (the job)', () => {
  it('is a step after the summary when copies are on, and never when they are off', async () => {
    const { runConversationJob } = await import('../src/conversations/complete.js');
    const w = await world();
    seed(w);
    await emailService(w);
    const base = { kind: 'conversation' as const, siteId: SITE, conversationId: CONV, model: null, budget: 0, idleMs: 0 };
    // Quiet long enough: the job goes straight to its steps.
    w.db.raw.prepare('UPDATE conversations SET last_at = ? WHERE id = ?').run(Date.now() - 600_000, CONV);
    await runConversationJob(steps, { db: w.db, fetch: globalThis.fetch.bind(globalThis), secret: SECRET }, base);
    expect(sent).toHaveLength(0);
    w.db.raw.prepare('UPDATE conversations SET completed_at = NULL WHERE id = ?').run(CONV);
    await runConversationJob(steps, { db: w.db, fetch: globalThis.fetch.bind(globalThis), secret: SECRET }, { ...base, customer: context() });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body['subject']).toBe('Your conversation with Acme Plumbing');
  });
});

describe('Cloudflare Email Service', () => {
  it('sends through the Worker’s binding, with the reply-to and headers as fields', async () => {
    const messages: Record<string, unknown>[] = [];
    const binding = { send: async (message: Record<string, unknown>) => (messages.push(message), { messageId: '<abc@cf>' }) };
    const w = await world({}, { HELPPUFF_EMAIL: binding });
    seed(w);
    const saved = await w.owner.send('PUT', '/notifications/email', { kind: 'cloudflare', from: 'hello@chat.example.com' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ kind: 'cloudflare', from: 'hello@chat.example.com' });
    forgetEmailService(SITE);
    const result = await customerCopy({ ...deps(w), emailBinding: binding }, context({ replyDomain: DOMAIN }), CONV);
    expect(result.status).toBe('sent');
    expect(messages[0]).toMatchObject({ to: 'sarah@example.com', from: 'hello@chat.example.com', subject: expect.stringMatching(/^Your conversation with Acme Plumbing \[#/), replyTo: expect.stringMatching(/^reply\+conv-1\./) });
    expect((messages[0]!['headers'] as Record<string, string>)['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    // Its message id threads the next email, and finds the conversation an answer is for.
    expect(w.db.raw.prepare("SELECT message_id FROM customer_emails WHERE kind = 'copy'").get()).toEqual({ message_id: 'abc@cf' });
    await customerCopy({ ...deps(w), emailBinding: binding }, context({ replyDomain: DOMAIN }), CONV, { manual: true });
    expect((messages[1]!['headers'] as Record<string, string>)['In-Reply-To']).toBe('<abc@cf>');
    // The test email goes through it too.
    expect(((await (await w.owner.send('POST', '/notifications/email/test', {})).json()) as { ok: boolean }).ok).toBe(true);
    expect(messages[2]).toMatchObject({ to: OWNER, subject: 'A test from HelpPuff' });
  });

  it('needs the binding (a deploy) before it can be chosen, and says why sending fails', async () => {
    const w = await world();
    const refused = await w.owner.send('PUT', '/notifications/email', { kind: 'cloudflare', from: 'hello@chat.example.com' });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain('--cloudflare');
    const failing = { send: async () => Promise.reject(Object.assign(new Error('Sender not verified'), { code: 'E_SENDER_NOT_VERIFIED' })) };
    const v = await world({}, { HELPPUFF_EMAIL: failing });
    seed(v);
    await v.owner.send('PUT', '/notifications/email', { kind: 'cloudflare', from: 'hello@chat.example.com' });
    forgetEmailService(SITE);
    expect(await customerCopy({ ...deps(v), emailBinding: failing }, context(), CONV)).toMatchObject({ status: 'failed', error: 'E_SENDER_NOT_VERIFIED: Sender not verified' });
  });
});

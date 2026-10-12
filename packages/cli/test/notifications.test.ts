import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { tempProject } from './helpers.js';

/**
 * `helppuff email` and `helppuff webhooks` in their own format, against a fake
 * Worker: keys come from .env (never typed), a missing one is needs_input and
 * nothing is saved, and presets fill the request in.
 */

const SERVICE = { method: 'POST', url: 'https://api.resend.com/emails', headers: [], body: '', enabled: true, dashboardUrl: null, lastStatus: null, lastError: null };
const HOOK = { id: 'wh_1', url: 'https://slack.com/api/chat.postMessage', description: null, events: ['*'], enabled: true, secret: 'whsec_1', lastStatus: null, lastError: null, format: 'custom', method: 'POST', headers: [{ name: 'Authorization', value: '', secret: true, set: true }], body: '{}' };

const GAP = { id: 'gap_1', question: 'Do you convert cooktops to LPG?', count: 3, lastAskedAt: 0, status: 'open' };

function project(env = 'ADMIN_API_KEY=test-key\nRESEND_API_KEY=re_live_42\nSLACK_BOT_TOKEN=xoxb-42\n') {
  return tempProject({
    'helppuff.json': JSON.stringify({ site: 'acme', name: 'Acme', origins: ['https://acme.com'], backend: { type: 'workers-ai' }, cloudflare: { url: 'https://acme.workers.dev' } }),
    'prompt.md': 'You help Acme.',
    '.env': env,
  });
}

function worker() {
  const sent: { method: string; path: string; body: Record<string, any> | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      sent.push({ method, path: url.pathname, body });
      const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.pathname === '/admin/api/notifications/email' && method === 'GET') return reply({ service: SERVICE, presets: [] });
      if (url.pathname === '/admin/api/notifications/email' && method === 'PUT') return reply({ ...SERVICE, ...body });
      if (url.pathname === '/admin/api/notifications/email/test') return reply({ ok: true, status: 200, error: null, retryable: false, to: body?.['to'] });
      if (url.pathname === '/admin/api/webhooks' && method === 'GET') return reply({ webhooks: [HOOK], events: [] });
      if (url.pathname === '/admin/api/webhooks' && method === 'POST') return reply({ ...HOOK, ...body, id: 'wh_2' }, 201);
      if (url.pathname === '/admin/api/webhooks/wh_1' && method === 'PATCH') return reply({ ...HOOK, ...body });
      if (url.pathname === '/admin/api/knowledge/gaps') return reply({ gaps: [GAP], counts: { open: 1, answered: 0, dismissed: 0 } });
      if (url.pathname === '/admin/api/knowledge/gaps/gap_1/answer') return reply({ gap: { ...GAP, status: 'answered' }, entry: { id: 'gap-1', chunks: 1 } });
      if (url.pathname === '/admin/api/knowledge/gaps/gap_1' && method === 'PATCH') return reply({ ...GAP, ...body });
      return reply({ error: { code: 'not_found', message: 'No.' } }, 404);
    }),
  );
  return sent;
}

async function run(args: string[]) {
  let out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const code = await main([...args, '--json']);
  vi.mocked(process.stdout.write).mockRestore();
  return { code, json: JSON.parse(out) as Record<string, any> };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('helppuff email', () => {
  it('sets up Resend from a preset, the key taken from .env', async () => {
    const dir = project();
    const sent = worker();
    const { code } = await run(['email', 'set', '--preset', 'resend', '--from', 'HelpPuff <assistant@acme.com>', '--key', '${RESEND_API_KEY}', '--cwd', dir]);
    expect(code).toBe(0);
    const put = sent.find((s) => s.method === 'PUT')!.body!;
    expect(put).toMatchObject({ url: 'https://api.resend.com/emails', method: 'POST' });
    expect(put['headers']).toContainEqual({ name: 'Authorization', value: 'Bearer re_live_42', secret: true });
    expect(JSON.parse(put['body'])).toMatchObject({ from: 'HelpPuff <assistant@acme.com>', to: ['{{email.to}}'], text: '{{email.text}}' });
  });

  it('asks for the key and the sender instead of saving half a service', async () => {
    const dir = project();
    const sent = worker();
    const { code, json } = await run(['email', 'set', '--preset', 'postmark', '--cwd', dir]);
    expect(code).not.toBe(0);
    expect(json['status']).toBe('needs_input');
    expect(json['questions'].map((q: { id: string }) => q.id)).toEqual(['from', 'key']);
    expect(sent.some((s) => s.method === 'PUT')).toBe(false);
  });

  it('writes any other service’s request; a key missing from .env is a question, and nothing is saved', async () => {
    const dir = project('ADMIN_API_KEY=test-key\n');
    const sent = worker();
    const { json } = await run(['email', 'set', '--url', 'https://mail.acme.com/send', '--header', 'X-Api-Key: ${MAIL_KEY}', '--body', '{"to": "{{email.to}}", "text": "{{email.text}}"}', '--cwd', dir]);
    expect(json['status']).toBe('needs_input');
    expect(json['questions'][0]).toMatchObject({ id: 'MAIL_KEY', kind: 'secret' });
    expect(sent.some((s) => s.method === 'PUT')).toBe(false);
  });

  it('sends a test to the address given, and asks for one when there is none', async () => {
    const dir = project();
    const sent = worker();
    expect((await run(['email', 'test', '--cwd', dir])).json['status']).toBe('needs_input');
    const { code, json } = await run(['email', 'test', '--to', 'me@acme.com', '--cwd', dir]);
    expect(code).toBe(0);
    expect(json).toMatchObject({ ok: true, to: 'me@acme.com' });
    expect(sent.find((s) => s.path.endsWith('/test'))!.body).toMatchObject({ to: 'me@acme.com' });
  });

  it('pauses and resumes every email', async () => {
    const dir = project();
    const sent = worker();
    await run(['email', 'pause', '--cwd', dir]);
    await run(['email', 'resume', '--cwd', dir]);
    expect(sent.filter((s) => s.method === 'PUT').map((s) => s.body!['enabled'])).toEqual([false, true]);
  });
});

describe('helppuff webhooks, your own request', () => {
  it('adds a custom webhook from --header and --body, the token from .env and stored as a secret', async () => {
    const dir = project();
    const sent = worker();
    const { code } = await run([
      'webhooks',
      'add',
      'https://slack.com/api/chat.postMessage',
      '--events',
      'callback.requested',
      '--header',
      'Authorization: Bearer ${SLACK_BOT_TOKEN}',
      '--body',
      '{"channel": "#office", "text": "Call {{data.name}}"}',
      '--cwd',
      dir,
    ]);
    expect(code).toBe(0);
    expect(sent.find((s) => s.method === 'POST')!.body).toMatchObject({
      url: 'https://slack.com/api/chat.postMessage',
      format: 'custom',
      events: ['callback.requested'],
      headers: [{ name: 'Authorization', value: 'Bearer xoxb-42', secret: true }],
      body: '{"channel": "#office", "text": "Call {{data.name}}"}',
    });
  });

  it('goes back to the signed JSON with --format helppuff, and refuses another format', async () => {
    const dir = project();
    const sent = worker();
    expect((await run(['webhooks', 'set', 'wh_1', '--format', 'helppuff', '--cwd', dir])).code).toBe(0);
    expect(sent.find((s) => s.method === 'PATCH')!.body).toMatchObject({ format: 'helppuff' });
    expect((await run(['webhooks', 'set', 'wh_1', '--format', 'xml', '--cwd', dir])).code).not.toBe(0);
  });
});

describe('helppuff knowledge: questions to answer', () => {
  it('lists them, asks for the owner\'s answer instead of making one up, and saves it once given', async () => {
    const dir = project();
    const sent = worker();
    const listed = await run(['knowledge', 'gaps', '--cwd', dir]);
    expect(listed.json['gaps']).toMatchObject([{ id: 'gap_1', count: 3 }]);
    const asked = await run(['knowledge', 'answer', 'gap_1', '--cwd', dir]);
    expect(asked.json['status']).toBe('needs_input');
    expect(sent.some((s) => s.path.endsWith('/answer'))).toBe(false);
    expect((await run(['knowledge', 'answer', 'gap_1', '--text', 'No: natural gas only.', '--cwd', dir])).code).toBe(0);
    expect(sent.find((s) => s.path.endsWith('/answer'))!.body).toMatchObject({ answer: 'No: natural gas only.' });
    expect((await run(['knowledge', 'dismiss', 'gap_1', '--cwd', dir])).code).toBe(0);
    expect(sent.find((s) => s.method === 'PATCH')!.body).toMatchObject({ status: 'dismissed' });
  });
});

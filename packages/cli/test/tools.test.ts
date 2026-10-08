import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { tempProject } from './helpers.js';

/**
 * `helppuff tools` against a fake Worker: a tool from a curl with its key
 * read from .env (never typed), an extract tool, a missing key as
 * needs_input, and a change by name.
 */

const TOOL = { id: 'tool_1', name: 'order_status', kind: 'http', description: 'Orders', method: 'GET', url: 'https://api.acme.com/orders/{{args.order_number}}', headers: [{ name: 'Authorization', value: '', secret: true, set: true }], keys: [], before: false, after: false, enabled: true, lastStatus: null, lastError: null };

function project(env = 'ADMIN_API_KEY=test-key\nACME_API_KEY=sk_live_42\n') {
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
      if (url.pathname === '/admin/api/tools' && method === 'GET') return reply({ tools: [TOOL], assistant: true, prechat: [] });
      if (url.pathname === '/admin/api/tools' && method === 'POST') return reply({ ...TOOL, ...body, id: 'tool_2', headers: [] }, 201);
      if (url.pathname === '/admin/api/tools/tool_1' && method === 'PATCH') return reply({ ...TOOL, ...body });
      if (url.pathname === '/admin/api/tools/test') return reply({ ok: true, status: 200, ms: 90, error: null, value: { status: 'shipped' }, keys: ['status'] });
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

describe('helppuff tools', () => {
  it('adds a tool from a curl, its key taken from .env', async () => {
    const dir = project();
    const sent = worker();
    const curl = `curl https://api.acme.com/orders/{{args.order_number}} -H 'Authorization: Bearer \${ACME_API_KEY}' -H 'Accept: application/json'`;
    const { code } = await run(['tools', 'add', 'order_status', '--curl', curl, '--description', 'Look up an order, by number', '--param', 'order_number=Like A-1042, or B-7', '--cwd', dir]);
    expect(code).toBe(0);
    expect(sent.find((s) => s.method === 'POST')!.body).toEqual({
      site: 'acme',
      name: 'order_status',
      kind: 'http',
      method: 'GET',
      url: 'https://api.acme.com/orders/{{args.order_number}}',
      body: '',
      description: 'Look up an order, by number',
      headers: [
        { name: 'Authorization', value: 'Bearer sk_live_42', secret: true },
        { name: 'Accept', value: 'application/json', secret: false },
      ],
      parameters: [{ name: 'order_number', description: 'Like A-1042, or B-7', required: true }],
    });
  });

  it('asks for a key that is not in .env, and saves nothing', async () => {
    const dir = project('ADMIN_API_KEY=test-key\n');
    const sent = worker();
    const { code, json } = await run(['tools', 'add', 'crm', '--url', 'https://crm.acme.com/x', '--header', 'X-Api-Key: ${CRM_KEY}', '--description', 'CRM', '--cwd', dir]);
    expect(code).toBe(10);
    expect(json).toMatchObject({ status: 'needs_input', questions: [{ id: 'CRM_KEY', flag: 'secret set CRM_KEY' }] });
    expect(sent.some((s) => s.method === 'POST')).toBe(false);
  });

  it('adds an extract tool, changes one by name, and tests it', async () => {
    const dir = project();
    const sent = worker();
    expect((await run(['tools', 'add', 'order_number', '--extract', '--field', 'order_number=Like A-1042', '--description', 'Save it', '--cwd', dir])).code).toBe(0);
    expect(sent.at(-1)!.body).toMatchObject({ kind: 'extract', fields: [{ name: 'order_number', description: 'Like A-1042', required: true }] });

    await run(['tools', 'set', 'order_status', '--before', '--no-after', '--cwd', dir]);
    expect(sent.find((s) => s.method === 'PATCH')!.body).toEqual({ site: 'acme', before: true, after: false });

    const tested = await run(['tools', 'test', 'order_status', '--arg', 'order_number=A-1042', '--cwd', dir]);
    expect(tested.json).toMatchObject({ ok: true, value: { status: 'shipped' } });
    expect(sent.at(-1)!.body).toEqual({ site: 'acme', id: 'tool_1', sample: { args: { order_number: 'A-1042' }, prechat: {} } });
  });
});

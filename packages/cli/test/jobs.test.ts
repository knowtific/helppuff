import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { tempProject } from './helpers.js';

/**
 * `helppuff jobs` against a fake Worker: a job named by its number, a stage
 * by its name, and what is sent to the admin API.
 */

const STAGES = [
  { id: 'stg_new', name: 'New request', kind: 'open' },
  { id: 'stg_quote', name: 'Quote sent', kind: 'open' },
  { id: 'stg_lost', name: 'Lost', kind: 'lost' },
];
const JOB = { id: 'job_1', number: 1042, title: 'Hot water in Glebe', stage: STAGES[0], status: 'open', fields: {}, contact: null, value: null, currency: null, stale: false };

function project() {
  return tempProject({
    'helppuff.json': JSON.stringify({ site: 'acme', name: 'Acme', origins: ['https://acme.com'], backend: { type: 'workers-ai' }, cloudflare: { url: 'https://acme.workers.dev' } }),
    'prompt.md': 'You help Acme.',
    '.env': 'ADMIN_API_KEY=test-key\n',
  });
}

function worker() {
  const sent: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      sent.push({ method, path: url.pathname + url.search, body });
      const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.pathname === '/admin/api/jobs/pipeline') return reply({ pipeline: { stages: STAGES, fields: [] } });
      if (url.pathname === '/admin/api/jobs' && method === 'GET') return reply({ items: url.searchParams.get('q') === '1042' ? [JOB] : [], stages: [] });
      if (url.pathname === '/admin/api/jobs' && method === 'POST') return reply({ ...JOB, number: 1043, title: String(body?.['title'] ?? '') }, 201);
      if (url.pathname === '/admin/api/jobs/job_1/move') return reply({ ...JOB, stage: STAGES.find((s) => s.id === body?.['stageId']) });
      return reply({ error: { code: 'not_found', message: 'No such job.' } }, 404);
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
  const code = await main([...args, '--json']);
  vi.mocked(process.stdout.write).mockRestore();
  return { code, json: JSON.parse(out) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('helppuff jobs', () => {
  it('moves a job named by its number to a stage named in words, with the reason', async () => {
    const dir = project();
    const sent = worker();
    const { code } = await run(['jobs', 'move', '#1042', 'lost', '--reason', 'Too far', '--cwd', dir]);
    expect(code).toBe(0);
    expect(sent.find((s) => s.method === 'POST')).toMatchObject({ path: '/admin/api/jobs/job_1/move', body: { site: 'acme', stageId: 'stg_lost', lostReason: 'Too far' } });
  });

  it('refuses a stage that does not exist, naming the ones that do', async () => {
    const dir = project();
    worker();
    const { code, json } = await run(['jobs', 'move', '1042', 'Invoiced', '--cwd', dir]);
    expect(code).not.toBe(0);
    expect(JSON.stringify(json)).toContain('New request, Quote sent, Lost');
  });

  it('creates a job from flags, and asks for something to go on without any', async () => {
    const dir = project();
    const sent = worker();
    const made = await run(['jobs', 'create', '--title', 'Leaking tank', '--email', 'ada@example.com', '--fields', '{"service":"Hot water"}', '--value', '450', '--cwd', dir]);
    expect(made.code).toBe(0);
    expect(sent.find((s) => s.method === 'POST')!.body).toEqual({ site: 'acme', title: 'Leaking tank', fields: { service: 'Hot water' }, contact: { email: 'ada@example.com' }, value: 450 });
    const empty = await run(['jobs', 'create', '--cwd', dir]);
    expect(empty.code).not.toBe(0);
    expect(JSON.stringify(empty.json)).toContain('needs_input');
  });
});

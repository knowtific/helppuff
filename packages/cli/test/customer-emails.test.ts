import { describe, expect, it } from 'vitest';
import { CloudflareApi } from '../src/engine/cloudflare.js';
import { compile } from '../src/engine/compile.js';
import { normalizeSubdomain, removeReplies, repliesState, setUpReplies, suggestSubdomain } from '../src/engine/email-replies.js';
import { parseProject } from '../src/engine/project.js';
import { cf, fakeFetch, tempProject } from './helpers.js';

/** Customer emails, the CLI's side: Email Routing for answers by email, and Cloudflare Email Service's binding. */
const WORKER = 'knowtific-helppuff-acme';
const ZONE = '/client/v4/zones/z1';
const zone = (url: URL) => (url.pathname === '/client/v4/zones' ? cf(url.searchParams.get('name') === 'acme.com' ? [{ id: 'z1', name: 'acme.com' }] : []) : undefined);

/** A zone whose subdomains start with no mail; enabling Email Routing adds Cloudflare's MX records. */
function cloudflare(options: { mx?: { content: string }[]; rules?: Record<string, unknown>[]; subaddress?: boolean } = {}) {
  let mx = options.mx ?? [];
  let rules = options.rules ?? [];
  return fakeFetch([
    zone,
    (url) => (url.pathname === `${ZONE}/dns_records` ? cf(url.searchParams.get('name') === 'chat.acme.com' ? mx : []) : undefined),
    (url, init) => {
      if (url.pathname !== `${ZONE}/email/routing/dns` || init.method !== 'POST') return undefined;
      mx = [{ content: 'route1.mx.cloudflare.net' }, { content: 'route2.mx.cloudflare.net' }];
      return cf({ id: 'z1', name: 'chat.acme.com', enabled: true, status: 'ready' });
    },
    (url) => (url.pathname === `${ZONE}/email/routing` ? cf({ enabled: true, support_subaddress: options.subaddress ?? true }) : undefined),
    (url, init) => {
      if (url.pathname === `${ZONE}/email/routing/rules` && (init.method ?? 'GET') === 'GET') return cf(rules);
      if (url.pathname === `${ZONE}/email/routing/rules` && init.method === 'POST') {
        const rule = { id: 'r1', ...(JSON.parse(String(init.body)) as object) };
        rules = [...rules, rule];
        return cf(rule);
      }
      if (url.pathname.startsWith(`${ZONE}/email/routing/rules/`) && init.method === 'PUT') {
        const rule = { id: url.pathname.split('/').pop(), ...(JSON.parse(String(init.body)) as object) };
        rules = rules.map((r) => (r['id'] === rule.id ? rule : r));
        return cf(rule);
      }
      if (url.pathname.startsWith(`${ZONE}/email/routing/rules/`) && init.method === 'DELETE') {
        rules = rules.filter((r) => r['id'] !== url.pathname.split('/').pop());
        return cf(null);
      }
      return undefined;
    },
  ]);
}

describe('answers by email: Email Routing', () => {
  it('turns it on for the subdomain and hands reply@ to the Worker with one literal rule', async () => {
    const { fetch, calls } = cloudflare();
    const state = await setUpReplies(new CloudflareApi('t', fetch), 'chat.acme.com', WORKER, undefined, 0);
    expect(state).toMatchObject({ subdomain: 'chat.acme.com', receiving: true, subaddressing: true, rule: { id: 'r1', worker: WORKER, enabled: true } });
    const enable = calls.find((c) => c.url.endsWith('/email/routing/dns') && c.method === 'POST')!;
    expect(JSON.parse(String(enable.body))).toEqual({ name: 'chat.acme.com' });
    const rule = calls.find((c) => c.url.endsWith('/email/routing/rules') && c.method === 'POST')!;
    expect(JSON.parse(String(rule.body))).toMatchObject({ enabled: true, matchers: [{ type: 'literal', field: 'to', value: 'reply@chat.acme.com' }], actions: [{ type: 'worker', value: [WORKER] }] });
  });

  it('is safe to run again: the rule is pointed at the Worker, not added twice', async () => {
    const existing = { id: 'r9', enabled: true, matchers: [{ type: 'literal', field: 'to', value: 'reply@chat.acme.com' }], actions: [{ type: 'worker', value: ['old-worker'] }] };
    const { fetch, calls } = cloudflare({ mx: [{ content: 'route1.mx.cloudflare.net' }], rules: [existing] });
    const state = await setUpReplies(new CloudflareApi('t', fetch), 'chat.acme.com', WORKER, undefined, 0);
    expect(state.rule).toMatchObject({ id: 'r9', worker: WORKER });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('never takes over an inbox: not the domain itself, not a name that gets mail elsewhere, not a domain off Cloudflare', async () => {
    const api = (mx?: { content: string }[]) => new CloudflareApi('t', cloudflare(mx ? { mx } : {}).fetch);
    await expect(setUpReplies(api(), 'acme.com', WORKER)).rejects.toMatchObject({ code: 'email_apex' });
    await expect(setUpReplies(api([{ content: 'aspmx.l.google.com' }]), 'chat.acme.com', WORKER)).rejects.toMatchObject({ code: 'email_mx_in_use' });
    await expect(setUpReplies(api(), 'chat.other.org', WORKER)).rejects.toMatchObject({ code: 'email_domain_not_on_cloudflare' });
  });

  it('reports sub-addressing off, and removes only its own rule', async () => {
    const { fetch } = cloudflare({ subaddress: false });
    const api = new CloudflareApi('t', fetch);
    await setUpReplies(api, 'chat.acme.com', WORKER, undefined, 0);
    expect((await repliesState(api, 'chat.acme.com')).subaddressing).toBe(false);
    expect(await removeReplies(api, 'chat.acme.com', undefined)).toBe(true);
    expect((await repliesState(api, 'chat.acme.com')).rule).toBeNull();
  });

  it('suggests chat.<the website> and reads a pasted address', () => {
    expect(suggestSubdomain('https://www.acme.com/')).toBe('chat.acme.com');
    expect(normalizeSubdomain('https://Chat.Acme.com/')).toBe('chat.acme.com');
    expect(() => normalizeSubdomain('not a domain')).toThrow();
  });
});

describe('Cloudflare Email Service', () => {
  const project = (extra: Record<string, unknown> = {}) => {
    const raw = { site: 'acme', name: 'Acme', website: 'https://acme.com', origins: ['https://acme.com'], backend: { type: 'echo' }, ...extra };
    const dir = tempProject({ 'prompt.md': 'You help Acme customers.' });
    return { dir, file: `${dir}/helppuff.json`, raw, project: parseProject(raw) };
  };

  it('adds the send_email binding only once it is chosen', () => {
    expect(compile(project()).wrangler['send_email']).toBeUndefined();
    expect(compile(project({ email: { cloudflare: { from: 'hello@chat.acme.com' } } })).wrangler['send_email']).toEqual([{ name: 'HELPPUFF_EMAIL' }]);
  });

  it('compiles the customer emails into the live config', () => {
    const compiled = compile(project({ customerEmails: { replies: { enabled: true }, inbound: { domain: 'chat.acme.com', ruleId: 'r1' } } }));
    expect((compiled.storedConfig as Record<string, unknown>)['customerEmails']).toMatchObject({ copy: { enabled: false }, replies: { enabled: true }, inbound: { enabled: false, domain: 'chat.acme.com', ruleId: 'r1' } });
  });
});

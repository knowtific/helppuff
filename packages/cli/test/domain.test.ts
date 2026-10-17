import { describe, expect, it } from 'vitest';
import { CloudflareApi } from '../src/engine/cloudflare.js';
import { attachDomain, normalizeHostname, onPublicUrl, publicUrl } from '../src/engine/domain.js';
import { cf, fakeFetch } from './helpers.js';

/** `helppuff domain`: a custom domain through Workers Custom Domains. */
const ACCOUNT = 'a'.repeat(32);
const domains = `/client/v4/accounts/${ACCOUNT}/workers/domains`;
const WORKER = 'knowtific-helppuff-acme';
const refused = (message: string, status = 409) => Response.json({ success: false, errors: [{ code: 100117, message }], result: null }, { status });
const zone = (url: URL) => (url.pathname === '/client/v4/zones' ? cf(url.searchParams.get('name') === 'acme.com' ? [{ id: 'z1', name: 'acme.com' }] : []) : undefined);

describe('normalizeHostname', () => {
  it('takes a pasted address down to its hostname', () => {
    expect(normalizeHostname('https://Chat.Acme.com/')).toBe('chat.acme.com');
    expect(normalizeHostname('chat.acme.com.')).toBe('chat.acme.com');
  });

  it('refuses what is not a domain, and workers.dev', () => {
    for (const bad of ['acme', 'chat acme.com', '-x.acme.com', 'x.you.workers.dev']) {
      expect(() => normalizeHostname(bad)).toThrow(expect.objectContaining({ code: 'invalid_domain' }));
    }
  });
});

describe('publicUrl', () => {
  it('is the custom domain when there is one, else workers.dev', () => {
    expect(publicUrl({ cloudflare: { url: 'https://w.you.workers.dev/' } })).toBe('https://w.you.workers.dev');
    expect(publicUrl({ cloudflare: { url: 'https://w.you.workers.dev', domain: 'chat.acme.com' } })).toBe('https://chat.acme.com');
    expect(onPublicUrl('https://w.you.workers.dev/admin/?setup=abc', { cloudflare: { url: 'https://w.you.workers.dev', domain: 'chat.acme.com' } })).toBe('https://chat.acme.com/admin/?setup=abc');
  });
});

describe('attachDomain', () => {
  it("attaches the hostname to the Worker in its zone", async () => {
    const { fetch, calls } = fakeFetch([zone, (url, init) => (url.pathname === domains && init.method === 'PUT' ? cf({ id: 'd1', hostname: 'chat.acme.com', service: WORKER, zone_id: 'z1', zone_name: 'acme.com' }) : undefined)]);
    const attached = await attachDomain(new CloudflareApi('t', fetch), ACCOUNT, WORKER, 'chat.acme.com');
    expect(attached).toMatchObject({ id: 'd1', hostname: 'chat.acme.com' });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(JSON.parse(String(put.body))).toEqual({ hostname: 'chat.acme.com', service: WORKER, zone_id: 'z1', zone_name: 'acme.com' });
  });

  it('says to delete the DNS record that is in the way', async () => {
    const { fetch } = fakeFetch([zone, (url) => (url.pathname === domains ? refused('Hostname already has externally managed DNS records (A, CNAME, etc).') : undefined)]);
    await expect(attachDomain(new CloudflareApi('t', fetch), ACCOUNT, WORKER, 'chat.acme.com')).rejects.toMatchObject({ code: 'domain_dns_conflict', hint: expect.stringContaining('DNS') });
  });

  it('says to add the domain to Cloudflare when no zone serves it', async () => {
    const { fetch } = fakeFetch([zone, (url) => (url.pathname === domains ? refused('Zone not found', 400) : undefined)]);
    await expect(attachDomain(new CloudflareApi('t', fetch), ACCOUNT, WORKER, 'chat.other.org')).rejects.toMatchObject({ code: 'domain_not_on_cloudflare' });
  });

  it('lists and detaches', async () => {
    const { fetch, calls } = fakeFetch([
      (url, init) => (url.pathname === domains && (init.method ?? 'GET') === 'GET' ? cf([{ id: 'd1', hostname: 'chat.acme.com', service: WORKER, zone_id: 'z1', zone_name: 'acme.com' }]) : undefined),
      (url, init) => (url.pathname === `${domains}/d1` && init.method === 'DELETE' ? cf(null) : undefined),
    ]);
    const api = new CloudflareApi('t', fetch);
    expect((await api.workerDomains(ACCOUNT, WORKER)).map((d) => d.hostname)).toEqual(['chat.acme.com']);
    expect(new URL(calls[0]!.url).searchParams.get('service')).toBe(WORKER);
    await api.detachWorkerDomain(ACCOUNT, 'd1');
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE' });
  });
});

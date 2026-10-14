import { describe, expect, it } from 'vitest';
import { CloudflareApi } from '../src/engine/cloudflare.js';
import { filesStorageWarning } from '../src/engine/deploy.js';
import { cf, fakeFetch } from './helpers.js';

/** The R2 bucket for photos and files: found, made, or reported (never a failed deploy). */
describe('ensureR2Bucket', () => {
  const ACCOUNT = 'a'.repeat(32);
  const bucket = `/client/v4/accounts/${ACCOUNT}/r2/buckets`;
  const refused = (code: number, status = 403) => Response.json({ success: false, errors: [{ code, message: 'no' }], result: null }, { status });

  it('uses the bucket that exists', async () => {
    const { fetch, calls } = fakeFetch([(url) => (url.pathname === `${bucket}/knowtific-helppuff-acme` ? cf({ name: 'knowtific-helppuff-acme' }) : undefined)]);
    expect(await new CloudflareApi('t', fetch).ensureR2Bucket(ACCOUNT, 'knowtific-helppuff-acme')).toBe('ready');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('makes it when missing (404, code 10006)', async () => {
    const { fetch, calls } = fakeFetch([
      (url, init) => (url.pathname === `${bucket}/knowtific-helppuff-acme` && (init.method ?? 'GET') === 'GET' ? refused(10006, 404) : undefined),
      (url, init) => (url.pathname === bucket && init.method === 'POST' ? cf({ name: 'knowtific-helppuff-acme' }) : undefined),
    ]);
    expect(await new CloudflareApi('t', fetch).ensureR2Bucket(ACCOUNT, 'knowtific-helppuff-acme')).toBe('created');
    expect(JSON.parse(String(calls[1]!.body))).toEqual({ name: 'knowtific-helppuff-acme' });
  });

  it('reports R2 not turned on for the account (10042), and a token without R2', async () => {
    const notEntitled = fakeFetch([() => refused(10042)]);
    expect(await new CloudflareApi('t', notEntitled.fetch).ensureR2Bucket(ACCOUNT, 'b')).toBe('not_enabled');
    const noAccess = fakeFetch([() => refused(10000)]);
    expect(await new CloudflareApi('t', noAccess.fetch).ensureR2Bucket(ACCOUNT, 'b')).toBe('no_access');
    expect(filesStorageWarning('not_enabled')).toMatch(/dash\.cloudflare\.com.*r2.*helppuff deploy/);
    expect(filesStorageWarning('no_access')).toMatch(/Workers R2 Storage › Edit/);
  });
});

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

/** `helppuff destroy` takes the bucket too: emptied first, since Cloudflare refuses a bucket with files in it. */
describe('deleteR2Bucket', () => {
  const ACCOUNT = 'a'.repeat(32);
  const bucket = `/client/v4/accounts/${ACCOUNT}/r2/buckets/knowtific-helppuff-acme`;

  it('deletes every file, listing until the bucket is empty, then the bucket', async () => {
    const pages = [[{ key: 'files/1/photo.jpg' }, { key: 'files/2/quote.pdf' }], [{ key: 'files/3/plan.png' }], []];
    const { fetch, calls } = fakeFetch([
      (url, init) => ((init.method ?? 'GET') === 'GET' && url.pathname === `${bucket}/objects` ? cf(pages.shift() ?? []) : undefined),
      (url, init) => (init.method === 'DELETE' ? cf({}) : undefined),
    ]);
    expect(await new CloudflareApi('t', fetch).deleteR2Bucket(ACCOUNT, 'knowtific-helppuff-acme')).toBe(3);
    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => new URL(c.url).pathname);
    expect(deletes).toEqual([`${bucket}/objects/files%2F1%2Fphoto.jpg`, `${bucket}/objects/files%2F2%2Fquote.pdf`, `${bucket}/objects/files%2F3%2Fplan.png`, bucket]);
  });

  it('knows whether there is a bucket to delete', async () => {
    const refused = (code: number, status = 403) => Response.json({ success: false, errors: [{ code, message: 'no' }], result: null }, { status });
    expect(await new CloudflareApi('t', fakeFetch([() => cf({ name: 'b' })]).fetch).r2BucketExists(ACCOUNT, 'b')).toBe(true);
    expect(await new CloudflareApi('t', fakeFetch([() => refused(10006, 404)]).fetch).r2BucketExists(ACCOUNT, 'b')).toBe(false);
    expect(await new CloudflareApi('t', fakeFetch([() => refused(10042)]).fetch).r2BucketExists(ACCOUNT, 'b')).toBe(false);
  });
});

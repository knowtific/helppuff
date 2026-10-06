import { describe, expect, it } from 'vitest';
import { isHelpPuffError } from '../src/core/errors.js';
import { issueToken, verifyToken } from '../src/core/token.js';
import { SECRET } from './helpers.js';

const base = { siteId: 'demo', sessionId: 's1', state: { chatId: 'c1' }, count: 0, ttlMs: 60_000 };

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => isHelpPuffError(error) && error.code === code,
  );
}

describe('session tokens', () => {
  it('round-trips a payload', async () => {
    const { token, expiresAt } = await issueToken(SECRET, base);
    const payload = await verifyToken(SECRET, token);
    expect(payload).toMatchObject({ v: 1, siteId: 'demo', sessionId: 's1', state: { chatId: 'c1' }, count: 0 });
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects a token signed with a different secret', async () => {
    const { token } = await issueToken(SECRET, base);
    await expectCode(verifyToken(`${SECRET}-other`, token), 'unauthorized');
  });

  it('rejects a tampered payload', async () => {
    const { token } = await issueToken(SECRET, base);
    const [body, signature] = token.split('.') as [string, string];
    const decoded = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    decoded.siteId = 'other';
    const forged = btoa(JSON.stringify(decoded)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await expectCode(verifyToken(SECRET, `${forged}.${signature}`), 'unauthorized');
  });

  it('rejects a tampered signature', async () => {
    const { token } = await issueToken(SECRET, base);
    const [body] = token.split('.') as [string, string];
    await expectCode(verifyToken(SECRET, `${body}.AAAA`), 'unauthorized');
  });

  it.each(['', 'nodot', 'a.b.c', '.sig', 'body.'])('rejects the malformed token %o', async (token) => {
    await expectCode(verifyToken(SECRET, token), 'unauthorized');
  });

  it('reports an expired token as session_expired, not unauthorized', async () => {
    const { token } = await issueToken(SECRET, { ...base, ttlMs: 1000, now: Date.now() - 10_000 });
    await expectCode(verifyToken(SECRET, token), 'session_expired');
  });

  it('refuses to sign with a secret under 32 bytes', async () => {
    await expectCode(issueToken('short', base), 'internal');
  });

  it('refuses connector state over 1 kb', async () => {
    const state = { blob: 'x'.repeat(1100) };
    await expectCode(issueToken(SECRET, { ...base, state }), 'internal');
  });

  it('accepts null state', async () => {
    const { token } = await issueToken(SECRET, { ...base, state: null });
    expect((await verifyToken(SECRET, token)).state).toBeNull();
  });
});

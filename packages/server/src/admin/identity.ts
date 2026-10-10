import { Hono } from 'hono';
import type { KvStore } from '@helppuff/connector-types';
import { identitySecret, identityVersion, rotateIdentity } from '../core/identity.js';
import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { assertSameOrigin, currentAdmin, siteParam } from './guard.js';

/**
 * The site's identity secret, for signing visitors in (`core/identity.ts`):
 * shown to admins on the dashboard and to the CLI (`helppuff identity`), and
 * rotated there. Not part of the public API: an API key cannot read it.
 */
export const identityRoutes = new Hono<HonoEnv>();

const kvOf = (c: { get: (key: 'helppuff') => { env: Record<string, unknown> } }): KvStore => {
  const kv = c.get('helppuff').env['HELPPUFF_KV'] as KvStore | undefined;
  if (!kv) throw new HelpPuffError('internal', { message: 'This deployment has no KV namespace.', detail: 'admin_no_kv' });
  return kv;
};

identityRoutes.get('/identity', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const version = await identityVersion(kvOf(c), siteId);
  return c.json({ site: siteId, version, secret: await identitySecret(requireSecret(c.get('helppuff')), siteId, version) });
});

identityRoutes.post('/identity/rotate', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as { site?: unknown };
  const siteId = siteParam(c, body.site);
  const version = await rotateIdentity(kvOf(c), siteId);
  c.get('helppuff').platform.log('identity.rotated', { siteId, version });
  return c.json({ site: siteId, version, secret: await identitySecret(requireSecret(c.get('helppuff')), siteId, version) });
});

import { Hono } from 'hono';
import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { calcomCalendar } from '../integrations/calcom.js';
import { calendlyCalendar } from '../integrations/calendly.js';
import { composioClient, TOOLKITS } from '../integrations/composio.js';
import { ProviderError } from '../integrations/http.js';
import { deleteIntegration, INTEGRATION_INFO, INTEGRATION_KINDS, integrationView, isIntegrationKind, listIntegrations, markIntegration, openIntegration, saveIntegration, validBaseUrl, type IntegrationKind } from '../integrations/store.js';
import { calcomWebhookSecret } from '../integrations/webhook.js';
import { assertAdmin, assertSameOrigin, currentAdmin, db, jsonBody, siteParam } from './guard.js';
import { actorOf } from './inbox.js';

/**
 * Settings → Integrations: the site's keys for other services (Composio,
 * Cal.com, Calendly), saved sealed and live at once, each with a check.
 * Composio's connected accounts (Google Calendar, Outlook) are listed from
 * Composio and added through its Connect Link: picked, never typed.
 */

export const integrationRoutes = new Hono<HonoEnv>();

const fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init);

const kindParam = (value: string | undefined): IntegrationKind => {
  if (!isIntegrationKind(value)) throw new HelpPuffError('bad_request', { message: `The integration is one of: ${INTEGRATION_KINDS.join(', ')}.`, detail: 'integration_kind' });
  return value;
};

integrationRoutes.get('/integrations', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const rows = await listIntegrations(db(c), siteId);
  return c.json({
    items: INTEGRATION_KINDS.map((kind) => {
      const row = rows.find((r) => r.kind === kind);
      return row ? integrationView(row) : { kind, name: INTEGRATION_INFO[kind].name, connected: false, baseUrl: null, status: 'none', lastError: null, lastAt: null, account: null, plan: null, createdAt: null, updatedAt: null };
    }),
    help: INTEGRATION_INFO,
  });
});

/** Check a connection with the service itself; what was learned (the account) is kept. */
async function check(siteId: string, kind: IntegrationKind, secret: string, d: ReturnType<typeof db>, now: number) {
  const integration = await openIntegration(d, secret, siteId, kind);
  if (!integration) throw new HelpPuffError('not_found', { message: `${INTEGRATION_INFO[kind].name} is not connected.`, detail: 'integration_missing' });
  try {
    let detail: string;
    let meta: Record<string, unknown> = {};
    if (kind === 'composio') {
      const accounts = await composioClient({ key: integration.key, userId: siteId, fetch: fetcher }).accounts();
      detail = accounts.length ? `Connected: ${accounts.map((a) => `${a.toolkit} · ${a.label}`).join(', ')}.` : 'The key works. Connect a calendar account next.';
    } else if (kind === 'calcom') {
      const result = await calcomCalendar({ key: integration.key, baseUrl: integration.baseUrl, fetch: fetcher }).test();
      detail = result.detail;
    } else {
      const result = await calendlyCalendar({ key: integration.key, fetch: fetcher }).test();
      detail = result.detail;
      meta = result.meta ?? {};
    }
    await markIntegration(d, integration.row, { ok: true, meta }, now);
    return { ok: true, detail };
  } catch (thrown) {
    const detail = thrown instanceof ProviderError ? thrown.message : 'The service could not be reached.';
    await markIntegration(d, integration.row, { ok: false, error: detail }, now);
    return { ok: false, detail };
  }
}

/** Save a key (and a self-hosted Cal.com's API base URL), then check it. */
integrationRoutes.put('/integrations/:kind', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  assertAdmin(admin);
  const kind = kindParam(c.req.param('kind'));
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const ctx = c.get('helppuff');
  const secret = requireSecret(ctx);
  const d = db(c);
  await saveIntegration(
    d,
    secret,
    { siteId, kind, key: typeof body['key'] === 'string' ? body['key'] : null, ...(kind === 'calcom' && body['baseUrl'] !== undefined ? { baseUrl: validBaseUrl(body['baseUrl']) } : {}), by: actorOf(admin) },
    ctx.platform.now(),
  );
  const result = await check(siteId, kind, secret, d, ctx.platform.now());
  const rows = await listIntegrations(d, siteId);
  return c.json({ ...integrationView(rows.find((r) => r.kind === kind)!), check: result });
});

integrationRoutes.post('/integrations/:kind/test', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const kind = kindParam(c.req.param('kind'));
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const ctx = c.get('helppuff');
  return c.json(await check(siteId, kind, requireSecret(ctx), db(c), ctx.platform.now()));
});

integrationRoutes.delete('/integrations/:kind', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const kind = kindParam(c.req.param('kind'));
  const siteId = siteParam(c, c.req.query('site'));
  const removed = await deleteIntegration(db(c), siteId, kind);
  if (!removed) throw new HelpPuffError('not_found', { message: `${INTEGRATION_INFO[kind].name} is not connected.`, detail: 'integration_missing' });
  return c.json({ kind, deleted: true });
});

/** Composio's connected accounts for this site (Google Calendar, Outlook…), to pick from. */
integrationRoutes.get('/integrations/composio/accounts', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const integration = await openIntegration(db(c), requireSecret(c.get('helppuff')), siteId, 'composio');
  if (!integration) throw new HelpPuffError('not_found', { message: 'Connect Composio first (its API key).', detail: 'integration_missing' });
  const toolkit = c.req.query('toolkit');
  const slug = toolkit === 'google' ? TOOLKITS.google : toolkit === 'outlook' ? TOOLKITS.outlook : undefined;
  try {
    return c.json({ items: await composioClient({ key: integration.key, userId: siteId, fetch: fetcher }).accounts(slug) });
  } catch (thrown) {
    throw new HelpPuffError('connector_error', { message: thrown instanceof ProviderError ? `Composio: ${thrown.message}` : 'Composio could not be reached.', detail: 'composio_failed' });
  }
});

/** A Connect Link: the owner signs in to Google Calendar or Outlook at Composio, then comes back. */
integrationRoutes.post('/integrations/composio/connect', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const toolkit = body['toolkit'] === 'google' ? TOOLKITS.google : body['toolkit'] === 'outlook' ? TOOLKITS.outlook : null;
  if (!toolkit) throw new HelpPuffError('bad_request', { message: 'toolkit is google or outlook.', detail: 'composio_toolkit' });
  const integration = await openIntegration(db(c), requireSecret(c.get('helppuff')), siteId, 'composio');
  if (!integration) throw new HelpPuffError('not_found', { message: 'Connect Composio first (its API key).', detail: 'integration_missing' });
  const back = typeof body['returnUrl'] === 'string' && /^https:\/\//.test(body['returnUrl']) ? body['returnUrl'] : `${new URL(c.req.url).origin}/admin/#/settings/integrations`;
  try {
    return c.json({ url: await composioClient({ key: integration.key, userId: siteId, fetch: fetcher }).connectLink(toolkit, back) });
  } catch (thrown) {
    throw new HelpPuffError('connector_error', { message: thrown instanceof ProviderError ? `Composio: ${thrown.message}` : 'Composio could not be reached.', detail: 'composio_failed' });
  }
});

/** Where Cal.com sends its webhook, and the secret to give it: changes there show at once. */
integrationRoutes.get('/integrations/calcom/webhook', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const secret = await calcomWebhookSecret(requireSecret(c.get('helppuff')), siteId);
  return c.json({ url: `${new URL(c.req.url).origin}/v1/integrations/calcom/${encodeURIComponent(siteId)}`, secret, triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'] });
});

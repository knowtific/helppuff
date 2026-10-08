import { Hono } from 'hono';
import { PROTOCOL_VERSION } from '@helppuff/protocol';
import type { HelpPuffConfig } from './config/schema.js';
import { HelpPuffError, toHelpPuffError } from './core/errors.js';
import { corsHeaders } from './core/origin.js';
import { allConfiguredOrigins, buildRequestCtx, type HonoEnv } from './core/request.js';
import { configRoutes } from './routes/config.js';
import { messageRoutes } from './routes/messages.js';
import { sessionRoutes } from './routes/sessions.js';
import { adminRoutes } from './admin/routes.js';
import { retellRoutes } from './routes/retell.js';
import { liveSocketRoutes } from './routes/live.js';
import { deployedVersion } from './admin/version.js';
import { LATEST_MIGRATION } from './db/migrations.js';

export function createApp(config: HelpPuffConfig): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  const origins = allConfiguredOrigins(config);

  app.use('*', async (c, next) => {
    c.set('helppuff', buildRequestCtx(c, config));

    // CORS reflection only decides what the browser may read. Authorization is
    // enforced per site inside each route. The public API sends none: its keys
    // belong on servers, never in a browser.
    const publicApi = c.req.path.startsWith('/api/');
    const headers: Record<string, string> = publicApi ? { 'X-Request-Id': `req_${crypto.randomUUID()}` } : corsHeaders(c.req.header('Origin'), origins);

    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    await next();
    // A WebSocket's 101 (live chat) comes from the hub with headers that cannot change.
    if (c.res.status === 101) return;
    for (const [key, value] of Object.entries(headers)) c.res.headers.set(key, value);

    // Session endpoints must never be cached.
    if (c.req.path.includes('/sessions')) c.res.headers.set('Cache-Control', 'no-store');
  });

  // `version` is the release that deployed this Worker (null in development); `schema` the D1 migration it expects.
  app.get('/healthz', (c) => c.json({ ok: true, protocol: PROTOCOL_VERSION, version: deployedVersion(c.get('helppuff').env), schema: LATEST_MIGRATION }));

  // Live chat's sockets and Telegram's webhook, ahead of the admin router (see routes/live.ts).
  app.route('/', liveSocketRoutes);
  app.route('/', configRoutes);
  app.route('/', sessionRoutes);
  app.route('/', messageRoutes);
  // One API, two doors: the dashboard (and the CLI, with the admin key) at
  // /admin/api, and the public, versioned API at /api/v1 (API keys only; see
  // api/auth.ts). Same handlers, so the two can never drift apart.
  app.route('/admin/api', adminRoutes);
  app.route('/api/v1', adminRoutes);
  app.route('/', retellRoutes);

  app.notFound(() => {
    throw new HelpPuffError('not_found', { detail: 'no_route' });
  });

  /**
   * The single exit for every failure. Always the JSON envelope, never an HTML
   * error page — the widget's parser must always have something valid to read.
   */
  app.onError((thrown, c) => {
    const error = toHelpPuffError(thrown);
    c.get('helppuff')?.platform.log('request.error', {
      code: error.code,
      detail: error.detail ?? 'none',
      path: c.req.path,
    });

    const headers = new Headers(c.req.path.startsWith('/api/') ? { 'X-Request-Id': `req_${crypto.randomUUID()}` } : corsHeaders(c.req.header('Origin'), origins));
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'no-store');
    if (error.retryAfter !== undefined) headers.set('Retry-After', String(error.retryAfter));

    return new Response(JSON.stringify(error.toEnvelope()), { status: error.status, headers });
  });

  return app;
}

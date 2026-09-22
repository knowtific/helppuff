import { Hono } from 'hono';
import { PROTOCOL_VERSION } from '@murmur/protocol';
import type { MurmurConfig } from './config/schema.js';
import { MurmurError, toMurmurError } from './core/errors.js';
import { corsHeaders } from './core/origin.js';
import { allConfiguredOrigins, buildRequestCtx, type HonoEnv } from './core/request.js';
import { configRoutes } from './routes/config.js';
import { messageRoutes } from './routes/messages.js';
import { sessionRoutes } from './routes/sessions.js';

export function createApp(config: MurmurConfig): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  const origins = allConfiguredOrigins(config);

  app.use('*', async (c, next) => {
    c.set('mm', buildRequestCtx(c, config));

    // CORS reflection only decides what the browser may read. Authorization is
    // enforced per site inside each route (§7.2).
    const headers = corsHeaders(c.req.header('Origin'), origins);

    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    await next();
    for (const [key, value] of Object.entries(headers)) c.res.headers.set(key, value);

    // Session endpoints must never be cached (§7.2).
    if (c.req.path.includes('/sessions')) c.res.headers.set('Cache-Control', 'no-store');
  });

  app.get('/healthz', (c) => c.json({ ok: true, protocol: PROTOCOL_VERSION }));

  app.route('/', configRoutes);
  app.route('/', sessionRoutes);
  app.route('/', messageRoutes);

  app.notFound(() => {
    throw new MurmurError('not_found', { detail: 'no_route' });
  });

  /**
   * The single exit for every failure. Always the JSON envelope, never an HTML
   * error page — the widget's parser must always have something valid to read
   * (§8.3).
   */
  app.onError((thrown, c) => {
    const error = toMurmurError(thrown);
    c.get('mm')?.platform.log('request.error', {
      code: error.code,
      detail: error.detail ?? 'none',
      path: c.req.path,
    });

    const headers = new Headers(corsHeaders(c.req.header('Origin'), origins));
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'no-store');
    if (error.retryAfter !== undefined) headers.set('Retry-After', String(error.retryAfter));

    return new Response(JSON.stringify(error.toEnvelope()), { status: error.status, headers });
  });

  return app;
}

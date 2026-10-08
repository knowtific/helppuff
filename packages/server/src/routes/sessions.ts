import { Hono } from 'hono';
import { startSessionRequestSchema, type StartSessionResponse } from '@helppuff/protocol';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { dbFrom } from '../db/d1.js';
import { capabilitiesOf, prepareConnector } from '../core/run.js';
import { liveAvailable } from '../live/service.js';
import { issueToken } from '../core/token.js';
import { startChat } from '../core/chat.js';
import { visitorStanding } from '../core/visitor.js';

export const sessionRoutes = new Hono<HonoEnv>();

/**
 * The widget starts a chat: an allowed site's browser, Turnstile when the site
 * has it, state in the signed session token. The pipeline itself is shared
 * with the public API (`core/chat.ts`).
 */
sessionRoutes.post('/v1/sites/:siteId/sessions', async (c) => {
  const ctx = c.get('helppuff');
  const siteId = c.req.param('siteId');
  const site = await ctx.timing.span('site', () => resolveSite(ctx, siteId));
  assertAllowedOrigin(ctx.origin, site.origins);

  const parsed = startSessionRequestSchema.safeParse(await readJsonBody(c.req.raw));
  if (!parsed.success) throw new HelpPuffError('bad_request', { detail: 'session_body_invalid' });

  const secret = requireSecret(ctx);
  const prepared = prepareConnector(ctx, site);
  return startChat<StartSessionResponse>(c, {
    siteId,
    site,
    prepared,
    input: parsed.data,
    channel: {
      kind: 'widget',
      // A blocked IP stops here, before anything is counted.
      standing: await visitorStanding(ctx, site.security),
      visitor: await ctx.ipKey(),
      captchaToken: parsed.data.captchaToken,
      pageUrl: parsed.data.context.pageUrl,
    },
    respond: async (turn) => {
      const { token, expiresAt } = await issueToken(secret, {
        siteId,
        sessionId: turn.sessionId,
        state: turn.state,
        count: 0,
        forms: turn.forms,
        ttlMs: site.security.sessionTtlHours * 3600_000,
      });
      return {
        body: { sessionToken: token, sessionId: turn.sessionId, expiresAt, messages: turn.messages, capabilities: capabilitiesOf(prepared, Boolean(dbFrom(ctx.env)), liveAvailable(ctx.env, site, siteId)) },
      };
    },
  });
});

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HelpPuffError('bad_request', { detail: 'body_not_json' });
  }
}

import type { SecurityConfig } from '../config/schema.js';
import { HelpPuffError } from './errors.js';
import { ipMatches } from './ip.js';
import type { RequestCtx } from './request.js';

/**
 * Where a visitor stands before any limit is counted:
 *
 *  - on `security.blockIps`: refused, as if the chat were not on this site;
 *  - the owner testing from the CLI, or on `security.allowIps`: `exempt` from
 *    the per-visitor limits (never from the per-chat or daily caps, which
 *    bound cost);
 *  - everyone else: `limited`.
 */
export type Standing = 'exempt' | 'limited';

export async function visitorStanding(ctx: RequestCtx, security: Pick<SecurityConfig, 'allowIps' | 'blockIps'>): Promise<Standing> {
  if (ipMatches(ctx.platform.ip, security.blockIps)) {
    ctx.platform.log('limit.ip_blocked');
    throw new HelpPuffError('forbidden_origin', { message: 'This chat is not available.', detail: 'ip_blocked' });
  }
  if (await ctx.isOwner()) return 'exempt';
  return ipMatches(ctx.platform.ip, security.allowIps) ? 'exempt' : 'limited';
}

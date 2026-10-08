import { z } from 'zod';
import { HANDOVER_STATUSES, messageSchema } from './messages.js';

/**
 * Live chat: a person on the team answers instead of the assistant.
 *
 * The visitor's messages still go through `POST /v1/sessions/messages`; the
 * live socket only carries what the team sends back, so every message passes
 * the same limits, cleaning and recording. The socket's subprotocols are
 * `helppuff.v1` and `t.<session token>` (never the token in the URL: URLs
 * land in logs).
 */

export { HANDOVER_ACTION, LIVE_PING, LIVE_SUBPROTOCOL, LIVE_TOKEN_PROTOCOL } from './handover.js';

/** What the server sends on a live socket. */
export const liveFrameSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('msg'), message: messageSchema }),
  z.object({ t: z.literal('status'), status: z.enum(HANDOVER_STATUSES), agentName: z.string().max(80).optional() }),
  z.object({ t: z.literal('typing'), on: z.boolean() }),
]);
export type LiveFrame = z.infer<typeof liveFrameSchema>;

/** What a visitor may send on it: only typing. Messages go over HTTP. */
export const liveClientFrameSchema = z.object({ t: z.literal('typing'), on: z.boolean() });
export type LiveClientFrame = z.infer<typeof liveClientFrameSchema>;

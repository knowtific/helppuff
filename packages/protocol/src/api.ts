import { z } from 'zod';
import { messageSchema } from './messages.js';

export const errorCodes = [
  'bad_request',
  'unauthorized',
  'forbidden_origin',
  'not_found',
  'rate_limited',
  'quota_exceeded',
  'captcha_failed',
  'connector_error',
  'session_expired',
  'internal',
] as const;

export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** The only error shape any endpoint ever returns (§4). */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    /** Always safe to show a visitor. Never a backend's raw error text. */
    message: z.string().min(1).max(300),
    retryAfter: z.number().int().nonnegative().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const HTTP_STATUS_FOR_ERROR: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden_origin: 403,
  not_found: 404,
  rate_limited: 429,
  quota_exceeded: 429,
  captcha_failed: 403,
  connector_error: 502,
  session_expired: 401,
  internal: 500,
};

export const utmSchema = z
  .object({
    source: z.string().max(200).optional(),
    medium: z.string().max(200).optional(),
    campaign: z.string().max(200).optional(),
    term: z.string().max(200).optional(),
    content: z.string().max(200).optional(),
  })
  .strict();
export type Utm = z.infer<typeof utmSchema>;

export const visitorContextSchema = z.object({
  pageUrl: z.string().min(1).max(2048),
  pageTitle: z.string().max(300).optional(),
  referrer: z.string().max(2048).optional(),
  utm: utmSchema.optional(),
  locale: z.string().max(35).optional(),
  timezone: z.string().max(64).optional(),
});
export type VisitorContext = z.infer<typeof visitorContextSchema>;

/** Lead values are always strings; each is capped at 200 chars (§7.1). */
export const leadSchema = z.record(z.string().min(1).max(64), z.string().max(200));
export type Lead = z.infer<typeof leadSchema>;

export const startSessionRequestSchema = z.object({
  lead: leadSchema.optional(),
  context: visitorContextSchema,
  firstMessage: z.string().min(1).max(2000).optional(),
  captchaToken: z.string().max(4096).optional(),
});
export type StartSessionRequest = z.infer<typeof startSessionRequestSchema>;

export const capabilitiesSchema = z.object({
  poll: z.boolean(),
  end: z.boolean(),
  /**
   * Whether replies can be streamed: the connector supports it and the site
   * turned it on. Absent means no — a client asks with `Accept:
   * text/event-stream` only when this is true, and the server answers with
   * plain JSON whenever it will not stream, so asking is always safe.
   */
  stream: z.boolean().optional(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

export const startSessionResponseSchema = z.object({
  sessionToken: z.string().min(1),
  sessionId: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  messages: z.array(messageSchema),
  capabilities: capabilitiesSchema,
});
export type StartSessionResponse = z.infer<typeof startSessionResponseSchema>;

export const sendRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string().min(1).max(4000),
    clientId: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal('action'),
    actionId: z.string().min(1).max(64),
    value: z.string().min(1).max(2000),
    label: z.string().min(1).max(200),
    clientId: z.string().min(1).max(64),
  }),
]);
export type SendRequest = z.infer<typeof sendRequestSchema>;

export const sendResponseSchema = z.object({ messages: z.array(messageSchema) });
export type SendResponse = z.infer<typeof sendResponseSchema>;

/**
 * The `done` event of a streamed send. A streamed response has already sent
 * its headers by the time the connector returns new state, so the refreshed
 * token rides in the body instead of `X-Murmur-Token`.
 */
export const streamedSendDoneSchema = sendResponseSchema.extend({ token: z.string().min(1).optional() });
export type StreamedSendDone = z.infer<typeof streamedSendDoneSchema>;

export const pollResponseSchema = z.object({ messages: z.array(messageSchema) });
export type PollResponse = z.infer<typeof pollResponseSchema>;

/** Response header carrying a refreshed session token (§7.1). */
export const TOKEN_HEADER = 'X-Murmur-Token';
/** Request header carrying the HMAC signature for the `http` connector (§6.4). */
export const SIGNATURE_HEADER = 'X-Murmur-Signature';

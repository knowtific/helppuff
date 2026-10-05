/**
 * Webhooks: what a site's endpoints receive (wiki/Webhooks.md).
 *
 * Every delivery is one JSON envelope, `POST`ed with
 *
 *   Content-Type: application/json
 *   X-Murmur-Event: <type>
 *   X-Murmur-Delivery: <envelope id>
 *   X-Murmur-Timestamp: <unix seconds>
 *   X-Murmur-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>" with the endpoint's secret>
 *
 * Receivers should check the signature and reject a timestamp more than five
 * minutes old. Deliveries can repeat (a retry after a timeout); `id` is the
 * key to de-duplicate on.
 */

export const WEBHOOK_EVENTS = {
  'conversation.started': 'A visitor opened a chat (with the pre-chat form, when there is one).',
  'message.received': 'A visitor sent a message.',
  'message.sent': 'The assistant replied.',
  'lead.captured': 'Contact details arrived: the pre-chat form, typed in the chat, or found by the assistant.',
  'callback.requested': 'The visitor asked to be called back.',
  'lead.updated': 'A lead’s status, notes or name changed in the dashboard.',
  'feedback.received': 'A visitor rated a reply (thumbs up or down).',
  'conversation.summarized': 'The dashboard summarised a conversation.',
  'conversation.ended': 'The visitor ended the chat.',
  'knowledge.crawl.finished': 'Learning the website finished.',
  'knowledge.file.processed': 'An uploaded file was learned, or failed.',
} as const;

export type WebhookEventType = keyof typeof WEBHOOK_EVENTS | 'test.ping';

/** Subscribing to `*` means every event, including ones added later. */
export const ALL_WEBHOOK_EVENTS = '*';

export type WebhookEnvelope<T = Record<string, unknown>> = {
  /** Unique per event: `evt_…`. */
  id: string;
  type: WebhookEventType;
  /** ISO 8601. */
  createdAt: string;
  site: string;
  data: T;
};

export const isWebhookEvent = (value: string): value is keyof typeof WEBHOOK_EVENTS => value in WEBHOOK_EVENTS;

/**
 * Webhooks: what a site's endpoints receive (wiki/Webhooks.md).
 *
 * Every delivery is one JSON envelope, `POST`ed with
 *
 *   Content-Type: application/json
 *   X-HelpPuff-Event: <type>
 *   X-HelpPuff-Delivery: <envelope id>
 *   X-HelpPuff-Timestamp: <unix seconds>
 *   X-HelpPuff-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>" with the endpoint's secret>
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
  'callback.updated': 'A callback request was marked done or dismissed (or reopened), or its note changed, in the dashboard or with `helppuff callbacks`.',
  'lead.updated': 'A lead’s status, notes or name changed in the dashboard.',
  'feedback.received': 'A visitor rated a reply (thumbs up or down).',
  'conversation.summarized': 'The dashboard summarised a conversation.',
  'conversation.ended': 'The visitor started a new chat (or the page called HelpPuff.reset()), ending this one. Most visitors just leave: see conversation.completed.',
  'conversation.completed': 'A conversation went quiet (5 minutes after the last message): its summary, labels, lead and transcript.',
  'budget.warning': 'Today\'s AI budget is 80% used: answers are being kept shorter. Once a day.',
  'budget.exhausted': 'Today\'s AI budget is used up: visitors get your contact details and a callback form until 00:00 UTC. Once a day.',
  'handover.requested': 'A visitor asked for a person (live chat): the team was notified.',
  'handover.missed': 'Nobody took a live chat in time: the visitor was offered the callback form.',
  'handover.ended': 'A person handed a live chat back to the assistant.',
  'conversation.assigned': 'A conversation was taken by, or given to, someone on the team (or unassigned).',
  'conversation.closed': 'A conversation was closed: by the team, or after it went quiet (`live.closeAfterMinutes`).',
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

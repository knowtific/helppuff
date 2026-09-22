import { sanitizeMessages, type Message } from '@murmur/protocol';
import type { Platform } from './platform.js';

/** Shown when a connector replied but nothing it sent was usable (§8.3). */
export const FALLBACK_NOTICE_TEXT = 'Sorry — I could not put that into words. Could you try asking another way?';

function fallbackNotice(now: number): Message {
  return {
    id: `fallback_${now.toString(36)}`,
    ts: now,
    role: 'system',
    type: 'notice',
    text: FALLBACK_NOTICE_TEXT,
    tone: 'info',
  };
}

/**
 * Validate everything a connector returns before it reaches the widget.
 * Invalid messages are dropped and counted; if that leaves nothing, a single
 * friendly notice is returned rather than an error (§4.4, §8.3).
 */
export function sanitizeConnectorMessages(
  input: unknown,
  platform: Pick<Platform, 'log' | 'now'>,
  options: { allowEmpty?: boolean } = {},
): Message[] {
  const { messages, dropped } = sanitizeMessages(input);
  if (dropped > 0) platform.log('connector.messages_dropped', { dropped });

  if (messages.length > 0) return messages;
  if (options.allowEmpty && dropped === 0) return [];
  return [fallbackNotice(platform.now())];
}

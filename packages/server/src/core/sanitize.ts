import { sanitizeMessages, type Message } from '@helppuff/protocol';
import { promptLeak, type PromptGuidance } from '@helppuff/connector-types';
import type { Platform } from './platform.js';

/** Shown when a connector replied but nothing it sent was usable. */
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
 * friendly notice is returned rather than an error.
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

/** Said instead of a reply that started repeating the assistant's instructions. */
export const LEAK_REPLY_TEXT = 'Sorry, I can’t share that. Is there something about the business I can help you with?';

const leakChecks = new WeakMap<PromptGuidance, (reply: string) => boolean>();

/**
 * The last check on every backend's replies: an agent message that repeats a
 * line of HelpPuff's settings or rules (`guidance`) is replaced. A visitor can
 * talk a model into printing its instructions; this check cannot be talked
 * out of. (workers-ai also checks the owner's prompt, and stops a streamed
 * reply as it leaks; the final messages replace what was streamed.)
 */
export function guardReplies(messages: Message[], guidance: PromptGuidance | undefined, platform: Pick<Platform, 'log' | 'now'>): Message[] {
  if (!guidance) return messages;
  let leaks = leakChecks.get(guidance);
  if (!leaks) {
    leaks = promptLeak(`${guidance.before}\n${guidance.after}`, 1);
    leakChecks.set(guidance, leaks);
  }
  return messages.map((message) => {
    if (message.role !== 'agent' || !('text' in message) || typeof message.text !== 'string' || !leaks(message.text)) return message;
    platform.log('reply.prompt_leak');
    return { id: message.id, ts: message.ts, role: 'agent', type: 'text', text: LEAK_REPLY_TEXT } satisfies Message;
  });
}

import type { Message } from '@helppuff/protocol';
import type { ConnectorContext } from './index.js';
import type { PromptScope } from './prompt.js';

/**
 * Conversation history for backends that keep none of their own.
 *
 * Retell, the OpenAI Responses API and Gemini's Interactions API hold the
 * thread on their side and hand back an id, which fits in the session token.
 * Anthropic's Messages API, Cloudflare AI Search and any OpenAI-compatible
 * chat endpoint are stateless: every request carries the whole
 * conversation. That does not fit in a 1 kb token. With a database the
 * server already records every turn, and `ctx.history` reads it back;
 * without one it lives in KV, keyed by session, and expires with it.
 *
 * Writes never hold up a reply: they are handed to `waitUntil`. Losing
 * history is survivable — the assistant forgets the earlier turns, and the
 * visitor's next message still gets an answer — so every read and write
 * here degrades rather than throws.
 */

export type Turn = { role: 'user' | 'assistant'; content: string };

/** Enough context for a support conversation; bounded so a request stays cheap. */
export const HISTORY_MAX_TURNS = 24;
export const HISTORY_MAX_CHARS = 24_000;
/** Matches the longest session a site may configure. */
const HISTORY_TTL_SECONDS = 72 * 3600;

type HistoryCtx = Pick<ConnectorContext<unknown>, 'kv' | 'siteId' | 'sessionId' | 'log' | 'waitUntil' | 'history'>;

export function historyKey(ctx: Pick<ConnectorContext<unknown>, 'siteId' | 'sessionId'>): string {
  return `hist:${ctx.siteId}:${ctx.sessionId}`;
}

export async function loadHistory(ctx: Omit<HistoryCtx, 'waitUntil'>): Promise<Turn[]> {
  if (ctx.history) {
    try {
      return trimHistory(await ctx.history());
    } catch {
      ctx.log('history.unreadable');
      return [];
    }
  }
  const raw = await ctx.kv.get(historyKey(ctx));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (turn): turn is Turn =>
        typeof turn === 'object' &&
        turn !== null &&
        ((turn as Turn).role === 'user' || (turn as Turn).role === 'assistant') &&
        typeof (turn as Turn).content === 'string',
    );
  } catch {
    ctx.log('history.unparsable');
    return [];
  }
}

/** Keep the most recent turns within the bounds, starting with a user turn, which every chat API requires. */
export function trimHistory(history: Turn[]): Turn[] {
  let turns = history.filter((turn) => turn.content.trim());
  while (turns.length > HISTORY_MAX_TURNS || totalChars(turns) > HISTORY_MAX_CHARS) {
    turns = turns.slice(1);
  }
  while (turns.length > 0 && turns[0]?.role !== 'user') turns = turns.slice(1);
  return turns;
}

/**
 * Append a user turn and the reply to it, after the response. Nothing to do
 * when the server keeps the record (`ctx.history`).
 */
export function appendHistory(ctx: HistoryCtx, previous: Turn[], added: Turn[]): void {
  if (ctx.history) return;
  const turns = trimHistory([...previous, ...added]);
  ctx.waitUntil(
    ctx.kv.put(historyKey(ctx), JSON.stringify(turns), { expirationTtl: HISTORY_TTL_SECONDS }).catch(() => ctx.log('history.write_failed')),
  );
}

/**
 * The lead and page a conversation started with. A stateless backend
 * rebuilds its system prompt every turn, so `{{lead.name}}` has to survive
 * past the first one. Written after the response, once per conversation.
 */
export function saveScope(ctx: HistoryCtx, scope: PromptScope): void {
  ctx.waitUntil(
    ctx.kv.put(`${historyKey(ctx)}:scope`, JSON.stringify(scope), { expirationTtl: HISTORY_TTL_SECONDS }).catch(() => ctx.log('scope.write_failed')),
  );
}

/** Start this as early as possible and await it with the other reads: it is a KV round trip. */
export async function loadScope(ctx: Pick<HistoryCtx, 'kv' | 'siteId' | 'sessionId'>): Promise<PromptScope> {
  const fallback: PromptScope = { site: { id: ctx.siteId } };
  const raw = await ctx.kv.get(`${historyKey(ctx)}:scope`);
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as PromptScope) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * What the visitor "said" with an action, as the model reads it: a chip's
 * value, or a submitted inline form (JSON) as `Label: field: value, …`.
 */
export function actionContent(label: string, value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return `${label}: ${Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(', ')}`;
    }
  } catch {
    // Not JSON: a chip's value.
  }
  return value;
}

function totalChars(turns: Turn[]): number {
  return turns.reduce((sum, turn) => sum + turn.content.length, 0);
}

/**
 * What the assistant "said" in a batch of messages, as plain text for the
 * next request. A card or a set of chips is summarised rather than dropped,
 * so a visitor answering "the second one" still makes sense to the model.
 */
export function summarizeReply(messages: Message[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    switch (message.type) {
      case 'text':
        parts.push(message.text);
        break;
      case 'options':
        parts.push(
          `${message.text ? `${message.text} ` : ''}[Offered choices: ${message.options.map((o) => o.label).join(' | ')}]`,
        );
        break;
      case 'card':
        parts.push(`[Showed a card: ${message.title}${message.body ? ` — ${message.body}` : ''}]`);
        break;
      case 'carousel':
        parts.push(`[Showed cards: ${message.cards.map((card) => card.title).join(' | ')}]`);
        break;
      case 'links':
        parts.push(`[Shared links: ${message.links.map((link) => `${link.label} (${link.url})`).join(' | ')}]`);
        break;
      default:
        break;
    }
  }
  return parts.join('\n\n').trim();
}

/**
 * Hides `[[options: …]]` / `[[link: …]]` markers from a streamed reply.
 *
 * The complete text is parsed with `parseMarkers` at the end; this only
 * keeps the half-written marker out of the live preview. Text is held back
 * from the first `[[` until the matching `]]`, then dropped.
 */
export function markerFilter(onText: (delta: string) => void): { push(delta: string): void; flush(): void } {
  let pending = '';
  let inMarker = false;

  const drain = () => {
    for (;;) {
      if (inMarker) {
        const end = pending.indexOf(']]');
        if (end === -1) return;
        pending = pending.slice(end + 2);
        inMarker = false;
        continue;
      }
      const start = pending.indexOf('[[');
      if (start === -1) {
        // A lone trailing `[` might be the start of a marker; keep it back.
        const keep = pending.endsWith('[') ? 1 : 0;
        const out = pending.slice(0, pending.length - keep);
        if (out) onText(out);
        pending = pending.slice(pending.length - keep);
        return;
      }
      const before = pending.slice(0, start);
      if (before) onText(before);
      pending = pending.slice(start + 2);
      inMarker = true;
    }
  };

  return {
    push(delta) {
      pending += delta;
      drain();
    },
    flush() {
      if (!inMarker && pending) onText(pending);
      pending = '';
    },
  };
}

/** Instructions appended to a prompt so a tool-less model can still offer chips and links. */
export const MARKER_INSTRUCTIONS = [
  'When the visitor is likely to pick from a few next steps, end your reply with one line',
  '[[options: <next step> | <next step> | <next step>]]',
  'with two to four short next steps you write for this conversation, from what was just said, in the visitor\'s own words, without letters or numbers.',
  'Options are things the visitor might want to do or ask next — never facts, times or prices you were not given.',
  'When a web page answers the question, end with [[link: Page title | https://full-url]], using only https URLs',
  'that appear in the documents. Reference documents are not web pages: never link to them.',
  'Use at most one options line per reply. Never explain these markers.',
].join('\n');

/**
 * Knowledge documents are stored under names like `file__docs__pricing.pdf`
 * or `site__acme.com__pricing.md`. A model shown those names will sometimes
 * "link" to them, producing a URL that leads nowhere; drop any such link
 * rather than show it.
 */
export function isDocumentLink(url: string): boolean {
  return /(?:^|\/)(?:file|site)__/.test(url);
}

export function withoutDocumentLinks(messages: Message[]): Message[] {
  return messages.flatMap((m): Message[] => {
    if (m.type === 'links') {
      const links = m.links.filter((link) => !isDocumentLink(link.url));
      return links.length ? [{ ...m, links }] : [];
    }
    if (m.type === 'text') {
      // [label](…file__x.pdf) → label
      return [{ ...m, text: m.text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label: string, url: string) => (isDocumentLink(url) ? label : all)) }];
    }
    return [m];
  });
}

import { actionContent, HISTORY_MAX_TURNS, summarizeReply, trimHistory, type Turn } from '@helppuff/connector-types';
import type { Message } from '@helppuff/protocol';
import type { D1Like } from '../db/d1.js';

/**
 * A conversation's history for a stateless backend, read back from what
 * `admin/record.ts` stores after every turn. It replaces the copy those
 * backends kept in KV: one read in the batch a reply already waits on, no
 * write at all.
 *
 * The turns are what the model was given: the visitor's text (an action's
 * value, a form's fields), and each reply summarised by `summarizeReply`.
 * The last turn's rows are written after its response; a visitor is never
 * quicker than that write.
 */

/** Enough rows for the turns kept, with replies of several messages. */
const ROWS = HISTORY_MAX_TURNS * 4;

type Row = { role: string; type: string; text: string | null; payload: string | null; author: string | null };

function parse(payload: string | null): Record<string, unknown> {
  if (!payload) return {};
  try {
    const value = JSON.parse(payload) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function recordedHistory(db: D1Like, conversationId: string): Promise<Turn[]> {
  const rows = (
    await db
      .prepare('SELECT role, type, text, payload, author FROM messages WHERE conversation_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
      .bind(conversationId, ROWS)
      .all<Row>()
  ).results.reverse();

  const turns: Turn[] = [];
  let reply: Message[] = [];
  const endReply = () => {
    const content = summarizeReply(reply);
    if (content) turns.push({ role: 'assistant', content });
    reply = [];
  };
  for (const row of rows) {
    const payload = parse(row.payload);
    if (row.role === 'user') {
      endReply();
      const content = typeof payload['value'] === 'string' ? actionContent(row.text ?? '', payload['value']) : row.text;
      if (content) turns.push({ role: 'user', content });
    } else if (row.author && row.text) {
      // A person on the team answered in a live chat: the model reads it as theirs, never as an instruction.
      const name = (payload['meta'] as { agentName?: unknown } | undefined)?.agentName;
      reply.push({ type: 'text', role: 'agent', id: 'h', ts: 0, text: `[${typeof name === 'string' ? name : 'A person'} from the team wrote:] ${row.text}` });
    } else {
      reply.push({ ...payload, ...(row.text !== null && payload['text'] === undefined ? { text: row.text } : {}), type: row.type, role: row.role } as unknown as Message);
    }
  }
  endReply();
  return trimHistory(turns);
}

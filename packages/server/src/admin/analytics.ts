import type { D1Like } from '../db/d1.js';

/**
 * Analytics beyond counting chats (`GET /overview`'s `insights` and `health`):
 * how much the assistant handles on its own, where it needs help, what it
 * brings in, and what is broken. Read from what HelpPuff records anyway (the
 * conversations and their AI summary, messages and ratings, live chat's
 * handover notices, callbacks, jobs, appointments, deliveries, usage): no
 * extra writes on the visitor's path.
 *
 * Every query is optional: a table a site never used (no jobs, no live chat)
 * answers zero, never an error.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

type Scope = { site: string | null };

/** ` AND <column> = ?` for one site (an API key's, or the dashboard's choice), else nothing. */
const bySite = (scope: Scope, column: string) => (scope.site ? { sql: ` AND ${column} = ?`, params: [scope.site] } : { sql: '', params: [] as unknown[] });

async function first<T>(d: D1Like, sql: string, params: unknown[]): Promise<T | null> {
  return (await d.prepare(sql).bind(...params).first<T>().catch(() => null)) ?? null;
}
async function all<T>(d: D1Like, sql: string, params: unknown[]): Promise<T[]> {
  return (await d.prepare(sql).bind(...params).all<T>().catch(() => null))?.results ?? [];
}

const median = (values: number[]): number | null => {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0);

/** The numbers the top tiles compare with the period before. */
export async function headline(d: D1Like, scope: Scope, from: number, to: number) {
  const c = bySite(scope, 'site_id');
  const cc = bySite(scope, 'c.site_id');
  const [row, ratings, callbacks] = await Promise.all([
    first<Record<string, number>>(
      d,
      `SELECT COUNT(summarized_at) AS summarized,
         SUM(CASE WHEN summarized_at IS NOT NULL AND handover_at IS NULL AND json_extract(summary, '$.outcome') IN ('answered', 'booked', 'lead_captured') THEN 1 ELSE 0 END) AS resolved,
         COUNT(handover_at) AS escalated,
         SUM(CASE WHEN handover_at IS NOT NULL OR EXISTS (SELECT 1 FROM callbacks cb WHERE cb.conversation_id = conversations.id) THEN 1 ELSE 0 END) AS needsPerson,
         SUM(CASE WHEN json_extract(summary, '$.outcome') = 'unanswered' OR json_array_length(summary, '$.unanswered') > 0 THEN 1 ELSE 0 END) AS unanswered
       FROM conversations WHERE started_at >= ? AND started_at < ?${c.sql}`,
      [from, to, ...c.params],
    ),
    first<Record<string, number>>(
      d,
      `SELECT SUM(CASE WHEN m.feedback = 1 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN m.feedback = -1 THEN 1 ELSE 0 END) AS down
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE m.feedback IS NOT NULL AND c.started_at >= ? AND c.started_at < ?${cc.sql}`,
      [from, to, ...cc.params],
    ),
    first<{ n: number }>(d, `SELECT COUNT(*) AS n FROM callbacks WHERE requested_at >= ? AND requested_at < ?${c.sql}`, [from, to, ...c.params]),
  ]);
  return {
    summarized: n(row?.['summarized']),
    resolved: n(row?.['resolved']),
    escalated: n(row?.['escalated']),
    /** A live chat or a callback: the team had to step in. */
    needsPerson: n(row?.['needsPerson']),
    /** With at least one question it could not answer, however the chat ended. */
    unanswered: n(row?.['unanswered']),
    ratedUp: n(ratings?.['up']),
    ratedDown: n(ratings?.['down']),
    callbacks: n(callbacks?.n),
  };
}

/** Everything below the tiles, for one period. `offset`: the viewer's time zone, for the hours. */
export async function insights(d: D1Like, scope: Scope, from: number, to: number, offset: number) {
  const c = bySite(scope, 'site_id');
  const cc = bySite(scope, 'c.site_id');
  const range = [from, to];
  const [outcomes, sentiment, quality, engagement, durations, oneMessage, returning, unanswered, topics, hours, live, waits, people, callbacks, jobs, won, appointments] = await Promise.all([
    all<{ outcome: string | null; count: number }>(
      d,
      `SELECT CASE WHEN summarized_at IS NULL THEN 'pending' ELSE COALESCE(json_extract(summary, '$.outcome'), 'other') END AS outcome, COUNT(*) AS count
       FROM conversations WHERE started_at >= ? AND started_at < ?${c.sql} GROUP BY outcome`,
      [...range, ...c.params],
    ),
    all<{ value: string; count: number }>(
      d,
      `SELECT json_extract(summary, '$.sentiment') AS value, COUNT(*) AS count FROM conversations
       WHERE started_at >= ? AND started_at < ? AND summarized_at IS NOT NULL${c.sql} GROUP BY value`,
      [...range, ...c.params],
    ),
    all<{ value: string; count: number }>(
      d,
      `SELECT json_extract(summary, '$.leadQuality') AS value, COUNT(*) AS count FROM conversations
       WHERE started_at >= ? AND started_at < ? AND summarized_at IS NOT NULL${c.sql} GROUP BY value`,
      [...range, ...c.params],
    ),
    first<{ conversations: number; messages: number }>(
      d,
      `SELECT COUNT(*) AS conversations, COALESCE(SUM(message_count), 0) AS messages FROM conversations WHERE started_at >= ? AND started_at < ?${c.sql}`,
      [...range, ...c.params],
    ),
    // How long a chat lasts: first to last message, for chats with a reply. A median, so one chat left open for a day does not count for much.
    all<{ ms: number }>(
      d,
      `SELECT last_at - started_at AS ms FROM conversations WHERE started_at >= ? AND started_at < ? AND message_count > 1${c.sql} LIMIT 5000`,
      [...range, ...c.params],
    ),
    // Left after their first message: one visitor message, however many replies.
    first<{ n: number }>(
      d,
      `SELECT COUNT(*) AS n FROM (SELECT c.id FROM conversations c JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'
         WHERE c.started_at >= ? AND c.started_at < ?${cc.sql} GROUP BY c.id HAVING COUNT(*) = 1)`,
      [...range, ...cc.params],
    ),
    first<{ n: number }>(
      d,
      `SELECT COUNT(DISTINCT c.visitor) AS n FROM conversations c WHERE c.started_at >= ? AND c.started_at < ? AND c.visitor IS NOT NULL${cc.sql}
         AND EXISTS (SELECT 1 FROM conversations p WHERE p.visitor = c.visitor AND p.site_id = c.site_id AND p.started_at < c.started_at)`,
      [...range, ...cc.params],
    ),
    // What it could not answer, most asked first: the knowledge base's to-do list.
    all<{ text: string; count: number; conversationId: string }>(
      d,
      `SELECT MIN(q.value) AS text, COUNT(*) AS count, MAX(c.id) AS conversationId
       FROM conversations c, json_each(c.summary, '$.unanswered') q
       WHERE c.started_at >= ? AND c.started_at < ? AND c.summarized_at IS NOT NULL${cc.sql}
       GROUP BY lower(trim(q.value)) ORDER BY count DESC, MAX(c.started_at) DESC LIMIT 8`,
      [...range, ...cc.params],
    ),
    all<{ topic: string; count: number }>(
      d,
      `SELECT MIN(t.value) AS topic, COUNT(*) AS count FROM conversations c, json_each(c.summary, '$.topics') t
       WHERE c.started_at >= ? AND c.started_at < ? AND c.summarized_at IS NOT NULL${cc.sql}
       GROUP BY lower(trim(t.value)) ORDER BY count DESC LIMIT 8`,
      [...range, ...cc.params],
    ),
    all<{ hour: number; count: number }>(
      d,
      `SELECT CAST(((started_at + ?) % ${DAY}) / ${HOUR} AS INTEGER) AS hour, COUNT(*) AS count FROM conversations
       WHERE started_at >= ? AND started_at < ?${c.sql} GROUP BY hour`,
      [offset, ...range, ...c.params],
    ),
    first<Record<string, number>>(
      d,
      `SELECT COUNT(*) AS requested,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'agent' AND m.author IS NOT NULL) THEN 1 ELSE 0 END) AS answered,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.type = 'handover' AND json_extract(m.payload, '$.status') = 'missed') THEN 1 ELSE 0 END) AS missed
       FROM conversations c WHERE c.handover_at >= ? AND c.handover_at < ?${cc.sql}`,
      [...range, ...cc.params],
    ),
    // From asking for a person to the team's first reply.
    all<{ ms: number }>(
      d,
      `SELECT MIN(m.ts) - c.handover_at AS ms FROM conversations c JOIN messages m ON m.conversation_id = c.id AND m.role = 'agent' AND m.author IS NOT NULL AND m.ts >= c.handover_at
       WHERE c.handover_at >= ? AND c.handover_at < ?${cc.sql} GROUP BY c.id LIMIT 2000`,
      [...range, ...cc.params],
    ),
    all<{ name: string; count: number }>(
      d,
      `SELECT assigned_name AS name, COUNT(*) AS count FROM conversations
       WHERE handover_at >= ? AND handover_at < ? AND assigned_name IS NOT NULL${c.sql} GROUP BY assigned_name ORDER BY count DESC LIMIT 8`,
      [...range, ...c.params],
    ),
    all<{ status: string; requestedAt: number; closedAt: number | null }>(
      d,
      `SELECT status, requested_at AS requestedAt, closed_at AS closedAt FROM callbacks WHERE requested_at >= ? AND requested_at < ?${c.sql} LIMIT 5000`,
      [...range, ...c.params],
    ),
    all<{ source: string; count: number }>(d, `SELECT source, COUNT(*) AS count FROM jobs WHERE created_at >= ? AND created_at < ?${c.sql} GROUP BY source`, [...range, ...c.params]),
    all<{ kind: string; count: number; cents: number; currency: string | null }>(
      d,
      `SELECT s.kind AS kind, COUNT(*) AS count, COALESCE(SUM(j.value_cents), 0) AS cents, MAX(j.currency) AS currency
       FROM jobs j JOIN pipeline_stages s ON s.id = j.stage_id
       WHERE j.closed_at >= ? AND j.closed_at < ? AND s.kind IN ('won', 'lost')${bySite(scope, 'j.site_id').sql} GROUP BY s.kind`,
      [...range, ...bySite(scope, 'j.site_id').params],
    ),
    all<{ status: string; source: string; count: number }>(
      d,
      `SELECT status, source, COUNT(*) AS count FROM appointments WHERE created_at >= ? AND created_at < ? AND status != 'busy'${c.sql} GROUP BY status, source`,
      [...range, ...c.params],
    ),
  ]);

  const sumWhere = <T extends { count: number }>(rows: T[], pick: (row: T) => boolean) => rows.filter(pick).reduce((sum, r) => sum + n(r.count), 0);
  const tally = <K extends string>(rows: { value: string | null; count: number }[], keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, sumWhere(rows, (r) => r.value === k)])) as Record<K, number>;
  const byHour = Array.from({ length: 24 }, (_, h) => n(hours.find((r) => n(r.hour) === h)?.count));
  const cbClosed = callbacks.filter((r) => r.status === 'done' && r.closedAt);
  const wonRow = won.find((r) => r.kind === 'won');
  const lostRow = won.find((r) => r.kind === 'lost');
  const appointmentsBy = (pick: (r: { status: string; source: string }) => boolean) => sumWhere(appointments, pick);
  const conversations = n(engagement?.conversations);

  return {
    outcomes: tally(
      outcomes.map((o) => ({ value: o.outcome, count: o.count })),
      ['answered', 'booked', 'lead_captured', 'callback_requested', 'unanswered', 'abandoned', 'pending'] as const,
    ),
    sentiment: tally(sentiment, ['positive', 'neutral', 'negative'] as const),
    leadQuality: tally(quality, ['hot', 'warm', 'cold', 'none'] as const),
    engagement: {
      avgMessages: conversations ? n(engagement?.messages) / conversations : 0,
      medianSeconds: (() => {
        const ms = median(durations.map((r) => n(r.ms)));
        return ms === null ? null : Math.round(ms / 1000);
      })(),
      oneMessage: n(oneMessage?.n),
      returningVisitors: n(returning?.n),
    },
    unansweredQuestions: unanswered.map((q) => ({ text: String(q.text ?? '').slice(0, 300), count: n(q.count), conversationId: q.conversationId })),
    topics: topics.map((t) => ({ topic: String(t.topic ?? '').slice(0, 80), count: n(t.count) })),
    hours: byHour,
    live: {
      requested: n(live?.['requested']),
      answered: n(live?.['answered']),
      missed: n(live?.['missed']),
      medianWaitSeconds: (() => {
        const ms = median(waits.map((r) => n(r.ms)));
        return ms === null ? null : Math.round(ms / 1000);
      })(),
      byPerson: people.map((p) => ({ name: p.name, count: n(p.count) })),
    },
    callbacks: {
      requested: callbacks.length,
      done: callbacks.filter((r) => r.status === 'done').length,
      dismissed: callbacks.filter((r) => r.status === 'dismissed').length,
      open: callbacks.filter((r) => r.status === 'open').length,
      medianHoursToDone: (() => {
        const ms = median(cbClosed.map((r) => n(r.closedAt) - n(r.requestedAt)));
        return ms === null ? null : Math.round((ms / HOUR) * 10) / 10;
      })(),
    },
    jobs: {
      created: sumWhere(jobs, () => true),
      fromChat: sumWhere(jobs, (r) => r.source === 'chat' || r.source === 'quote'),
      won: n(wonRow?.count),
      lost: n(lostRow?.count),
      wonValue: n(wonRow?.cents) / 100,
      currency: wonRow?.currency ?? null,
    },
    appointments: {
      booked: appointmentsBy(() => true),
      fromChat: appointmentsBy((r) => r.source === 'chat'),
      completed: appointmentsBy((r) => r.status === 'completed'),
      noShow: appointmentsBy((r) => r.status === 'no_show'),
      cancelled: appointmentsBy((r) => r.status === 'cancelled'),
    },
  };
}

export type HealthIssue = { kind: 'webhook' | 'email' | 'tool' | 'budget' | 'knowledge'; title: string; detail: string | null; page: string };

/** What is broken right now, or broke in the period: each with where to fix it. */
export async function health(d: D1Like, scope: Scope, since: number): Promise<HealthIssue[]> {
  const c = bySite(scope, 'site_id');
  const host = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };
  const [hooks, failedDeliveries, email, tools, budget, pages] = await Promise.all([
    all<{ url: string; description: string | null; last_error: string | null; last_status: string }>(
      d,
      `SELECT url, description, last_error, last_status FROM webhooks WHERE enabled = 1 AND last_status IN ('failed', 'retrying')${c.sql} LIMIT 10`,
      c.params,
    ),
    first<{ n: number }>(
      d,
      `SELECT COUNT(*) AS n FROM webhook_deliveries w JOIN webhooks h ON h.id = w.webhook_id WHERE w.ok = 0 AND w.at >= ?${bySite(scope, 'h.site_id').sql}`,
      [since, ...bySite(scope, 'h.site_id').params],
    ),
    first<{ last_error: string | null; last_status: string | null; enabled: number }>(d, `SELECT last_error, last_status, enabled FROM email_service WHERE 1 = 1${c.sql} LIMIT 1`, c.params),
    all<{ name: string; last_status: number | null; last_error: string | null }>(
      d,
      `SELECT name, last_status, last_error FROM tools WHERE enabled = 1 AND (last_status >= 400 OR (last_status IS NULL AND last_error IS NOT NULL))${c.sql} LIMIT 10`,
      c.params,
    ),
    first<{ n: number }>(d, `SELECT COUNT(*) AS n FROM usage_daily WHERE exhausted_at IS NOT NULL AND exhausted_at >= ?${c.sql}`, [since, ...c.params]),
    first<{ n: number }>(d, `SELECT COUNT(*) AS n FROM pages WHERE status = 'failed'${c.sql}`, c.params),
  ]);
  const issues: HealthIssue[] = [];
  for (const hook of hooks) {
    issues.push({
      kind: 'webhook',
      title: `A webhook is ${hook.last_status === 'retrying' ? 'failing, and being retried' : 'failing'}: ${hook.description || host(hook.url)}`,
      detail: hook.last_error,
      page: '#/settings/webhooks',
    });
  }
  if (!hooks.length && n(failedDeliveries?.n) > 0) {
    issues.push({ kind: 'webhook', title: `${n(failedDeliveries?.n)} webhook ${n(failedDeliveries?.n) === 1 ? 'delivery' : 'deliveries'} failed in this period`, detail: 'They are fine now; check Recent deliveries for what was missed.', page: '#/settings/webhooks' });
  }
  if (email?.enabled && email.last_status === 'failed') issues.push({ kind: 'email', title: 'Email notifications are failing', detail: email.last_error, page: '#/settings/notifications' });
  for (const tool of tools) issues.push({ kind: 'tool', title: `The tool ${tool.name} is failing`, detail: tool.last_error ?? (tool.last_status ? `HTTP ${tool.last_status}` : null), page: '#/prompt' });
  if (n(budget?.n) > 0) {
    issues.push({
      kind: 'budget',
      title: `The AI budget ran out on ${n(budget?.n)} ${n(budget?.n) === 1 ? 'day' : 'days'}`,
      detail: 'Visitors got your contact details and the callback form for the rest of those days. Raise the budget, or move to Workers Paid.',
      page: '#/settings/advanced',
    });
  }
  if (n(pages?.n) > 0) issues.push({ kind: 'knowledge', title: `${n(pages?.n)} ${n(pages?.n) === 1 ? 'page' : 'pages'} of your site could not be learned`, detail: 'Try them again, or upload the information as a file.', page: '#/knowledge' });
  return issues;
}

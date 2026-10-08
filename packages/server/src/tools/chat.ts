import { promptToolRefs } from '@helppuff/protocol';
import type { ToolsHandle } from '@helppuff/connector-types';
import type { SiteConfig } from '../config/schema.js';
import { isAssistant } from '../core/assistant.js';
import type { RequestCtx } from '../core/request.js';
import type { PreparedConnector } from '../core/run.js';
import { dbFrom, type D1Like } from '../db/d1.js';
import { callHttp, extractFields, MAX_VALUE, missingPrechat, parseData, saveDataStatement, type ToolOutcome } from './run.js';
import { openTool, siteTools, withArgs, type Tool, type ToolRow } from './store.js';
import { capSize, type TemplateScope } from './template.js';

/**
 * The site's tools in a chat (HelpPuff's assistant only):
 *
 *  - before the chat: the tools marked `before` run when it starts, with the
 *    pre-chat form's answers; what they return is the conversation's data
 *    from the first answer on;
 *  - during it: the tools the prompt names as `{{name}}` are offered to the
 *    model (`ctx.tools`), and what they return or save is kept;
 *  - after it: `runAfterTools`, from the conversation's end job.
 *
 * The data lives on the conversation (`conversations.data`, by tool name);
 * extract tools also save their fields as custom attributes. Every write
 * goes through `waitUntil`: the visitor waits for the tool, never the write.
 */

/** Calls the model may make to the site's tools in one turn. */
const MAX_CALLS_PER_TURN = 5;

/** The site's enabled tools, secrets opened. Empty without a database or for a backend that is not HelpPuff's assistant. */
export async function enabledTools(ctx: RequestCtx, site: SiteConfig, siteId: string): Promise<Tool[]> {
  const db = dbFrom(ctx.env);
  if (!db || !isAssistant(site) || ctx.secret.length < 32) return [];
  const rows = (await siteTools(db, siteId, ctx.platform.now())).filter((r) => r.enabled);
  return Promise.all(rows.map((r) => openTool(r, ctx.secret)));
}

/** The prompt the connector runs with (its prompt option), for the `{{name}}` it uses. */
function promptText(prepared: PreparedConnector): string {
  const key = prepared.connector.promptOption(prepared.options);
  const value = key ? (prepared.options as Record<string, unknown>)[key] : undefined;
  return [typeof value === 'string' ? value : '', prepared.guidance?.before ?? ''].join('\n');
}

/** What the conversation knows that a tool's template can use, read once per turn. */
export type ConversationFacts = { data: Record<string, unknown>; prechat: Record<string, string>; page: { url: string | null; title: string | null } };

export async function conversationFacts(db: D1Like, conversationId: string): Promise<ConversationFacts> {
  const row = await db
    .prepare('SELECT c.data, c.page_url, c.page_title, l.name, l.email, l.phone, l.fields FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = ?')
    .bind(conversationId)
    .first<{ data: string | null; page_url: string | null; page_title: string | null; name: string | null; email: string | null; phone: string | null; fields: string | null }>();
  const prechat: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseData(row?.fields))) if (typeof value === 'string') prechat[key] = value;
  for (const key of ['name', 'email', 'phone'] as const) if (row?.[key]) prechat[key] = row[key]!;
  return { data: parseData(row?.data), prechat, page: { url: row?.page_url ?? null, title: row?.page_title ?? null } };
}

const schemaOf = (tool: Tool): Record<string, unknown> => {
  const params = tool.kind === 'extract' ? tool.fields : withArgs(tool);
  return {
    type: 'object',
    properties: Object.fromEntries(params.map((p) => [p.name, { type: 'string', ...(p.description ? { description: p.description } : {}) }])),
    required: params.filter((p) => p.required).map((p) => p.name),
  };
};

const forModel = (outcome: ToolOutcome) =>
  outcome.ok
    ? JSON.stringify(outcome.value).slice(0, MAX_VALUE + 200)
    : JSON.stringify({ ...(outcome.value as object), note: 'The lookup failed. Tell the visitor you could not check it right now; do not guess the result.' });

function recordCall(ctx: RequestCtx, db: D1Like, tool: Tool, outcome: Pick<ToolOutcome, 'status' | 'error'>): void {
  ctx.platform.waitUntil(
    db
      .prepare('UPDATE tools SET last_status = ?, last_error = ?, last_at = ? WHERE id = ?')
      .bind(outcome.status, outcome.error ?? null, ctx.platform.now(), tool.id)
      .run()
      .catch(() => {}),
  );
}

/**
 * The `tools` handle for this turn. `facts` is the conversation's data and
 * form answers (read when the turn began, or just made before the chat).
 */
export function toolsHandle(
  ctx: RequestCtx,
  options: { siteId: string; sessionId: string; prepared: PreparedConnector; tools: Tool[]; facts: ConversationFacts },
): ToolsHandle | undefined {
  const { siteId, sessionId, tools, facts } = options;
  const db = dbFrom(ctx.env);
  if (!db || !tools.length) return undefined;
  const named = new Set(promptToolRefs(promptText(options.prepared)).filter((r) => r.path === r.name).map((r) => r.name));
  const offered = tools.filter((t) => named.has(t.name));
  const data = facts.data;
  let calls = 0;

  const save = (values: Record<string, unknown>, attributes?: Record<string, string>) => {
    const now = ctx.platform.now();
    const statements = [saveDataStatement(db, siteId, sessionId, values, now)];
    if (attributes && Object.keys(attributes).length) {
      const entries = Object.entries(attributes);
      const set = entries.map(() => `'$.' || ?, ?`).join(', ');
      const params = entries.flatMap(([k, v]) => [k, v]);
      statements.push(
        db
          .prepare(
            `INSERT INTO conversations (id, site_id, started_at, last_at, message_count, attributes) VALUES (?, ?, ?, ?, 0, json_set('{}', ${set}))
             ON CONFLICT (id) DO UPDATE SET attributes = json_set(coalesce(conversations.attributes, '{}'), ${set})`,
          )
          .bind(sessionId, siteId, now, now, ...params, ...params),
      );
    }
    ctx.platform.waitUntil(db.batch(statements).catch(() => ctx.platform.log('tools.save_failed', { siteId })));
  };

  return {
    names: tools.map((t) => t.name),
    offered: offered.map((t) => ({ name: t.name, description: t.description, parameters: schemaOf(t) })),
    data,
    call: async (name, args) => {
      const tool = offered.find((t) => t.name === name);
      if (!tool) return JSON.stringify({ error: 'unknown tool' });
      if (++calls > MAX_CALLS_PER_TURN) return JSON.stringify({ error: 'Too many tool calls in one answer. Answer with what you have.' });
      if (tool.kind === 'extract') {
        const { values, missing } = extractFields(tool, args);
        if (!Object.keys(values).length) return JSON.stringify({ saved: false, note: `Ask the visitor for: ${missing.join(', ') || tool.fields.map((f) => f.name).join(', ')}.` });
        const value = { ...(data[name] && typeof data[name] === 'object' ? (data[name] as Record<string, unknown>) : {}), ...values };
        data[name] = value;
        save({ [name]: value }, values);
        ctx.platform.log('tools.extracted', { siteId, tool: name, fields: Object.keys(values).length });
        return JSON.stringify({ saved: true, ...(missing.length ? { stillMissing: missing } : {}), note: 'Saved. Do not ask for it again.' });
      }
      const scope: TemplateScope = {
        args,
        prechat: facts.prechat,
        data,
        page: facts.page,
        conversation: { id: sessionId },
        site: { id: siteId },
      };
      const outcome = await callHttp(tool, scope, globalThis.fetch.bind(globalThis), () => ctx.platform.now());
      ctx.platform.log('tools.called', { siteId, tool: name, ok: outcome.ok, status: outcome.status, ms: outcome.ms });
      recordCall(ctx, db, tool, outcome);
      data[name] = outcome.value;
      save({ [name]: outcome.value });
      return forModel(outcome);
    },
  };
}

/**
 * Before the chat: the `before` tools, together, each within its timeout.
 * A tool whose `{{prechat.*}}` the form left empty is skipped. Resolves the
 * data by tool name (a failure is kept as `{ error }`).
 */
export async function runBeforeTools(
  ctx: RequestCtx,
  options: { siteId: string; sessionId: string; tools: Tool[]; prechat: Record<string, string>; page: { url: string | null; title: string | null } },
): Promise<Record<string, unknown>> {
  const db = dbFrom(ctx.env);
  const before = options.tools.filter((t) => t.kind === 'http' && t.before && !missingPrechat(t, options.prechat).length);
  if (!db || !before.length) return {};
  const scope: TemplateScope = { prechat: options.prechat, args: {}, data: {}, page: options.page, conversation: { id: options.sessionId }, site: { id: options.siteId } };
  const results = await Promise.all(
    before.map(async (tool) => {
      const outcome = await callHttp(tool, scope, globalThis.fetch.bind(globalThis), () => ctx.platform.now());
      ctx.platform.log('tools.before', { siteId: options.siteId, tool: tool.name, ok: outcome.ok, status: outcome.status, ms: outcome.ms });
      recordCall(ctx, db, tool, outcome);
      return [tool.name, outcome.value] as const;
    }),
  );
  return Object.fromEntries(results);
}

// ---------------------------------------------------------------- after

export type AfterDeps = { db: D1Like; fetch: typeof fetch; secret?: string | undefined; now: () => number; log?: ((event: string, data?: object) => void) | undefined };

/** The after-chat tools' ids, for the job to run one step each. */
export async function afterToolIds(db: D1Like, siteId: string, now: number): Promise<string[]> {
  return (await siteTools(db, siteId, now)).filter((r) => r.enabled && r.run_after && r.kind === 'http').map((r) => r.id);
}

/**
 * One after-chat tool, with the whole conversation as its scope: `{{data}}`,
 * `{{transcript}}`, `{{summary}}`, `{{lead}}`, `{{attributes}}`,
 * `{{conversation}}` (all of it, as `conversation.completed` sends it). A POST
 * without a body sends that whole object as JSON. Throws when the API failed
 * in a way worth another try (5xx, timeout), so the job's step retries it.
 */
export async function runAfterTool(deps: AfterDeps, siteId: string, toolId: string, event: Record<string, unknown>): Promise<{ ok: boolean; status: number | null }> {
  const row = await deps.db.prepare('SELECT * FROM tools WHERE id = ? AND site_id = ?').bind(toolId, siteId).first<ToolRow>();
  if (!row || !deps.secret) return { ok: false, status: null };
  const opened = await openTool(row, deps.secret);
  const json = opened.headers.some((h) => h.name.toLowerCase() === 'content-type') ? [] : [{ name: 'Content-Type', value: 'application/json', secret: false }];
  const tool: Tool = opened.body || opened.method === 'GET' ? opened : { ...opened, body: '{{conversation}}', headers: [...opened.headers, ...json] };
  const lead = (event['lead'] ?? null) as Record<string, unknown> | null;
  const prechat: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...((lead?.['fields'] as Record<string, unknown> | null) ?? {}), name: lead?.['name'], email: lead?.['email'], phone: lead?.['phone'] })) {
    if (typeof value === 'string' && value) prechat[key] = value;
  }
  const scope: TemplateScope = {
    conversation: event,
    data: event['data'] ?? {},
    transcript: event['transcript'] ?? [],
    summary: event['summary'] ?? null,
    lead,
    prechat,
    attributes: event['attributes'] ?? {},
    page: event['page'] ?? {},
    site: { id: siteId },
    args: {},
  };
  const outcome = await callHttp(tool, scope, deps.fetch, deps.now);
  deps.log?.('tools.after', { siteId, tool: tool.name, ok: outcome.ok, status: outcome.status, ms: outcome.ms });
  await deps.db.prepare('UPDATE tools SET last_status = ?, last_error = ?, last_at = ? WHERE id = ?').bind(outcome.status, outcome.error ?? null, deps.now(), tool.id).run();
  const retry = !outcome.ok && (outcome.status === null || outcome.status >= 500 || outcome.status === 429);
  if (retry) throw new Error(`tool ${tool.name}: ${outcome.error ?? 'failed'}`);
  await saveDataStatement(deps.db, siteId, String(event['conversationId']), { [tool.name]: capSize(outcome.value) }, deps.now()).run();
  return { ok: outcome.ok, status: outcome.status };
}

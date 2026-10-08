import { cleanText } from '@helppuff/protocol';
import type { D1Like } from '../db/d1.js';
import type { Tool } from './store.js';
import { capSize, keyPaths, pickPaths, renderBody, renderHeader, renderUrl, type TemplateScope } from './template.js';

/**
 * Calling a tool. An HTTP tool sends its request with the templates filled
 * in, waits at most its timeout, and keeps the response (JSON, else the
 * text), cut to the keys it picks and to about 4 KB. An extract tool calls
 * nothing: it checks what the assistant passed and keeps that.
 *
 * Nothing here throws: a failure is a value (`{ error }`) the assistant can
 * read, so a slow or broken API never fails the chat.
 */

export type ToolOutcome = {
  ok: boolean;
  /** What is kept under the tool's name. */
  value: unknown;
  status: number | null;
  ms: number;
  error?: string;
};

const MAX_RESPONSE = 256 * 1024;
export const MAX_VALUE = 4000;

export async function callHttp(tool: Tool, scope: TemplateScope, fetcher: typeof fetch, now: () => number = Date.now, max = MAX_VALUE): Promise<ToolOutcome> {
  const started = now();
  const done = (outcome: Omit<ToolOutcome, 'ms'>): ToolOutcome => ({ ...outcome, ms: now() - started });
  let url: URL;
  try {
    url = new URL(renderUrl(tool.url, scope));
  } catch {
    return done({ ok: false, value: { error: 'invalid address' }, status: null, error: 'invalid_url' });
  }
  if (url.protocol !== 'https:') return done({ ok: false, value: { error: 'https only' }, status: null, error: 'not_https' });

  const headers = new Headers();
  for (const h of tool.headers) {
    if (!h.value) continue;
    try {
      headers.set(h.name, renderHeader(h.value, scope));
    } catch {
      // A header the runtime refuses is left out.
    }
  }
  let body: string | undefined;
  if (tool.body && tool.method !== 'GET') {
    const rendered = renderBody(tool.body, scope);
    body = rendered.text;
    if (rendered.json && !headers.has('content-type')) headers.set('content-type', 'application/json');
  }
  if (!headers.has('accept')) headers.set('accept', 'application/json, text/plain;q=0.9, */*;q=0.5');
  if (!headers.has('user-agent')) headers.set('user-agent', 'HelpPuff-Tools/1');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), tool.timeoutMs);
  try {
    const response = await fetcher(url.toString(), { method: tool.method, headers, ...(body !== undefined ? { body } : {}), signal: controller.signal, redirect: 'follow' });
    const raw = (await response.text()).slice(0, MAX_RESPONSE);
    let parsed: unknown;
    try {
      parsed = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      parsed = { text: cleanText(raw.replace(/<[^>]+>/g, ' '), 'output').slice(0, 2000) };
    }
    if (!response.ok) {
      return done({ ok: false, value: { error: `HTTP ${response.status}`, response: capSize(parsed, 1000) }, status: response.status, error: `http_${response.status}` });
    }
    return done({ ok: true, value: capSize(pickPaths(parsed, tool.pick), max), status: response.status });
  } catch (thrown) {
    const timedOut = controller.signal.aborted;
    return done({
      ok: false,
      value: { error: timedOut ? 'timeout' : 'unreachable' },
      status: null,
      error: timedOut ? 'timeout' : `fetch_failed:${String((thrown as Error)?.message ?? thrown).slice(0, 100)}`,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** An extract tool: the fields the assistant passed, cleaned. Missing required ones are named. */
export function extractFields(tool: Tool, args: Record<string, unknown>): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  for (const field of tool.fields) {
    const raw = args[field.name];
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue;
    const value = cleanText(String(raw), 'line').slice(0, 500);
    if (value) values[field.name] = value;
  }
  return { values, missing: tool.fields.filter((f) => f.required && !values[f.name]).map((f) => f.name) };
}

/** The `{{prechat.*}}` a tool's request uses that the form did not fill: such a tool is skipped before the chat. */
export function missingPrechat(tool: Tool, prechat: Record<string, string>): string[] {
  const text = [tool.url, ...tool.headers.map((h) => h.value), tool.body].join('\n');
  const used = [...new Set([...text.matchAll(/\{\{\s*prechat\.([\w-]+)\s*\}\}/g)].map((m) => m[1]!))];
  return used.filter((key) => !prechat[key]?.trim());
}

/** The keys a response had, kept on the tool for the prompt's autocomplete. */
export function responseKeys(value: unknown): string[] {
  return keyPaths(value);
}

// ------------------------------------------------------------ conversation data

export function parseData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function readData(db: D1Like, conversationId: string): Promise<Record<string, unknown>> {
  const row = await db.prepare('SELECT data FROM conversations WHERE id = ?').bind(conversationId).first<{ data: string | null }>();
  return parseData(row?.data);
}

/**
 * Keep tool values on the conversation: each replaces what that tool had.
 * The row may not exist yet (it is written after the first response), so
 * this inserts a stub the start's own insert then fills.
 */
export function saveDataStatement(db: D1Like, siteId: string, conversationId: string, values: Record<string, unknown>, now: number) {
  const entries = Object.entries(values).filter(([name]) => /^[a-z][a-z0-9_]*$/.test(name));
  const set = entries.map(() => `'$.' || ?, json(?)`).join(', ');
  const params = entries.flatMap(([name, value]) => [name, JSON.stringify(value ?? null)]);
  return db
    .prepare(
      `INSERT INTO conversations (id, site_id, started_at, last_at, message_count, data) VALUES (?, ?, ?, ?, 0, json_set('{}', ${set}))
       ON CONFLICT (id) DO UPDATE SET data = json_set(coalesce(conversations.data, '{}'), ${set})`,
    )
    .bind(conversationId, siteId, now, now, ...params, ...params);
}

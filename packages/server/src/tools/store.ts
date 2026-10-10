import {
  MAX_TOOLS_PER_SITE,
  RESERVED_TOOL_NAMES,
  TOOL_KINDS,
  TOOL_METHODS,
  TOOL_NAME,
  TOOL_TIMEOUT_MS,
  toolArgs,
  type ToolHeader,
  type ToolKind,
  type ToolMethod,
  type ToolParam,
} from '@helppuff/protocol';
import { HelpPuffError } from '../core/errors.js';
import { open, seal } from '../core/secretbox.js';
import { ensureSchema, type D1Like } from '../db/d1.js';
import { renderUrl } from './template.js';

/**
 * The owner's tools, one D1 row each (`tools`, migration 12). Secret header
 * values are sealed with HELPPUFF_SECRET (`core/secretbox.ts`): the database
 * alone opens nothing, and no route ever returns them.
 */

export type ToolRow = {
  id: string;
  site_id: string;
  name: string;
  kind: string;
  description: string | null;
  method: string | null;
  url: string | null;
  headers: string | null;
  body: string | null;
  parameters: string | null;
  fields: string | null;
  pick: string | null;
  keys: string | null;
  timeout_ms: number;
  run_before: number;
  run_after: number;
  /** An after-chat tool's condition, JSON `{ path, in? }`. */
  run_when?: string | null;
  enabled: number;
  last_status: number | null;
  last_error: string | null;
  last_at: number | null;
  created_at: number;
  updated_at: number;
};

/** A tool ready to run: secrets opened. */
export type Tool = {
  id: string;
  name: string;
  kind: ToolKind;
  description: string;
  method: ToolMethod;
  url: string;
  headers: ToolHeader[];
  body: string;
  parameters: ToolParam[];
  fields: ToolParam[];
  pick: string[];
  keys: string[];
  timeoutMs: number;
  before: boolean;
  after: boolean;
  /** After the chat, run only when this holds (`labels.leadQuality` in `["hot"]`; no `in`: has a value). */
  when: ToolWhen | null;
  enabled: boolean;
};

/** A condition on the conversation.completed data. */
export type ToolWhen = { path: string; in?: string[] };

const SECRET_PURPOSE = 'tool-header';

const list = <T>(raw: string | null, ok: (v: unknown) => v is T): T[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(ok) : [];
  } catch {
    return [];
  }
};
const isParam = (v: unknown): v is ToolParam => Boolean(v && typeof v === 'object' && typeof (v as ToolParam).name === 'string');
const isHeader = (v: unknown): v is ToolHeader => Boolean(v && typeof v === 'object' && typeof (v as ToolHeader).name === 'string' && typeof (v as ToolHeader).value === 'string');
const isString = (v: unknown): v is string => typeof v === 'string';

/** The row as stored, secrets still sealed. */
function decode(row: ToolRow): Tool {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === 'extract' ? 'extract' : 'http',
    description: row.description ?? '',
    method: (TOOL_METHODS as readonly string[]).includes(row.method ?? '') ? (row.method as ToolMethod) : 'GET',
    url: row.url ?? '',
    headers: list(row.headers, isHeader).map((h) => ({ name: h.name, value: h.value, secret: Boolean(h.secret) })),
    body: row.body ?? '',
    parameters: list(row.parameters, isParam).map((p) => ({ name: p.name, description: String(p.description ?? ''), required: Boolean(p.required) })),
    fields: list(row.fields, isParam).map((p) => ({ name: p.name, description: String(p.description ?? ''), required: Boolean(p.required) })),
    pick: list(row.pick, isString),
    keys: list(row.keys, isString),
    timeoutMs: row.timeout_ms || TOOL_TIMEOUT_MS.default,
    before: Boolean(row.run_before),
    after: Boolean(row.run_after),
    when: parseWhen(row.run_when ?? null),
    enabled: Boolean(row.enabled),
  };
}

function parseWhen(raw: string | null): ToolWhen | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { path?: unknown; in?: unknown };
    if (typeof value.path !== 'string') return null;
    return { path: value.path, ...(Array.isArray(value.in) ? { in: value.in.filter(isString) } : {}) };
  } catch {
    return null;
  }
}

/** Whether an after-chat tool's condition holds for this conversation (no condition: always). */
export function whenHolds(when: ToolWhen | null, event: Record<string, unknown>): boolean {
  if (!when) return true;
  const value = when.path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), event);
  const text = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (!when.in?.length) return text !== '' && text !== '[]' && text !== '{}';
  return when.in.some((option) => option.toLowerCase() === text.toLowerCase());
}

/** What the dashboard, the API and the CLI see: secret values never leave. */
export function toolView(row: ToolRow) {
  const tool = decode(row);
  return {
    id: tool.id,
    name: tool.name,
    kind: tool.kind,
    description: tool.description,
    ...(tool.kind === 'http'
      ? {
          method: tool.method,
          url: tool.url,
          headers: tool.headers.map((h) => (h.secret ? { name: h.name, value: '', secret: true, set: Boolean(h.value) } : { ...h, set: true })),
          body: tool.body,
          parameters: withArgs(tool),
          pick: tool.pick,
          timeoutMs: tool.timeoutMs,
        }
      : { fields: tool.fields }),
    /** The keys it returns or saves, for `{{name.key}}` in the prompt. */
    keys: tool.kind === 'extract' ? tool.fields.map((f) => f.name) : tool.keys,
    before: tool.before,
    after: tool.after,
    when: tool.when,
    enabled: tool.enabled,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastAt: row.last_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export type ToolView = ReturnType<typeof toolView>;

/** The parameters the request uses (`{{args.*}}`), with the owner's descriptions where given. */
export function withArgs(tool: Pick<Tool, 'url' | 'headers' | 'body' | 'parameters'>): ToolParam[] {
  return toolArgs(tool).map((name) => tool.parameters.find((p) => p.name === name) ?? { name, description: '', required: true });
}

/** Open the sealed header values. A value sealed under an older secret is dropped (and logged by the caller's test). */
export async function openTool(row: ToolRow, secret: string): Promise<Tool> {
  const tool = decode(row);
  const headers = await Promise.all(tool.headers.map(async (h) => (h.secret && h.value ? { ...h, value: (await open(secret, SECRET_PURPOSE, h.value)) ?? '' } : h)));
  return { ...tool, headers };
}

// ------------------------------------------------------------------ reading

const memo = new Map<string, { at: number; rows: ToolRow[] }>();
const MEMO_MS = 30_000;

/** The site's tools, enabled or not, read at most every 30 s per isolate (writes here forget it at once). */
export async function siteTools(db: D1Like, siteId: string, now: number): Promise<ToolRow[]> {
  const cached = memo.get(siteId);
  if (cached && now - cached.at < MEMO_MS) return cached.rows;
  await ensureSchema(db);
  const rows = (await db.prepare('SELECT * FROM tools WHERE site_id = ? ORDER BY name').bind(siteId).all<ToolRow>()).results;
  memo.set(siteId, { at: now, rows });
  return rows;
}

export function forgetTools(siteId: string): void {
  memo.delete(siteId);
}

// --------------------------------------------------------------- validating

const bad = (message: string, detail: string) => new HelpPuffError('bad_request', { message, detail });

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function params(value: unknown, what: string): ToolParam[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw bad(`${what} must be a list.`, 'tool_params');
  const out: ToolParam[] = [];
  for (const raw of value.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const name = text(p['name'], 64);
    if (!/^[a-zA-Z_][\w]{0,63}$/.test(name)) throw bad(`Check "${name.slice(0, 40)}": letters, digits and _ only.`, 'tool_param_name');
    if (out.some((o) => o.name === name)) continue;
    out.push({ name, description: text(p['description'], 300), required: p['required'] !== false });
  }
  return out;
}

/** The URL must be https with a real host, and the host fixed: only the path and query may use `{{…}}`. */
export function validToolUrl(value: unknown): string {
  const raw = text(value, 2000);
  let url: URL;
  try {
    url = new URL(renderUrl(raw, {}).replace(/\{\{|\}\}/g, ''));
  } catch {
    throw bad('Enter the full address, starting with https://', 'tool_url');
  }
  const origin = /^https:\/\/[^/?#]+/i.exec(raw)?.[0] ?? '';
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password || origin.includes('{{')) {
    throw bad('The address must start with https:// and name a real host (only the path and query may use {{…}}).', 'tool_url');
  }
  return raw;
}

export type Stored = Omit<ToolRow, 'id' | 'site_id' | 'last_status' | 'last_error' | 'last_at' | 'created_at' | 'updated_at'>;

/**
 * A tool from the dashboard's (or the API's) JSON, over `current` when
 * editing. Secret header values are sealed; an empty one keeps what was stored.
 */
export async function validTool(body: Record<string, unknown>, current: ToolRow | null, others: string[], secret: string): Promise<Stored> {
  const was = current ? decode(current) : null;
  const pick = <T>(key: string, read: (v: unknown) => T, fallback: T): T => (body[key] === undefined ? fallback : read(body[key]));

  const name = pick('name', (v) => text(v, 48), was?.name ?? '');
  if (!TOOL_NAME.test(name)) throw bad('A name is 2 to 48 lowercase letters, digits or _, starting with a letter: like order_status.', 'tool_name');
  if ((RESERVED_TOOL_NAMES as readonly string[]).includes(name)) throw bad(`"${name}" is taken by HelpPuff: choose another name.`, 'tool_name_reserved');
  if (others.includes(name)) throw bad(`There is already a tool called ${name}.`, 'tool_name_taken');

  const rawKind = pick<unknown>('kind', (v) => v, was?.kind ?? 'http');
  if (!(TOOL_KINDS as readonly unknown[]).includes(rawKind)) throw bad('The kind is http or extract.', 'tool_kind');
  const kind = rawKind as ToolKind;
  const description = pick('description', (v) => text(v, 1000), was?.description ?? '');
  if (!description) throw bad('Describe what the tool does and when to use it: the assistant reads it.', 'tool_description');

  const timeoutMs = pick(
    'timeoutMs',
    (v) => Math.round(Math.min(TOOL_TIMEOUT_MS.max, Math.max(TOOL_TIMEOUT_MS.min, Number(v) || TOOL_TIMEOUT_MS.default))),
    was?.timeoutMs ?? TOOL_TIMEOUT_MS.default,
  );
  const flags = {
    run_before: pick('before', Boolean, was?.before ?? false) ? 1 : 0,
    run_after: pick('after', Boolean, was?.after ?? false) ? 1 : 0,
    enabled: pick('enabled', (v) => v !== false, was?.enabled ?? true) ? 1 : 0,
  };

  if (kind === 'extract') {
    const fields = pick('fields', (v) => params(v, 'Fields'), was?.fields ?? []);
    if (!fields.length) throw bad('Add at least one field to save, like order_number.', 'tool_fields');
    return {
      name,
      kind,
      description,
      method: null,
      url: null,
      headers: null,
      body: null,
      parameters: null,
      fields: JSON.stringify(fields),
      pick: null,
      keys: null,
      timeout_ms: timeoutMs,
      ...flags,
      // An extract tool calls nothing: it only runs in the chat.
      run_before: 0,
      run_after: 0,
      run_when: null,
    };
  }

  const method = pick('method', (v) => String(v).toUpperCase(), was?.method ?? 'GET');
  if (!(TOOL_METHODS as readonly string[]).includes(method)) throw bad('The method is GET, POST, PUT, PATCH or DELETE.', 'tool_method');
  const url = pick('url', validToolUrl, was?.url ?? '');
  if (!url) throw bad('Enter the address to call.', 'tool_url');
  const bodyText = pick('body', (v) => (typeof v === 'string' ? v.slice(0, 20_000) : ''), was?.body ?? '');

  let headers: ToolHeader[];
  if (body['headers'] === undefined) headers = was?.headers ?? [];
  else {
    if (!Array.isArray(body['headers'])) throw bad('Headers must be a list of { name, value }.', 'tool_headers');
    headers = [];
    for (const raw of body['headers'].slice(0, 30)) {
      if (!raw || typeof raw !== 'object') continue;
      const h = raw as Record<string, unknown>;
      const hName = text(h['name'], 100);
      if (!hName) continue;
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(hName)) throw bad(`Check the header "${hName.slice(0, 40)}".`, 'tool_header_name');
      const value = typeof h['value'] === 'string' ? h['value'].replace(/[\r\n]+/g, ' ').slice(0, 8000) : '';
      const isSecret = h['secret'] === true;
      if (isSecret) {
        // Empty: keep what is stored (the dashboard never sees it).
        const kept = was?.headers.find((o) => o.secret && o.name.toLowerCase() === hName.toLowerCase())?.value ?? '';
        headers.push({ name: hName, value: value ? await seal(secret, SECRET_PURPOSE, value) : kept, secret: true });
      } else headers.push({ name: hName, value, secret: false });
    }
  }

  const when = pick('when', readWhen, was?.when ?? null);
  const parameters = pick('parameters', (v) => params(v, 'Parameters'), was?.parameters ?? []);
  const pickPaths = pick('pick', (v) => (Array.isArray(v) ? v.filter(isString).map((p) => p.trim()).filter((p) => /^[\w-]+(\.[\w-]+)*$/.test(p)).slice(0, 30) : []), was?.pick ?? []);
  const keys = pick('keys', (v) => (Array.isArray(v) ? v.filter(isString).filter((p) => /^[\w-]+(\.[\w-]+)*$/.test(p)).slice(0, 100) : []), was?.keys ?? []);
  return {
    name,
    kind,
    description,
    method,
    url,
    headers: JSON.stringify(headers),
    body: bodyText || null,
    parameters: JSON.stringify(parameters),
    fields: null,
    pick: pickPaths.length ? JSON.stringify(pickPaths) : null,
    keys: keys.length ? JSON.stringify(keys) : null,
    timeout_ms: timeoutMs,
    ...flags,
    run_when: when && flags.run_after ? JSON.stringify(when) : null,
  };
}

/** `when` as sent: `{ path, in }`, or null to clear it. */
function readWhen(value: unknown): ToolWhen | null {
  if (value === null || value === '') return null;
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  const path = typeof raw?.['path'] === 'string' ? raw['path'].trim() : '';
  if (!/^[\w-]+(\.[\w-]+){0,5}$/.test(path)) throw bad('A condition is { "path": "labels.leadQuality", "in": ["hot"] }: a path in the conversation.completed data, and the values it may have.', 'tool_when');
  const options = Array.isArray(raw?.['in']) ? (raw['in'] as unknown[]).filter(isString).map((o) => o.trim()).filter(Boolean).slice(0, 10).map((o) => o.slice(0, 100)) : [];
  return { path, ...(options.length ? { in: options } : {}) };
}

export async function countTools(db: D1Like, siteId: string): Promise<number> {
  return (await db.prepare('SELECT count(*) AS n FROM tools WHERE site_id = ?').bind(siteId).first<{ n: number }>())?.n ?? 0;
}

export { MAX_TOOLS_PER_SITE };

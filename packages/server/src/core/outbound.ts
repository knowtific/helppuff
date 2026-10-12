import { TOOL_METHODS, type ToolHeader, type ToolMethod } from '@helppuff/protocol';
import { HelpPuffError } from './errors.js';
import { open, seal } from './secretbox.js';
import { renderBody, renderHeader, renderUrl, type TemplateScope } from '../tools/template.js';

/**
 * A request the owner wrote and HelpPuff sends: a tool's call, a webhook in
 * its own format, the email service. https with a fixed host (only the path
 * and query may use `{{…}}`), headers whose secret values are sealed with
 * HELPPUFF_SECRET (the database alone opens nothing, no route returns them),
 * and a body template (`tools/template.ts`: each value encoded for its place).
 */

export type OutboundSpec = { method: ToolMethod; url: string; headers: ToolHeader[]; body: string };

const bad = (message: string, detail: string) => new HelpPuffError('bad_request', { message, detail });

/** The URL must be https with a real host, and the host fixed: only the path and query may use `{{…}}`. */
export function validOutboundUrl(value: unknown, detail = 'tool_url'): string {
  const raw = typeof value === 'string' ? value.trim().slice(0, 2000) : '';
  let url: URL;
  try {
    url = new URL(renderUrl(raw, {}).replace(/\{\{|\}\}/g, ''));
  } catch {
    throw bad('Enter the full address, starting with https://', detail);
  }
  const origin = /^https:\/\/[^/?#]+/i.exec(raw)?.[0] ?? '';
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password || origin.includes('{{')) {
    throw bad('The address must start with https:// and name a real host (only the path and query may use {{…}}).', detail);
  }
  return raw;
}

export const isHeader = (v: unknown): v is ToolHeader => Boolean(v && typeof v === 'object' && typeof (v as ToolHeader).name === 'string' && typeof (v as ToolHeader).value === 'string');

/** Stored headers (JSON), secret values still sealed. */
export function storedHeaders(raw: string | null | undefined): ToolHeader[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isHeader).map((h) => ({ name: h.name, value: h.value, secret: Boolean(h.secret) })) : [];
  } catch {
    return [];
  }
}

/**
 * Headers from the dashboard's (or the API's) JSON, secret values sealed. An
 * empty secret value keeps what was stored under that name: the dashboard
 * never sees it, so it cannot send it back.
 */
export async function sealHeaders(input: unknown, was: ToolHeader[], secret: string, purpose: string, detail = 'tool'): Promise<ToolHeader[]> {
  if (!Array.isArray(input)) throw bad('Headers must be a list of { name, value }.', `${detail}_headers`);
  const headers: ToolHeader[] = [];
  for (const raw of input.slice(0, 30)) {
    if (!raw || typeof raw !== 'object') continue;
    const h = raw as Record<string, unknown>;
    const name = typeof h['name'] === 'string' ? h['name'].trim().slice(0, 100) : '';
    if (!name) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw bad(`Check the header "${name.slice(0, 40)}".`, `${detail}_header_name`);
    const value = typeof h['value'] === 'string' ? h['value'].replace(/[\r\n]+/g, ' ').slice(0, 8000) : '';
    if (h['secret'] === true) {
      const kept = was.find((o) => o.secret && o.name.toLowerCase() === name.toLowerCase())?.value ?? '';
      headers.push({ name, value: value ? await seal(secret, purpose, value) : kept, secret: true });
    } else headers.push({ name, value, secret: false });
  }
  return headers;
}

/** What the dashboard, the API and the CLI see: a secret header's value never leaves. */
export const headersView = (headers: ToolHeader[]) =>
  headers.map((h) => (h.secret ? { name: h.name, value: '', secret: true, set: Boolean(h.value) } : { name: h.name, value: h.value, secret: false, set: true }));

/** Open the sealed values; null when one cannot be opened (HELPPUFF_SECRET changed, or none given). */
export async function openHeaders(headers: ToolHeader[], secret: string | undefined, purpose: string): Promise<ToolHeader[] | null> {
  const out: ToolHeader[] = [];
  for (const h of headers) {
    if (!h.secret || !h.value) {
      out.push(h);
      continue;
    }
    const value = secret ? await open(secret, purpose, h.value) : null;
    if (value === null) return null;
    out.push({ ...h, value });
  }
  return out;
}

export const validMethod = (value: unknown, fallback: ToolMethod = 'POST'): ToolMethod => {
  const method = value === undefined || value === null || value === '' ? fallback : String(value).toUpperCase();
  if (!(TOOL_METHODS as readonly string[]).includes(method)) throw bad('The method is GET, POST, PUT, PATCH or DELETE.', 'request_method');
  return method as ToolMethod;
};

export type Sent = { ok: boolean; status: number | null; error: string | null; retryable: boolean };

const retryable = (status: number) => status === 429 || status >= 500;

/**
 * Send it once, with the templates filled from `scope`. `fallbackBody` is
 * sent when the body is empty; `extraHeaders` sees the body actually sent
 * (a webhook's signature). Never throws; the response body is not kept.
 */
export async function sendOutbound(
  spec: OutboundSpec,
  scope: TemplateScope,
  fetcher: typeof fetch,
  options: { timeoutMs: number; userAgent: string; fallbackBody?: string; extraHeaders?: (body: string) => Promise<Record<string, string>> },
): Promise<Sent> {
  let url: URL;
  try {
    url = new URL(renderUrl(spec.url, scope));
  } catch {
    return { ok: false, status: null, error: 'The address is not valid once filled in.', retryable: false };
  }
  if (url.protocol !== 'https:') return { ok: false, status: null, error: 'https only', retryable: false };
  const headers = new Headers();
  for (const h of spec.headers) {
    if (!h.value) continue;
    try {
      headers.set(h.name, renderHeader(h.value, scope));
    } catch {
      // A header the runtime refuses is left out.
    }
  }
  let body: string | undefined;
  if (spec.method !== 'GET') {
    if (spec.body.trim()) {
      const rendered = renderBody(spec.body, scope);
      body = rendered.text;
      if (rendered.json && !headers.has('content-type')) headers.set('content-type', 'application/json');
    } else if (options.fallbackBody !== undefined) {
      body = options.fallbackBody;
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
  }
  if (!headers.has('user-agent')) headers.set('user-agent', options.userAgent);
  for (const [name, value] of Object.entries((await options.extraHeaders?.(body ?? '')) ?? {})) headers.set(name, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetcher(url.toString(), { method: spec.method, headers, ...(body !== undefined ? { body } : {}), signal: controller.signal, redirect: 'manual' });
    await response.body?.cancel().catch(() => {});
    if (response.ok) return { ok: true, status: response.status, error: null, retryable: false };
    return { ok: false, status: response.status, error: `HTTP ${response.status}`, retryable: retryable(response.status) };
  } catch (thrown) {
    const timedOut = controller.signal.aborted;
    return { ok: false, status: null, error: timedOut ? `No answer within ${options.timeoutMs / 1000} s` : String((thrown as Error)?.message ?? thrown).slice(0, 200), retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

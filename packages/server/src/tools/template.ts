/**
 * `{{…}}` in a tool's URL, headers and body: what the request is sent with.
 *
 *  - `{{prechat.email}}`: the pre-chat form's answers (custom fields too)
 *  - `{{args.order_number}}`: what the assistant fills in when it calls the tool
 *  - `{{data.crm_lookup.tier}}`: what a tool already returned in this chat
 *  - `{{page.url}}`, `{{page.title}}`, `{{conversation.id}}`, `{{site.id}}`
 *  - after the chat: `{{transcript}}`, `{{summary}}`, `{{lead}}`,
 *    `{{attributes}}`, `{{data}}`, `{{conversation}}`
 *
 * Values are encoded for where they go: URL-encoded in the URL, one line in a
 * header, JSON in a JSON body (a whole `"{{data}}"` becomes the object
 * itself), so nothing a visitor types can break out of its place.
 */

export type TemplateScope = Record<string, unknown>;

const REF = /\{\{\s*([\w]+(?:\.[\w-]+)*)\s*\}\}/g;

/** Roots a tool's template may use; a tool cannot be named after one. */
export const TEMPLATE_ROOTS = ['prechat', 'args', 'data', 'page', 'conversation', 'site', 'transcript', 'summary', 'lead', 'attributes'] as const;

export function lookup(scope: TemplateScope, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && !Array.isArray(acc) && Object.prototype.hasOwnProperty.call(acc, key)) return (acc as Record<string, unknown>)[key];
    if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[Number(key)];
    return undefined;
  }, scope);
}

export function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Every `{{path}}` in the text, in order, once each. */
export function refsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(REF)].map((m) => m[1]!))];
}

export function renderUrl(url: string, scope: TemplateScope): string {
  return url.replace(REF, (_m, path: string) => encodeURIComponent(asText(lookup(scope, path))));
}

export function renderHeader(value: string, scope: TemplateScope): string {
  return value.replace(REF, (_m, path: string) => asText(lookup(scope, path))).replace(/[\r\n]+/g, ' ').slice(0, 8000);
}

const WHOLE = /^\{\{\s*([\w]+(?:\.[\w-]+)*)\s*\}\}$/;

function fill(node: unknown, scope: TemplateScope): unknown {
  if (typeof node === 'string') {
    const whole = WHOLE.exec(node);
    if (whole) {
      const value = lookup(scope, whole[1]!);
      return value === undefined ? null : value;
    }
    return node.replace(REF, (_m, path: string) => asText(lookup(scope, path)));
  }
  if (Array.isArray(node)) return node.map((n) => fill(n, scope));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, fill(v, scope)]));
  return node;
}

/** A JSON body, with bare placeholders (`{"n": {{args.n}}}`) read as values. Null when it is not JSON. */
export function parseJsonTemplate(body: string): unknown {
  const attempt = (text: string) => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false as const };
    }
  };
  const direct = attempt(body);
  if (direct.ok) return direct.value;
  const quoted = attempt(quoteBareRefs(body));
  return quoted.ok ? quoted.value : null;
}

/** `{{x}}` outside a JSON string becomes `"{{x}}"`; those inside strings stay. */
function quoteBareRefs(body: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\') out += body[++i] ?? '';
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '{' && body[i + 1] === '{') {
      const end = body.indexOf('}}', i + 2);
      if (end > 0) {
        out += `"${body.slice(i, end + 2)}"`;
        i = end + 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** The body to send, and whether it is JSON. */
export function renderBody(body: string, scope: TemplateScope): { text: string; json: boolean } {
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = parseJsonTemplate(trimmed);
    if (parsed !== null) return { text: JSON.stringify(fill(parsed, scope)), json: true };
  }
  return { text: body.replace(REF, (_m, path: string) => asText(lookup(scope, path))), json: false };
}

/** Pull `paths` out of a response, keeping their place: `["customer.tier", "orders"]`. Empty picks everything. */
export function pickPaths(value: unknown, paths: readonly string[]): unknown {
  if (!paths.length || !value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const found = lookup(value as TemplateScope, path);
    if (found === undefined) continue;
    const keys = path.split('.');
    let at = out;
    for (const key of keys.slice(0, -1)) {
      if (!at[key] || typeof at[key] !== 'object') at[key] = {};
      at = at[key] as Record<string, unknown>;
    }
    at[keys[keys.length - 1]!] = found;
  }
  return out;
}

/** Every key path in a value (objects only, arrays as a whole), for the prompt's autocomplete. */
export function keyPaths(value: unknown, prefix = '', depth = 0, out: string[] = []): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return out;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[\w-]{1,64}$/.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(path);
    if (out.length >= 100) return out;
    keyPaths(inner, path, depth + 1, out);
  }
  return out;
}

/**
 * A value kept to about `max` characters of JSON: a long string is cut, an
 * object keeps the keys that fit, an array the items that fit.
 */
export function capSize(value: unknown, max = 4000): unknown {
  const size = (v: unknown) => JSON.stringify(v)?.length ?? 0;
  if (size(value) <= max) return value;
  if (typeof value === 'string') return `${value.slice(0, max - 1)}…`;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const next = capSize(item, Math.max(200, max - size(out)));
      if (size([...out, next]) > max) break;
      out.push(next);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const next = capSize(item, Math.max(200, max - size(out) - key.length - 6));
      if (size({ ...out, [key]: next }) > max) break;
      out[key] = next;
    }
    return out;
  }
  return value;
}

import { HTTP_STATUS_FOR_ERROR } from '@helppuff/protocol';
import { PUBLIC_ENDPOINTS, TAGS, type Endpoint } from './registry.js';
import { SCOPES } from './scopes.js';

/**
 * The API's description, from the registry (api/registry.ts): an OpenAPI 3.1
 * document (served at `/api/v1/openapi.json`) and the wiki's API reference
 * (written by `pnpm sync:docs`). One source, so the docs cannot drift.
 */

const COMMON_ERRORS = [
  { status: 400, code: 'bad_request', when: 'The body or a parameter is invalid; `message` says which.' },
  { status: 401, code: 'unauthorized', when: 'No key, or a key that is unknown, revoked or expired.' },
  { status: 403, code: 'forbidden', when: 'The key lacks this route\'s scope, belongs to another site, or is used from an address it does not allow.' },
  { status: 404, code: 'not_found', when: 'No such record (or it belongs to another site).' },
  { status: 429, code: 'rate_limited', when: 'Over the key\'s requests a minute. Wait `retryAfter` seconds (also in `Retry-After`).' },
];

const PLACEHOLDER: Record<string, string> = { id: 'ID', email: 'EMAIL', version: 'VERSION' };
const openApiPath = (path: string) => path.replace(/:([A-Za-z]+)/g, '{$1}');
const curlPath = (path: string) => path.replace(/:([A-Za-z]+)/g, (_m, name: string) => PLACEHOLDER[name] ?? name.toUpperCase());
const pathParams = (path: string) => [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
const operationId = (e: Endpoint) =>
  `${e.method.toLowerCase()}${e.path
    .split(/[/.:-]/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join('')}`;

export function openApiDocument(serverUrl: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of PUBLIC_ENDPOINTS) {
    const status = String(e.status ?? 200);
    const responseContent = e.csv !== undefined ? { 'text/csv': { example: e.csv } } : e.response !== undefined ? { 'application/json': { example: e.response } } : undefined;
    const errors = [...COMMON_ERRORS, ...(e.errors ?? [])];
    const byStatus = new Map<number, string[]>();
    for (const err of errors) byStatus.set(err.status, [...(byStatus.get(err.status) ?? []), `\`${err.code}\`: ${err.when}`]);
    (paths[openApiPath(e.path)] ??= {})[e.method.toLowerCase()] = {
      tags: [e.tag],
      operationId: operationId(e),
      summary: e.summary,
      description: [e.description, e.scope === 'any' ? 'Any valid key.' : `Scope: \`${e.scope}\`.`].filter(Boolean).join('\n\n'),
      'x-scope': e.scope,
      parameters: [
        ...pathParams(e.path).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
        ...(e.query ?? []).map((q) => ({ name: q.name, in: 'query', required: Boolean(q.required), description: q.description, schema: { type: 'string' }, ...(q.example ? { example: q.example } : {}) })),
      ],
      ...(e.body !== undefined
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  ...(e.fields
                    ? {
                        schema: {
                          type: 'object',
                          properties: Object.fromEntries(e.fields.map((f) => [f.name, { description: f.description }])),
                          ...(e.fields.some((f) => f.required) ? { required: e.fields.filter((f) => f.required).map((f) => f.name) } : {}),
                        },
                      }
                    : {}),
                  example: e.body,
                },
              },
            },
          }
        : {}),
      ...(e.raw ? { requestBody: { required: true, description: e.raw.description, content: { [e.raw.contentType]: { schema: { type: 'string', format: 'binary' } } } } } : {}),
      responses: {
        [status]: { description: 'Success', ...(responseContent ? { content: responseContent } : {}) },
        ...Object.fromEntries(
          [...byStatus].map(([code, lines]) => [String(code), { description: lines.join(' '), content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }]),
        ),
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'HelpPuff API',
      version: 'v1',
      description:
        'Everything HelpPuff does, over HTTPS: chat with the assistant from your own server, and manage leads, callbacks, conversations, knowledge, the prompt, settings, webhooks, the team and API keys. Authenticate with `Authorization: Bearer <API key>`; create keys in the dashboard (Settings → API keys) or with `helppuff keys create`.',
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    tags: TAGS,
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: `An API key (\`hp_live_…\`). Scopes: ${Object.keys(SCOPES).join(', ')}.`,
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', enum: Object.keys(HTTP_STATUS_FOR_ERROR) },
                message: { type: 'string', description: 'Safe to show to a person.' },
                retryAfter: { type: 'integer', description: 'Seconds to wait, on 429.' },
              },
            },
          },
        },
      },
    },
  };
}

/** A body as a shell argument: single-quoted, with single quotes escaped. */
const shellJson = (value: unknown) => `'${JSON.stringify(value, null, 2).replace(/'/g, `'\\''`)}'`;

function curl(e: Endpoint): string {
  const example = (e.query ?? []).filter((q) => q.required);
  const query = example.length ? `?${example.map((q) => `${q.name}=${encodeURIComponent(q.example ?? q.name)}`).join('&')}` : '';
  const lines = [`curl${e.method === 'GET' ? '' : ` -X ${e.method}`} "$HELPPUFF_URL/api/v1${curlPath(e.path)}${query}"`, '  -H "Authorization: Bearer $HELPPUFF_API_KEY"'];
  if (e.raw) lines.push(`  -H "Content-Type: ${e.raw.contentType}"`, '  --data-binary @price-list.pdf');
  else if (e.body !== undefined) lines.push('  -H "Content-Type: application/json"', `  -d ${shellJson(e.body)}`);
  return lines.join(' \\\n');
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

// --------------------------------------------------------------- TypeScript

/**
 * TypeScript for the reference, inferred from the registry's examples: a
 * request type from the body (with the field descriptions as comments), a
 * response type from the example response, and a `fetch` call using both.
 * Close enough to copy into a project; `openapi.json` is the machine-readable
 * contract for generators.
 */

/** Keys whose objects are maps, not fixed shapes. */
const RECORD_KEYS = new Set(['metadata', 'contact', 'fields', 'counts', 'facts', 'pages', 'ms', 'embedding', 'utm', 'limits']);
/** Keys holding protocol messages: the shared `Message` type on the overview page. */
const MESSAGE_KEYS = new Set(['messages']);

/** A null in an example: a time when the key says so, else text. */
const nullType = (key: string) => (/(?:At|_at|^at|^ts|Ms)$/.test(key) ? 'number | null' : 'string | null');

/**
 * A TypeScript type for an example value. `optional`: the nested keys of a
 * request body (everything below a top-level field is optional there).
 * `nullable`: keys whose value may be null though the example has one.
 */
function tsType(value: unknown, key = '', indent = '', options: { optional?: boolean; nullable?: readonly string[] } = {}): string {
  if (MESSAGE_KEYS.has(key) && Array.isArray(value)) return 'Message[]';
  if (value === null) return nullType(key);
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    if (!value.length) return 'string[]';
    const item = tsType(value[0], key.replace(/s$/, ''), indent, options);
    return item.includes('\n') || item.includes('|') ? `Array<${item}>` : `${item}[]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (RECORD_KEYS.has(key) && entries.length) return `Record<string, ${tsType(entries[0]![1], '', indent, options)}>`;
    if (!entries.length) return 'Record<string, unknown>';
    const inner = `${indent}  `;
    const field = ([k, v]: [string, unknown]) => {
      const type = tsType(v, k, inner, options);
      const nullable = options.nullable?.includes(k) && !type.includes('null') ? `${type} | null` : type;
      return `${inner}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}${options.optional ? '?' : ''}: ${nullable};`;
    };
    return `{\n${entries.map(field).join('\n')}\n${indent}}`;
  }
  return 'unknown';
}

/** An example as a TypeScript object literal: keys unquoted where they can be, single-quoted strings. */
function jsLiteral(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:')
    .replace(/"((?:[^"\\]|\\.)*)"/g, (_all, inner: string) => `'${inner.replace(/\\"/g, '"').replace(/'/g, "\\'")}'`);
}

/** `Start a conversation` → `StartConversation`. */
const typeName = (e: Endpoint) =>
  e.summary
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !/^(a|an|the|of|is|on|by|or)$/i.test(w))
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');

/** A JSDoc comment, wrapped to fit a code box (about 80 characters). */
function docComment(text: string): string {
  if (text.length <= 72) return `  /** ${text} */\n`;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && `${line} ${word}`.length > 74) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return `  /**\n${lines.map((l) => `   * ${l}`).join('\n')}\n   */\n`;
}

function requestType(e: Endpoint, name: string): string | null {
  if (e.body === undefined || e.raw) return null;
  const body = (e.body ?? {}) as Record<string, unknown>;
  const fields = e.fields ?? Object.keys(body).map((k) => ({ name: k, description: '', required: false }));
  if (!fields.length) return `type ${name}Request = Record<string, never>;`;
  const lines = fields.map((f) => {
    const comment = f.description ? docComment(f.description.replace(/\*\//g, '* /')) : '';
    const type = f.name in body ? tsType(body[f.name], f.name, '  ', { optional: true }) : f.name === 'action' ? '{ id: string; value: string; label?: string }' : 'string';
    return `${comment}  ${f.name}${f.required ? '' : '?'}: ${type};`;
  });
  return `type ${name}Request = {\n${lines.join('\n')}\n};`;
}

function responseType(e: Endpoint, name: string): string {
  if (e.csv !== undefined) return `/** CSV text. */\ntype ${name}Response = string;`;
  return `type ${name}Response = ${tsType(e.response ?? {}, '', '', { nullable: e.nullable ?? [] })};`;
}

function typescript(e: Endpoint): string {
  const name = typeName(e);
  const required = (e.query ?? []).filter((q) => q.required);
  const path = curlPath(e.path).replace(/\b(ID|EMAIL|VERSION)\b/g, (p) => `\${${p.toLowerCase()}}`);
  const params = pathParams(e.path).map((p) => `const ${p} = '${p === 'id' ? '…' : p === 'email' ? 'sam@acme.example' : '2'}';`);
  const query = required.length ? `?\${new URLSearchParams({ ${required.map((q) => `${q.name}: '${q.example ?? q.name}'`).join(', ')} })}` : '';
  const lines: string[] = [];
  const request = requestType(e, name);
  if (request) lines.push(request, '');
  lines.push(...params);
  if (e.raw) lines.push("import { readFile } from 'node:fs/promises';", '');
  lines.push(
    `const response = await fetch(\`\${process.env.HELPPUFF_URL}/api/v1${path}${query}\`, {`,
    ...(e.method === 'GET' ? [] : [`  method: '${e.method}',`]),
    '  headers: {',
    '    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,',
    ...(e.raw ? [`    'Content-Type': '${e.raw.contentType}',`] : e.body !== undefined ? ["    'Content-Type': 'application/json',"] : []),
    '  },',
    ...(e.raw ? ["  body: await readFile('price-list.pdf'),"] : e.body !== undefined ? [`  body: JSON.stringify(${jsLiteral(e.body).replace(/\n/g, '\n  ')} satisfies ${name}Request),`] : []),
    '});',
    'if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);',
    e.csv !== undefined ? `const data: ${name}Response = await response.text();` : `const data = (await response.json()) as ${name}Response;`,
  );
  return lines.join('\n');
}

// -------------------------------------------------------------------- pages

/** `API keys` → `API-Reference-API-Keys`: one wiki page per area. */
export const referencePage = (tag: string) => `API-Reference-${tag.split(/\s+/).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('-')}`;
/** A heading's anchor, the same on GitHub and the website (summaries avoid punctuation for this). */
const anchor = (text: string) => text.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ +/g, '-');

const GENERATED = '<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->';
/** Code blocks the website shows as tabs (a VitePress code group). The GitHub wiki shows them one after the other. */
const tabs = (...blocks: [lang: string, title: string, code: string][]) => [
  '<!-- tabs -->',
  ...blocks.flatMap(([lang, title, code]) => [`\`\`\`${lang} [${title}]`, code, '```']),
  '<!-- /tabs -->',
];

const SHARED_TYPES = `/** A message, as the widget's protocol defines it (see the Protocol page). */
type Message =
  | { id: string; ts: number; role: 'agent' | 'user' | 'system'; type: 'text'; text: string }
  | { id: string; ts: number; role: 'agent'; type: 'options'; text?: string; options: { label: string; value: string }[]; multi?: boolean }
  | { id: string; ts: number; role: 'agent'; type: 'card'; title: string; body?: string; image?: { src: string; alt: string }; actions?: unknown[] }
  | { id: string; ts: number; role: 'agent'; type: 'carousel'; cards: unknown[] }
  | { id: string; ts: number; role: 'agent'; type: 'links'; title?: string; links: { label: string; url: string; description?: string }[] }
  | { id: string; ts: number; role: 'agent'; type: 'form'; title?: string; fields: unknown[]; submitLabel?: string }
  | { id: string; ts: number; role: 'agent' | 'system'; type: 'notice'; text: string; tone?: 'info' | 'warning' | 'error' };

/** Every error has this shape, with the HTTP status. */
type ApiError = {
  error: {
    code: 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'quota_exceeded' | 'connector_error' | 'internal';
    /** Safe to show to a person. */
    message: string;
    /** Seconds to wait, on 429. */
    retryAfter?: number;
  };
};`;

function endpointSection(e: Endpoint): string[] {
  const out: string[] = ['', `## ${e.summary}`, '', `\`${e.method} ${e.path}\` · ${e.scope === 'any' ? 'any key' : `scope \`${e.scope}\``}`, ''];
  if (e.description) out.push(e.description, '');
  const params = [
    ...pathParams(e.path).map((name) => ({ name, where: 'path', description: name === 'id' ? 'The record\'s id.' : `The ${name}.`, required: true })),
    ...(e.query ?? []).map((q) => ({ name: q.name, where: 'query', description: q.description, required: Boolean(q.required) })),
  ];
  if (params.length) {
    out.push('| Parameter | In | Required | Description |', '| --- | --- | --- | --- |');
    for (const p of params) out.push(`| \`${p.name}\` | ${p.where} | ${p.required ? 'yes' : 'no'} | ${cell(p.description)} |`);
    out.push('');
  }
  if (e.fields?.length) {
    out.push('| Body field | Required | Description |', '| --- | --- | --- |');
    for (const f of e.fields) out.push(`| \`${f.name}\` | ${f.required ? 'yes' : 'no'} | ${cell(f.description)} |`);
    out.push('');
  }
  out.push('**Request**', '', ...tabs(['bash', 'curl', curl(e)], ['ts', 'TypeScript', typescript(e)]), '');
  if (e.raw) out.push(`The body is ${e.raw.description.toLowerCase()}`, '');
  out.push(`**Response** \`${e.status ?? 200}\``, '');
  const name = typeName(e);
  if (e.csv !== undefined) out.push(...tabs(['csv', 'Example', e.csv], ['ts', 'Type', responseType(e, name)]));
  else out.push(...tabs(['json', 'Example', JSON.stringify(e.response ?? {}, null, 2)], ['ts', 'Type', responseType(e, name)]));
  if (e.errors?.length) {
    out.push('', '**Errors**', '', '| Status | Code | When |', '| --- | --- | --- |');
    for (const err of e.errors) out.push(`| ${err.status} | \`${err.code}\` | ${cell(err.when)} |`);
  }
  return out;
}

/**
 * The wiki's API reference: an overview page (`API-Reference`) and one page
 * per area (`API-Reference-Chat`, …), each endpoint with curl and TypeScript,
 * parameters, the request, an example response and its type, and errors.
 * `pnpm sync:docs` writes them; `wiki/_Sidebar.md` lists them.
 */
export function apiReferencePages(): Record<string, string> {
  const areas = TAGS.map((tag) => ({ tag, endpoints: PUBLIC_ENDPOINTS.filter((e) => e.tag === tag.name) })).filter((a) => a.endpoints.length);
  const overview: string[] = [
    GENERATED,
    '',
    '# API reference',
    '',
    'Every endpoint of the HelpPuff API, one page per area. Each has a curl command and a TypeScript `fetch` call you can paste, the parameters and body fields, an example response with its type, and the errors. For keys, scopes, conventions and a quickstart, see [[The API|API]]. The same description, as OpenAPI 3.1 (for Postman, Insomnia or a client generator), is at `/api/v1/openapi.json` on your Worker.',
    '',
    '## Setup',
    '',
    'The examples read two environment variables:',
    '',
    '```bash',
    'export HELPPUFF_URL="https://knowtific-helppuff-<site>.<you>.workers.dev"   # your Worker',
    'export HELPPUFF_API_KEY="hp_live_…"                                         # from Settings → API keys',
    '```',
    '',
    'The TypeScript examples use `fetch` (Node 18+, Deno, Bun, Workers) and these shared types:',
    '',
    '```ts',
    SHARED_TYPES,
    '```',
    '',
    '## Errors every endpoint can return',
    '',
    'Errors are JSON in the `ApiError` shape above. `message` is safe to show to a person.',
    '',
    '| Status | Code | When |',
    '| --- | --- | --- |',
    ...COMMON_ERRORS.map((err) => `| ${err.status} | \`${err.code}\` | ${cell(err.when)} |`),
    '',
    '## Areas',
  ];
  const pages: Record<string, string> = {};
  for (const { tag, endpoints } of areas) {
    const page = referencePage(tag.name);
    overview.push('', `### [[${tag.name}|${page}]]`, '', tag.description, '');
    for (const e of endpoints) overview.push(`- [[${e.summary}|${page}#${anchor(e.summary)}]]: \`${e.method} ${e.path}\``);
    const out: string[] = [
      GENERATED,
      '',
      `# ${tag.name} API`,
      '',
      `${tag.description} Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.`,
      '',
      ...endpoints.map((e) => `- [[${e.summary}|${page}#${anchor(e.summary)}]]: \`${e.method} ${e.path}\``),
    ];
    for (const e of endpoints) out.push(...endpointSection(e));
    pages[page] = `${out.join('\n')}\n`;
  }
  pages['API-Reference'] = `${overview.join('\n')}\n`;
  return pages;
}

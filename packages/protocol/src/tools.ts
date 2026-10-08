/**
 * The owner's tools (the dashboard's Prompt page): HTTP requests the
 * assistant can make before, during and after a chat, and extract tools that
 * save what it learns. Zod-free, so the dashboard and the CLI share the curl
 * parser and the rules with the server (`@helppuff/protocol/tools`).
 */

export const TOOL_KINDS = ['http', 'extract'] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const TOOL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type ToolMethod = (typeof TOOL_METHODS)[number];

export type ToolHeader = { name: string; value: string; secret: boolean };
/** Something the assistant fills in (`{{args.name}}`), or an extract tool's field. */
export type ToolParam = { name: string; description: string; required: boolean };

/** A tool as the dashboard and the CLI write it. Secret header values are never read back: an empty one keeps what is stored. */
export type ToolInput = {
  name: string;
  kind: ToolKind;
  description: string;
  method?: ToolMethod;
  url?: string;
  headers?: ToolHeader[];
  body?: string;
  /** Descriptions of the `{{args.*}}` the request uses. */
  parameters?: ToolParam[];
  /** Extract tools: what to save. */
  fields?: ToolParam[];
  /** Response paths to keep (`customer.tier`); empty keeps it all. */
  pick?: string[];
  timeoutMs?: number;
  /** Run when the chat starts (Before the chat). */
  before?: boolean;
  /** Run when the conversation ends (After the chat). */
  after?: boolean;
  enabled?: boolean;
};

/** A tool's name: how the prompt (`{{order_status}}`) and the data refer to it. */
export const TOOL_NAME = /^[a-z][a-z0-9_]{1,47}$/;

/** Names a tool cannot take: the prompt's own placeholders, the templates' roots and the assistant's built-in tools. */
export const RESERVED_TOOL_NAMES = [
  'lead',
  'context',
  'site',
  'business',
  'prechat',
  'args',
  'data',
  'page',
  'conversation',
  'transcript',
  'summary',
  'attributes',
  'request_callback',
  'request_person',
  'create_job',
  'get_business_hours',
] as const;

export const MAX_TOOLS_PER_SITE = 30;
export const TOOL_TIMEOUT_MS = { default: 5000, min: 1000, max: 10_000 } as const;

/** Header names whose values are credentials: kept encrypted and never shown again. */
export function isSecretHeader(name: string): boolean {
  const n = name.trim().toLowerCase();
  return /^(authorization|proxy-authorization|cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token)$/.test(n) || /(token|secret|api[-_]?key|password|signature)/.test(n);
}

/** Split a shell command line the way a POSIX shell would for curl: quotes, escapes, line continuations. */
export function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = '';
  let started = false;
  let i = 0;
  const text = command.replace(/\\\r?\n/g, ' ');
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (started) words.push(word);
      word = '';
      started = false;
      i++;
      continue;
    }
    started = true;
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      word += end < 0 ? text.slice(i + 1) : text.slice(i + 1, end);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (ch === '$' && text[i + 1] === "'") {
      let j = i + 2;
      while (j < text.length && text[j] !== "'") {
        if (text[j] === '\\' && j + 1 < text.length) {
          const next = text[j + 1]!;
          word += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          j += 2;
        } else word += text[j++];
      }
      i = j + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < text.length && '"\\$`'.includes(text[j + 1]!)) {
          word += text[j + 1];
          j += 2;
        } else word += text[j++];
      }
      i = j + 1;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      word += text[i + 1];
      i += 2;
      continue;
    }
    word += ch;
    i++;
  }
  if (started) words.push(word);
  return words;
}

export type ParsedCurl = { method: ToolMethod; url: string; headers: ToolHeader[]; body: string; warnings: string[] };

const VALUE_FLAGS = new Set(['-o', '--output', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '-e', '--referer', '--retry', '-x', '--proxy', '--cacert', '--cert', '--key', '-T', '--upload-file', '-F', '--form']);

/**
 * A `curl` command as a tool's request: method, URL, headers, body. What a
 * tool cannot do (a file upload, a form with files, a proxy) is a warning.
 * Throws an Error with a message for the owner when there is no URL.
 */
export function parseCurl(command: string): ParsedCurl {
  const words = shellWords(command.trim());
  if (words[0]?.toLowerCase() === 'curl') words.shift();
  let method: string | null = null;
  let url = '';
  const headers: ToolHeader[] = [];
  const data: string[] = [];
  let get = false;
  let json = false;
  const warnings: string[] = [];
  const header = (name: string, value: string) => {
    const existing = headers.findIndex((h) => h.name.toLowerCase() === name.toLowerCase());
    const entry = { name, value, secret: isSecretHeader(name) };
    if (existing >= 0) headers[existing] = entry;
    else headers.push(entry);
  };
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = () => words[++i] ?? '';
    const long = word.startsWith('--') && word.includes('=') ? word.slice(0, word.indexOf('=')) : word;
    const inline = long !== word ? word.slice(word.indexOf('=') + 1) : null;
    const value = () => inline ?? next();
    switch (long) {
      case '-X':
      case '--request':
        method = value().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const raw = value();
        const colon = raw.indexOf(':');
        if (colon > 0) header(raw.slice(0, colon).trim(), raw.slice(colon + 1).trim());
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
      case '--data-urlencode': {
        const raw = value();
        if (raw.startsWith('@')) warnings.push('A body read from a file is not supported: paste the body itself.');
        else data.push(raw);
        break;
      }
      case '--json':
        data.push(value());
        json = true;
        break;
      case '-u':
      case '--user': {
        const raw = value();
        header('Authorization', `Basic ${btoa(raw)}`);
        break;
      }
      case '-A':
      case '--user-agent':
        header('User-Agent', value());
        break;
      case '-b':
      case '--cookie':
        header('Cookie', value());
        break;
      case '-G':
      case '--get':
        get = true;
        break;
      case '--url':
        url = value();
        break;
      default:
        if (VALUE_FLAGS.has(long)) {
          if (long === '-F' || long === '--form' || long === '-T' || long === '--upload-file') warnings.push(`${long} (files and multipart forms) is not supported.`);
          if (inline === null) i++;
        } else if (!word.startsWith('-') && !url) {
          url = word;
        }
    }
  }
  if (!url) throw new Error('No URL found in the curl command.');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let body = data.join('&');
  if (get && body) {
    url += (url.includes('?') ? '&' : '?') + body;
    body = '';
  }
  if (json) {
    if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) header('Content-Type', 'application/json');
    if (!headers.some((h) => h.name.toLowerCase() === 'accept')) header('Accept', 'application/json');
  }
  const verb = (method ?? (body ? 'POST' : 'GET')) as ToolMethod;
  if (!(TOOL_METHODS as readonly string[]).includes(verb)) throw new Error(`The method ${verb} is not supported: use GET, POST, PUT, PATCH or DELETE.`);
  if (/^http:\/\//i.test(url)) warnings.push('The address starts with http://: tools call https only.');
  return { method: verb, url, headers, body, warnings };
}

/** The `{{args.*}}` names a request uses: what the assistant fills in when it calls the tool. */
export function toolArgs(input: Pick<ToolInput, 'url' | 'headers' | 'body'>): string[] {
  const text = [input.url ?? '', ...(input.headers ?? []).map((h) => h.value), input.body ?? ''].join('\n');
  return [...new Set([...text.matchAll(/\{\{\s*args\.([\w-]+)\s*\}\}/g)].map((m) => m[1]!))];
}

/** `{{name}}` and `{{name.key}}` in a prompt: the tools it uses. */
export function promptToolRefs(prompt: string): { name: string; path: string }[] {
  return [...prompt.matchAll(/\{\{\s*([a-z][a-z0-9_]*)((?:\.[\w-]+)*)\s*\}\}/g)].map((m) => ({ name: m[1]!, path: `${m[1]}${m[2] ?? ''}` }));
}

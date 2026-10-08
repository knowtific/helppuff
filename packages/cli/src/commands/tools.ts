import { isSecretHeader, parseCurl, toolArgs, type ToolHeader, type ToolParam } from '@helppuff/protocol/tools';
import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi } from '../engine/admin-api.js';
import { loadEnv } from '../engine/env.js';
import { loadProject } from '../engine/project.js';
import type { Ctx } from './context.js';

/**
 * `helppuff tools` — the site's own tools, the same as the tools on the
 * dashboard's Prompt page (stored on the Worker, not in helppuff.json):
 * your APIs the assistant calls before, during and after a chat, and extract
 * tools that save what it learns.
 *
 *   list | show <name>
 *   add <name> --curl '…' --description "…" [--param name="what it is"] [--pick a,b] [--before] [--after]
 *   add <name> --url https://… [--method POST] [--header 'Name: value'] [--body '…'] --description "…"
 *   add <name> --extract --field order_number="Like A-1042" --description "…"
 *   set <name> [the same flags]   change only what is given (--no-before, --no-after)
 *   test <name> [--arg order_number=A-1042] [--prechat email=a@b.co]
 *   enable <name> | disable <name> | remove <name>
 *
 * `${NAME}` in a header is read from .env (or the environment) here, so a key
 * never has to be typed on the command line; credential headers are stored
 * encrypted on the Worker and never read back.
 */

type Tool = {
  id: string;
  name: string;
  kind: 'http' | 'extract';
  description: string;
  method?: string;
  url?: string;
  headers?: (ToolHeader & { set?: boolean })[];
  body?: string;
  parameters?: ToolParam[];
  fields?: ToolParam[];
  pick?: string[];
  keys: string[];
  before: boolean;
  after: boolean;
  enabled: boolean;
  lastStatus: number | null;
  lastError: string | null;
};
type Listed = { tools: Tool[]; assistant: boolean; prechat: { name: string; label: string }[] };

const USAGE =
  'Usage: helppuff tools list | show <name> | add <name> (--curl … | --url … | --extract --field name="…") --description "…" | set <name> … | test <name> [--arg k=v] | enable <name> | disable <name> | remove <name>';

const FLAGS = ['curl', 'url', 'method', 'header', 'body', 'description', 'param', 'field', 'pick', 'before', 'after', 'extract', 'timeout', 'arg', 'prechat'];

/** `name=value` pairs from a repeated flag. */
function pairs(value: unknown, flag: string): [string, string][] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return list.map((item) => {
    const at = String(item).indexOf('=');
    if (at < 1) throw new CliError('usage', `--${flag} takes name=value, like --${flag} order_number="Like A-1042".`, { exitCode: EXIT.usage });
    return [String(item).slice(0, at).trim(), String(item).slice(at + 1)];
  });
}

/** `${NAME}` in a header value, from .env or the environment; a missing one is a question for the user. */
function expand(value: string, env: Record<string, string>, missing: Set<string>): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_all, name: string) => {
    const found = env[name];
    if (found === undefined) missing.add(name);
    return found ?? '';
  });
}

/** The fields the flags give, for `POST /tools` or `PATCH /tools/:id`. */
function fromFlags(ctx: Ctx, current: Tool | null): { body: Record<string, unknown>; missing: string[] } {
  const f = ctx.flags;
  const body: Record<string, unknown> = {};
  const env = loadEnv(ctx.cwd);
  const missing = new Set<string>();
  const headers: ToolHeader[] = [];
  const curl = str(f, 'curl');
  if (curl) {
    let parsed;
    try {
      parsed = parseCurl(curl);
    } catch (thrown) {
      throw new CliError('usage', (thrown as Error).message, { exitCode: EXIT.usage });
    }
    Object.assign(body, { kind: 'http', method: parsed.method, url: parsed.url, body: parsed.body });
    headers.push(...parsed.headers);
    for (const warning of parsed.warnings) process.stderr.write(`${c.yellow('!')} ${warning}\n`);
  }
  if (f['extract'] === true) body['kind'] = 'extract';
  const url = str(f, 'url');
  if (url) Object.assign(body, { kind: 'http', url });
  const method = str(f, 'method');
  if (method) body['method'] = method.toUpperCase();
  if (typeof f['body'] === 'string') body['body'] = f['body'];
  const description = str(f, 'description');
  if (description) body['description'] = description;
  for (const raw of Array.isArray(f['header']) ? f['header'] : typeof f['header'] === 'string' ? [f['header']] : []) {
    const at = String(raw).indexOf(':');
    if (at < 1) throw new CliError('usage', '--header takes "Name: value".', { exitCode: EXIT.usage });
    const name = String(raw).slice(0, at).trim();
    headers.push({ name, value: String(raw).slice(at + 1).trim(), secret: isSecretHeader(name) });
  }
  if (headers.length) {
    // New headers replace those with the same name; the rest stay (secret ones keep their stored value).
    const kept = (current?.headers ?? []).filter((h) => !headers.some((n) => n.name.toLowerCase() === h.name.toLowerCase())).map(({ name, value, secret }) => ({ name, value, secret }));
    body['headers'] = [...kept, ...headers.map((h) => ({ ...h, value: expand(h.value, env, missing) }))];
  }
  const params = pairs(f['param'], 'param');
  if (params.length) {
    const args = toolArgs({ url: String(body['url'] ?? current?.url ?? ''), headers, body: String(body['body'] ?? current?.body ?? '') });
    const unknown = params.filter(([name]) => !args.includes(name)).map(([name]) => name);
    if (unknown.length) throw new CliError('usage', `Not used in the request: ${unknown.join(', ')}. A parameter is {{args.<name>}} in the URL, a header or the body.`, { exitCode: EXIT.usage });
    body['parameters'] = params.map(([name, text]) => ({ name, description: text, required: true }));
  }
  const fields = pairs(f['field'], 'field');
  if (fields.length) body['fields'] = fields.map(([name, text]) => ({ name, description: text, required: true }));
  const pick = str(f, 'pick');
  if (pick !== undefined) body['pick'] = pick.split(',').map((p) => p.trim()).filter(Boolean);
  for (const flag of ['before', 'after'] as const) if (typeof f[flag] === 'boolean') body[flag] = f[flag];
  const timeout = str(f, 'timeout');
  if (timeout) body['timeoutMs'] = Number(timeout);
  return { body, missing: [...missing] };
}

function line(tool: Tool): string {
  const state = !tool.enabled ? c.dim('off') : tool.lastStatus !== null && tool.lastStatus >= 400 ? c.yellow('failing') : c.green('on');
  const what = tool.kind === 'extract' ? `saves ${(tool.fields ?? []).map((f) => f.name).join(', ')}` : `${tool.method} ${tool.url}`;
  const where = [tool.before && 'before', tool.after && 'after'].filter(Boolean).join(', ');
  return `${tool.name}  ${state}  ${what}${where ? c.dim(`  (${where} the chat)`) : ''}\n    ${c.dim(tool.description)}\n`;
}

export async function toolsCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, FLAGS, 'tools');
  const [sub = 'list', arg] = ctx.positionals;
  const api = adminApi(loadProject(ctx.cwd));
  const need = () => {
    if (!arg) throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
    return arg;
  };
  const find = async (nameOrId: string) => {
    const { tools } = await api.get<Listed>('/admin/api/tools');
    const tool = tools.find((t) => t.name === nameOrId || t.id === nameOrId);
    if (!tool) throw new CliError('not_found', `No tool called ${nameOrId}.`, { hint: 'helppuff tools list', exitCode: EXIT.usage });
    return tool;
  };
  const askSecrets = (missing: string[]) =>
    ctx.out.needsInput({
      message: `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not in .env yet: nothing was saved.`,
      questions: missing.map((name) => ({ id: name, ask: `The value of ${name}. The user stores it with \`helppuff secret set ${name}\`; never paste it into a chat.`, flag: `secret set ${name}`, kind: 'secret', required: true, envVar: name })),
    });

  switch (sub) {
    case 'list': {
      const listed = await api.get<Listed>('/admin/api/tools');
      ctx.out.result(listed, () => {
        if (!listed.tools.length) process.stdout.write(c.dim("No tools. Add one with `helppuff tools add <name> --curl '…' --description '…'`.\n"));
        for (const t of listed.tools) process.stdout.write(line(t));
        if (!listed.assistant && listed.tools.length) process.stdout.write(c.dim('This backend is not HelpPuff\'s assistant: only the after-chat tools run.\n'));
      });
      return 0;
    }
    case 'show': {
      const tool = await find(need());
      ctx.out.result(tool, () => process.stdout.write(`${JSON.stringify(tool, null, 2)}\n`));
      return 0;
    }
    case 'add': {
      const { body, missing } = fromFlags(ctx, null);
      if (missing.length) return askSecrets(missing);
      if (!body['description']) {
        return ctx.out.needsInput({ questions: [{ id: 'description', ask: 'What the tool does and when to use it (the assistant reads it).', flag: '--description', kind: 'text', required: true }] });
      }
      const tool = await api.send<Tool>('POST', '/admin/api/tools', { name: need(), ...body });
      ctx.out.result(tool, () => {
        ctx.out.success(`Added ${tool.name}.`);
        const hint = tool.kind === 'extract' || (!tool.before && !tool.after) ? `Put {{${tool.name}}} in the prompt (helppuff prompt, or the dashboard) so the assistant uses it.\n` : '';
        process.stdout.write(c.dim(`${hint}Try it: helppuff tools test ${tool.name}${toolArgs(tool).map((a) => ` --arg ${a}=…`).join('')}\n`));
      });
      return 0;
    }
    case 'set': {
      const current = await find(need());
      const { body, missing } = fromFlags(ctx, current);
      if (missing.length) return askSecrets(missing);
      if (!Object.keys(body).length) throw new CliError('usage', 'Nothing to change: give a flag, like --description or --before.', { exitCode: EXIT.usage });
      const tool = await api.send<Tool>('PATCH', `/admin/api/tools/${encodeURIComponent(current.id)}`, body);
      ctx.out.result(tool, () => ctx.out.success(`Saved ${tool.name}.`));
      return 0;
    }
    case 'enable':
    case 'disable': {
      const current = await find(need());
      const tool = await api.send<Tool>('PATCH', `/admin/api/tools/${encodeURIComponent(current.id)}`, { enabled: sub === 'enable' });
      ctx.out.result(tool, () => ctx.out.success(`${tool.name} is ${tool.enabled ? 'on' : 'off'}.`));
      return 0;
    }
    case 'remove': {
      const current = await find(need());
      await api.send('DELETE', `/admin/api/tools/${encodeURIComponent(current.id)}`);
      ctx.out.result({ name: current.name, removed: true }, () => ctx.out.success(`Removed ${current.name}. Take {{${current.name}}} out of the prompt too.`));
      return 0;
    }
    case 'test': {
      const current = await find(need());
      const sample = { args: Object.fromEntries(pairs(ctx.flags['arg'], 'arg')), prechat: Object.fromEntries(pairs(ctx.flags['prechat'], 'prechat')) };
      const result = await api.send<{ ok: boolean; status: number | null; ms: number; error: string | null; value: unknown; keys: string[] }>('POST', '/admin/api/tools/test', { id: current.id, sample });
      ctx.out.result(result, () => {
        if (result.ok) ctx.out.success(`HTTP ${result.status ?? '—'} in ${result.ms} ms. The chat keeps:`);
        else process.stdout.write(`${c.yellow('Failed:')} ${result.error ?? `HTTP ${result.status}`}\n`);
        process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
        if (result.keys.length) process.stdout.write(c.dim(`In the prompt: ${result.keys.slice(0, 6).map((k) => `{{${current.name}.${k}}}`).join(' ')}\n`));
      });
      return result.ok ? 0 : EXIT.error;
    }
    default:
      throw new CliError('usage', USAGE, { exitCode: EXIT.usage });
  }
}

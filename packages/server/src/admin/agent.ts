import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { MAX_TOOLS_PER_SITE } from '@helppuff/protocol';
import { keyScopes } from '../api/keys.js';
import { hasScope } from '../api/scopes.js';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { ensureSchema } from '../db/d1.js';
import { toolView, validTool, type ToolRow } from '../tools/store.js';
import { assertSameOrigin, currentAdmin, db, jsonBody, siteParam } from './guard.js';
import { normalizePrompt, PROMPT_LIMIT, promptCtx, publishPrompt, readPromptState } from './prompts.js';
import { readSettings, saveSettings, settingsPatchSchema } from './settings.js';
import { insertTool, updateTool } from './tools.js';

/**
 * The agent file: a whole assistant's setup in one JSON file, to export,
 * share, keep in a project and import again (the dashboard's Import &
 * export page, `helppuff agent`, the tutorials' templates). It holds what
 * makes the assistant do a job: the prompt, the tools, and the behaviour and
 * lead form settings. Not the branding, the knowledge, the team or the keys.
 *
 * Secrets never travel in it. A tool's credential header holds a placeholder,
 * `"Bearer ${SHIPPO_TOKEN}"`, named in `needs`; importing asks for each
 * value (the CLI reads them from `.env`) and stores it encrypted, as a tool
 * saved by hand would be. Importing checks everything first (`dryRun` says
 * what would change and which secrets are missing), then applies: settings,
 * tools (matched by name: created or replaced), and the prompt as a new
 * version.
 */

export const agentRoutes = new Hono<HonoEnv>();

/** `${NAME}` in a header value: a secret the importer supplies. */
const PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]{0,63})\}/g;

const needSchema = z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), description: z.string().max(300).default('') });

export const agentFileSchema = z.object({
  helppuff: z.literal('agent'),
  version: z.literal(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  prompt: z.string().max(PROMPT_LIMIT).optional(),
  settings: settingsPatchSchema.pick({ behaviour: true, leads: true }).optional(),
  tools: z.array(z.record(z.unknown())).max(MAX_TOOLS_PER_SITE).default([]),
  needs: z.array(needSchema).max(30).default([]),
});
export type AgentFile = z.infer<typeof agentFileSchema>;

function parseAgent(value: unknown): AgentFile {
  const parsed = agentFileSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || 'the file';
    throw new HelpPuffError('bad_request', {
      message: issue?.path[0] === 'helppuff' ? 'This is not a HelpPuff agent file ("helppuff": "agent").' : `Check ${where} in the agent file: ${issue?.message ?? 'invalid'}.`,
      detail: 'agent_invalid',
    });
  }
  const names = parsed.data.tools.map((t) => String(t['name'] ?? ''));
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice) throw new HelpPuffError('bad_request', { message: `The agent file has two tools called ${twice}.`, detail: 'agent_invalid' });
  return parsed.data;
}

const secretsOf = (value: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(value && typeof value === 'object' ? (value as Record<string, unknown>) : {}).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0));

type Planned = { name: string; current: ToolRow | null; body: Record<string, unknown> };

/**
 * Each tool as it would be saved: placeholders filled from `secrets`. A
 * placeholder without a value is missing, unless the tool already has that
 * header stored (importing the same file again keeps the stored key).
 */
function planTools(file: AgentFile, existing: ToolRow[], secrets: Record<string, string>): { tools: Planned[]; missing: string[] } {
  const byName = new Map(existing.map((r) => [r.name, r]));
  const missing = new Set<string>();
  const tools = file.tools.map((raw): Planned => {
    const name = String(raw['name'] ?? '');
    const current = byName.get(name) ?? null;
    const view = current ? toolView(current) : null;
    const stored = view && 'headers' in view ? view.headers : [];
    const headers = Array.isArray(raw['headers'])
      ? (raw['headers'] as unknown[]).map((h) => {
          const header = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>;
          const value = typeof header['value'] === 'string' ? header['value'] : '';
          const needed = [...value.matchAll(PLACEHOLDER)].map((m) => m[1]!);
          if (!needed.length) return header;
          const absent = needed.filter((n) => !(n in secrets));
          if (absent.length) {
            const kept = stored.some((s) => s.secret && s.set && s.name.toLowerCase() === String(header['name'] ?? '').toLowerCase());
            if (!kept) for (const n of absent) missing.add(n);
            // Empty and secret: the stored value stays.
            return { ...header, value: '', secret: true };
          }
          return { ...header, value: value.replace(PLACEHOLDER, (_m, n: string) => secrets[n]!), secret: true };
        })
      : raw['headers'];
    return { name, current, body: { ...raw, ...(headers !== undefined ? { headers } : {}) } };
  });
  return { tools, missing: [...missing] };
}

/** An API key that imports settings needs `settings:write` too (the route needs `prompt:write`). */
function assertCanChangeSettings(c: Context<HonoEnv>): void {
  const key = c.get('apiKey');
  if (key && !hasScope(keyScopes(key), 'settings:write')) {
    throw new HelpPuffError('forbidden', { message: 'This agent file changes settings: the key needs the settings:write scope too.', detail: 'api_key_scope' });
  }
}

agentRoutes.get('/agent/export', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const d = db(c);
  await ensureSchema(d);
  const [site, state, rows] = await Promise.all([
    resolveSite(c.get('helppuff'), siteId),
    readPromptState(promptCtx(c), d, siteId),
    d.prepare('SELECT * FROM tools WHERE site_id = ? ORDER BY name').bind(siteId).all<ToolRow>(),
  ]);
  const settings = readSettings(site);
  const needs: { name: string; description: string }[] = [];
  const tools = rows.results.map((row) => {
    const view = toolView(row);
    const common = { name: view.name, kind: view.kind, description: view.description, enabled: view.enabled };
    if (!('headers' in view)) return { ...common, fields: 'fields' in view ? view.fields : [] };
    const headers = view.headers.map((h) => {
      if (!h.secret) return { name: h.name, value: h.value };
      const name = `${view.name}_${h.name}`.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
      needs.push({ name, description: `The whole ${h.name} header of the ${view.name} tool` });
      return { name: h.name, value: `\${${name}}`, secret: true };
    });
    return {
      ...common,
      method: view.method,
      url: view.url,
      headers,
      ...(view.body ? { body: view.body } : {}),
      parameters: view.parameters,
      pick: view.pick,
      keys: view.keys,
      timeoutMs: view.timeoutMs,
      before: view.before,
      after: view.after,
    };
  });
  const file = {
    helppuff: 'agent',
    version: 1,
    name: site.widget.brand.name && site.widget.brand.name !== 'Chat' ? `${site.widget.brand.name} assistant` : `${siteId} assistant`,
    description: `Exported from ${siteId} on ${new Date(c.get('helppuff').platform.now()).toISOString().slice(0, 10)}.`,
    ...(state.editable && state.text ? { prompt: state.text } : {}),
    settings: { behaviour: settings.behaviour, leads: settings.leads },
    tools,
    needs,
  };
  return c.json(file);
});

agentRoutes.post('/agent/import', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const file = parseAgent(body['agent']);
  const secrets = secretsOf(body['secrets']);
  const dryRun = body['dryRun'] === true;
  const ctx = c.get('helppuff');
  const d = db(c);
  await ensureSchema(d);
  // A dry run changes nothing: the route's own scope is enough.
  if (file.settings && !dryRun) assertCanChangeSettings(c);

  const existing = (await d.prepare('SELECT * FROM tools WHERE site_id = ?').bind(siteId).all<ToolRow>()).results;
  const { tools, missing } = planTools(file, existing, secrets);
  const creates = tools.filter((t) => !t.current).length;
  if (existing.length + creates > MAX_TOOLS_PER_SITE) {
    throw new HelpPuffError('bad_request', { message: `Up to ${MAX_TOOLS_PER_SITE} tools per site: this file would make ${existing.length + creates}.`, detail: 'tool_limit' });
  }
  if (file.settings && !settingsPatchSchema.safeParse(file.settings).success) {
    throw new HelpPuffError('bad_request', { message: 'Check the settings in the agent file.', detail: 'agent_invalid' });
  }

  // Every tool is checked before anything is written: an invalid one leaves the site as it was.
  const secret = requireSecret(ctx);
  const taken = existing.map((r) => r.name);
  const stored = [];
  for (const tool of tools) {
    const others = taken.filter((n) => n !== tool.name);
    try {
      stored.push(await validTool(tool.body, tool.current, others, secret));
    } catch (thrown) {
      if (thrown instanceof HelpPuffError) throw new HelpPuffError('bad_request', { message: `${tool.name || 'A tool'}: ${thrown.message}`, detail: 'agent_invalid' });
      throw thrown;
    }
  }

  const promptState = await readPromptState(promptCtx(c), d, siteId);
  const promptText = file.prompt === undefined ? null : normalizePrompt(file.prompt);
  const promptPlan =
    promptText === null ? null : !promptState.editable ? 'skipped' : promptText === normalizePrompt(promptState.text) ? 'unchanged' : promptText ? 'replace' : 'skipped';
  const needs = missing.map((name) => ({ name, description: file.needs.find((n) => n.name === name)?.description ?? '' }));
  const plan = {
    name: file.name,
    settings: file.settings ? Object.keys(file.settings) : [],
    tools: tools.map((t) => ({ name: t.name, action: t.current ? ('replace' as const) : ('create' as const) })),
    prompt: promptPlan === null ? null : { action: promptPlan, version: promptState.version, ...(promptPlan === 'skipped' && promptState.reason ? { reason: promptState.reason } : {}) },
    missingSecrets: needs,
  };
  if (dryRun) return c.json({ site: siteId, dryRun: true, ready: needs.length === 0, ...plan });
  if (needs.length) {
    throw new HelpPuffError('bad_request', { message: `Give a value for ${needs.map((n) => n.name).join(', ')}: the file's tools need ${needs.length === 1 ? 'it' : 'them'}.`, detail: 'agent_secrets_missing' });
  }

  const by = admin.via === 'api-key' ? 'cli' : admin.email;
  if (file.settings) await saveSettings(c, siteId, file.settings, by);
  const now = ctx.platform.now();
  for (const [i, tool] of tools.entries()) {
    if (tool.current) await updateTool(d, tool.current, stored[i]!, now);
    else await insertTool(d, siteId, stored[i]!, now);
  }
  let promptVersion: number | null = null;
  if (promptPlan === 'replace' && promptText) {
    const result = await publishPrompt(promptCtx(c), d, siteId, {
      text: promptText,
      baseVersion: promptState.version,
      source: admin.via === 'api-key' ? 'cli' : 'dashboard',
      by: admin.email,
      note: `Imported: ${file.name}`.slice(0, 200),
    });
    if (result.status === 'conflict') throw new HelpPuffError('conflict', { message: 'The prompt changed while importing. Try again.', detail: 'agent_prompt_conflict' });
    promptVersion = result.version;
  }
  return c.json({ site: siteId, dryRun: false, ready: true, ...plan, prompt: plan.prompt && { ...plan.prompt, ...(promptVersion !== null ? { version: promptVersion } : {}) } });
});

import { Hono, type Context } from 'hono';
import { MAX_TOOLS_PER_SITE, TOOL_TIMEOUT_MS } from '@helppuff/protocol';
import { resolveSite } from '../config/site.js';
import { isAssistant } from '../core/assistant.js';
import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { ensureSchema, type D1Like } from '../db/d1.js';
import { callHttp, extractFields, responseKeys } from '../tools/run.js';
import { countTools, forgetTools, openTool, toolView, validTool, type Stored, type ToolRow } from '../tools/store.js';
import { capSize, pickPaths, type TemplateScope } from '../tools/template.js';
import { assertSameOrigin, currentAdmin, db, jsonBody, siteParam } from './guard.js';

/**
 * The site's tools (the dashboard's Prompt page, `helppuff tools`): HTTP
 * requests the assistant makes before, during and after a chat, and extract
 * tools that save what it learns. Stored in D1 (`tools/store.ts`); run by
 * `tools/chat.ts`.
 */

export const toolRoutes = new Hono<HonoEnv>();

async function toolOf(c: Context<HonoEnv>, siteId: string, id: string | undefined): Promise<ToolRow> {
  const row = id ? await db(c).prepare('SELECT * FROM tools WHERE id = ? AND site_id = ?').bind(id, siteId).first<ToolRow>() : null;
  if (!row) throw new HelpPuffError('not_found', { message: 'No such tool.', detail: 'tool_unknown' });
  return row;
}

async function otherNames(c: Context<HonoEnv>, siteId: string, except: string | null): Promise<string[]> {
  const rows = (await db(c).prepare('SELECT id, name FROM tools WHERE site_id = ?').bind(siteId).all<{ id: string; name: string }>()).results;
  return rows.filter((r) => r.id !== except).map((r) => r.name);
}

/** Store a new, validated tool (the route's work, shared with importing an agent file). */
export async function insertTool(d: D1Like, siteId: string, stored: Stored, now: number): Promise<ToolRow> {
  const id = `tool_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  await d
    .prepare(
      `INSERT INTO tools (id, site_id, name, kind, description, method, url, headers, body, parameters, fields, pick, keys, timeout_ms, run_before, run_after, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, siteId, stored.name, stored.kind, stored.description, stored.method, stored.url, stored.headers, stored.body, stored.parameters, stored.fields, stored.pick, stored.keys, stored.timeout_ms, stored.run_before, stored.run_after, stored.enabled, now, now)
    .run();
  forgetTools(siteId);
  return (await d.prepare('SELECT * FROM tools WHERE id = ?').bind(id).first<ToolRow>())!;
}

/** Save a validated change to a tool. */
export async function updateTool(d: D1Like, row: ToolRow, stored: Stored, now: number): Promise<ToolRow> {
  await d
    .prepare(
      `UPDATE tools SET name = ?, kind = ?, description = ?, method = ?, url = ?, headers = ?, body = ?, parameters = ?, fields = ?, pick = ?, keys = ?,
       timeout_ms = ?, run_before = ?, run_after = ?, enabled = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(stored.name, stored.kind, stored.description, stored.method, stored.url, stored.headers, stored.body, stored.parameters, stored.fields, stored.pick, stored.keys, stored.timeout_ms, stored.run_before, stored.run_after, stored.enabled, now, row.id)
    .run();
  forgetTools(row.site_id);
  return { ...row, ...stored, updated_at: now };
}

toolRoutes.get('/tools', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  await ensureSchema(db(c));
  const [rows, site] = await Promise.all([db(c).prepare('SELECT * FROM tools WHERE site_id = ? ORDER BY name').bind(siteId).all<ToolRow>(), resolveSite(c.get('helppuff'), siteId)]);
  const form = site.widget.leadForm;
  return c.json({
    tools: rows.results.map(toolView),
    /** Whether the site's assistant uses them in a chat (HelpPuff's assistant); after-chat tools run for every backend. */
    assistant: isAssistant(site),
    /** The pre-chat form's fields: `{{prechat.<name>}}` in a tool, `{{lead.<name>}}` in the prompt. */
    prechat: form.enabled ? form.fields.map((f) => ({ name: f.name, label: f.label })) : [],
    limits: { tools: MAX_TOOLS_PER_SITE, timeoutMs: TOOL_TIMEOUT_MS },
  });
});

toolRoutes.post('/tools', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const d = db(c);
  await ensureSchema(d);
  if ((await countTools(d, siteId)) >= MAX_TOOLS_PER_SITE) throw new HelpPuffError('bad_request', { message: `Up to ${MAX_TOOLS_PER_SITE} tools per site.`, detail: 'tool_limit' });
  const stored = await validTool(body, null, await otherNames(c, siteId, null), requireSecret(c.get('helppuff')));
  const row = await insertTool(d, siteId, stored, c.get('helppuff').platform.now());
  return c.json(toolView(row), 201);

});

toolRoutes.patch('/tools/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site'] ?? c.req.query('site'));
  const row = await toolOf(c, siteId, c.req.param('id'));
  const stored = await validTool(body, row, await otherNames(c, siteId, row.id), requireSecret(c.get('helppuff')));
  return c.json(toolView(await updateTool(db(c), row, stored, c.get('helppuff').platform.now())));

});

toolRoutes.delete('/tools/:id', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const row = await toolOf(c, siteId, c.req.param('id'));
  await db(c).prepare('DELETE FROM tools WHERE id = ?').bind(row.id).run();
  forgetTools(siteId);
  return c.json({ deleted: true });
});

const sampleOf = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/**
 * Call a tool now with sample values and show what came back: a saved tool
 * (`id`), a draft (`tool`, as `POST /tools` takes it), or a saved tool with
 * unsaved changes (both; empty secret headers keep the stored ones). Testing
 * a saved tool remembers the keys it returned, for the prompt's autocomplete.
 */
toolRoutes.post('/tools/test', async (c) => {
  assertSameOrigin(c);
  await currentAdmin(c);
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site'] ?? c.req.query('site'));
  await ensureSchema(db(c));
  const ctx = c.get('helppuff');
  const secret = requireSecret(ctx);
  const id = typeof body['id'] === 'string' ? body['id'] : undefined;
  const row = id ? await toolOf(c, siteId, id) : null;
  const draft = body['tool'] && typeof body['tool'] === 'object' ? (body['tool'] as Record<string, unknown>) : {};
  if (!row && !body['tool']) throw new HelpPuffError('bad_request', { message: 'Send the tool to test (`tool`) or a saved tool\'s `id`.', detail: 'tool_test_nothing' });
  const stored = await validTool({ ...draft, name: draft['name'] ?? row?.name ?? 'draft_tool' }, row, [], secret);
  const tool = await openTool({ ...(row ?? ({ id: 'draft', site_id: siteId, last_status: null, last_error: null, last_at: null, created_at: 0, updated_at: 0 } as const)), ...stored }, secret);

  const sample = sampleOf(body['sample']);
  if (tool.kind === 'extract') {
    const { values, missing } = extractFields(tool, sampleOf(sample['args']));
    return c.json({ ok: true, status: null, ms: 0, error: null, response: values, value: values, keys: tool.fields.map((f) => f.name), missing });
  }
  const scope: TemplateScope = {
    args: sampleOf(sample['args']),
    prechat: sampleOf(sample['prechat']),
    data: sampleOf(sample['data']),
    page: { url: 'https://example.com/', title: 'Example page', ...sampleOf(sample['page']) },
    conversation: { id: 'conv_test', ...sampleOf(sample['conversation']) },
    site: { id: siteId },
    transcript: sample['transcript'] ?? [{ role: 'visitor', text: 'Hi, where is my order?', at: new Date(ctx.platform.now()).toISOString() }],
    summary: sample['summary'] ?? 'A test conversation.',
    lead: sample['lead'] ?? null,
    attributes: sampleOf(sample['attributes']),
  };
  // The whole response, so the owner can pick the keys to keep; what the chat keeps is `value`.
  const full = await callHttp({ ...tool, pick: [] }, scope, globalThis.fetch.bind(globalThis), () => ctx.platform.now(), 20_000);
  const value = full.ok ? capSize(pickPaths(full.value, tool.pick)) : full.value;
  const keys = full.ok ? responseKeys(full.value) : [];
  if (row) {
    await db(c)
      .prepare('UPDATE tools SET last_status = ?, last_error = ?, last_at = ?, keys = coalesce(?, keys) WHERE id = ?')
      .bind(full.status, full.error ?? null, ctx.platform.now(), keys.length ? JSON.stringify(keys) : null, row.id)
      .run();
    forgetTools(siteId);
  }
  return c.json({ ok: full.ok, status: full.status, ms: full.ms, error: full.error ?? null, response: full.value, value, keys });
});

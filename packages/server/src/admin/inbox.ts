import { Hono, type Context } from 'hono';
import { parseData } from '../tools/run.js';
import { cleanText } from '@helppuff/protocol';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import type { D1Like, D1Statement } from '../db/d1.js';
import { assertAdmin, assertSameOrigin, assertSiteAccess, currentAdmin, db, jsonBody, siteParam, type Admin } from './guard.js';

/**
 * The team's inbox: what a conversation and a contact carry besides the
 * transcript. A conversation's status (`bot`, `live`, `closed`), custom
 * attributes (key-value strings, for the team and integrations), notes the
 * visitor never sees, and labels from a list the site defines. The AI labels
 * a conversation when it goes quiet, with the labels it is allowed to use.
 */

export const inboxRoutes = new Hono<HonoEnv>();

// ------------------------------------------------------------------- status

export const CONVERSATION_STATUSES = ['bot', 'live', 'closed'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/**
 * A conversation's status as stored, with time applied: anything quiet for
 * longer than `live.closeAfterMinutes` is closed, whatever the row says (the
 * live hub also closes live chats then, with a notice; this keeps every read
 * right without a write per conversation). Binds one parameter: the cutoff.
 */
export const statusSql = (alias = 'c') =>
  `CASE WHEN ${alias}.status = 'closed' OR ${alias}.last_at < ? THEN 'closed' WHEN ${alias}.status = 'live' THEN 'live' ELSE 'bot' END`;

/** Conditions (with their one cutoff parameter) for a status filter. */
export function statusFilter(status: ConversationStatus, alias = 'c'): string {
  if (status === 'closed') return `(${alias}.status = 'closed' OR ${alias}.last_at < ?)`;
  if (status === 'live') return `(${alias}.status = 'live' AND ${alias}.last_at >= ?)`;
  return `(COALESCE(${alias}.status, 'bot') NOT IN ('live', 'closed') AND ${alias}.last_at >= ?)`;
}

/** The time before which a quiet conversation counts as closed, for this request's site. */
export async function closeCutoff(c: Context<HonoEnv>, siteId?: string): Promise<number> {
  const ctx = c.get('helppuff');
  const id = siteId ?? c.get('apiKey')?.site_id ?? c.req.query('site') ?? Object.keys(ctx.config.sites)[0];
  let minutes = 60;
  try {
    if (id) minutes = (await resolveSite(ctx, id)).live.closeAfterMinutes;
  } catch {
    // An unknown site: the default.
  }
  return ctx.platform.now() - minutes * 60_000;
}

// --------------------------------------------------------------- attributes

/** Letters, digits, spaces, `_`, `-` and `.`; starts with a letter, digit or `_`. */
const ATTRIBUTE_KEY = /^[\p{L}\p{N}_][\p{L}\p{N} _.-]{0,63}$/u;
export const MAX_ATTRIBUTES = 50;
export const MAX_ATTRIBUTE_VALUE = 1000;

export function parseJsonObject(value: unknown): Record<string, string> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

/**
 * Apply an attributes patch: `{ key: "value" }` sets, `{ key: null }` removes,
 * keys left out stay. Throws a 400 for a bad key or value, or too many.
 */
export function mergeAttributes(current: Record<string, string>, patch: unknown): Record<string, string> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new HelpPuffError('bad_request', { message: 'Attributes are an object of strings: { "plan": "pro" }. Null removes one.', detail: 'attributes_invalid' });
  }
  const next = { ...current };
  for (const [rawKey, value] of Object.entries(patch as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!ATTRIBUTE_KEY.test(key)) {
      throw new HelpPuffError('bad_request', { message: `Check attribute "${key.slice(0, 64)}": up to 64 letters, digits, spaces, _ - or .`, detail: 'attribute_bad_key' });
    }
    if (value === null) {
      delete next[key];
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new HelpPuffError('bad_request', { message: `Check attribute "${key}": the value is a string (or null to remove it).`, detail: 'attribute_bad_value' });
    }
    const text = cleanText(String(value), 'line').slice(0, MAX_ATTRIBUTE_VALUE);
    if (text) next[key] = text;
    else delete next[key];
  }
  if (Object.keys(next).length > MAX_ATTRIBUTES) {
    throw new HelpPuffError('bad_request', { message: `At most ${MAX_ATTRIBUTES} attributes.`, detail: 'attributes_too_many' });
  }
  return next;
}

export const attributesJson = (attributes: Record<string, string>) => (Object.keys(attributes).length ? JSON.stringify(attributes) : null);

// ------------------------------------------------------------------- labels

export type Label = { id: string; name: string; color: string; description: string | null; ai: boolean };
export const LABEL_COLORS = ['#6b7280', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'] as const;
export const MAX_LABELS = 100;

const labelView = (row: { id: string; name: string; color: string; description: string | null; ai: number }): Label => ({
  id: row.id,
  name: row.name,
  color: row.color,
  description: row.description,
  ai: Boolean(row.ai),
});

export async function listLabels(d: D1Like, siteId: string): Promise<Label[]> {
  const rows = await d
    .prepare('SELECT id, name, color, description, ai FROM labels WHERE site_id = ? ORDER BY name COLLATE NOCASE')
    .bind(siteId)
    .all<{ id: string; name: string; color: string; description: string | null; ai: number }>();
  return rows.results.map(labelView);
}

/** A conversation's labels as a JSON array, for a list query. Parse with `parseLabels`. */
export const labelsSql = (alias = 'c') =>
  `(SELECT json_group_array(json_object('id', l.id, 'name', l.name, 'color', l.color)) FROM conversation_labels cl JOIN labels l ON l.id = cl.label_id WHERE cl.conversation_id = ${alias}.id)`;

export function parseLabels(value: unknown): { id: string; name: string; color: string }[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as { id: string; name: string; color: string }[]).filter((l) => l && typeof l.id === 'string') : [];
  } catch {
    return [];
  }
}

/** Ids of this site's labels, from ids or names (case-insensitive). Unknown ones are a 400. */
async function resolveLabels(d: D1Like, siteId: string, wanted: unknown): Promise<string[]> {
  if (!Array.isArray(wanted) || wanted.some((w) => typeof w !== 'string') || wanted.length > MAX_LABELS) {
    throw new HelpPuffError('bad_request', { message: 'Labels are a list of label ids or names.', detail: 'labels_invalid' });
  }
  const all = await listLabels(d, siteId);
  return (wanted as string[]).map((w) => {
    const found = all.find((l) => l.id === w || l.name.toLowerCase() === w.trim().toLowerCase());
    if (!found) throw new HelpPuffError('bad_request', { message: `No label "${w.slice(0, 40)}". Define it in Settings → Labels first.`, detail: 'label_unknown' });
    return found.id;
  });
}

/** Statements that give a conversation exactly these labels (by id), keeping when and by whom the ones it had were added. */
export function setLabelStatements(d: D1Like, siteId: string, conversationId: string, ids: string[], by: string, now: number): D1Statement[] {
  const unique = [...new Set(ids)];
  return [
    d
      .prepare(`DELETE FROM conversation_labels WHERE conversation_id = ?${unique.length ? ` AND label_id NOT IN (${unique.map(() => '?').join(', ')})` : ''}`)
      .bind(conversationId, ...unique),
    ...unique.map((id) =>
      d.prepare('INSERT OR IGNORE INTO conversation_labels (conversation_id, label_id, site_id, added_by, added_at) VALUES (?, ?, ?, ?, ?)').bind(conversationId, id, siteId, by, now),
    ),
  ];
}

function labelInput(body: Record<string, unknown>, partial: boolean) {
  const out: { name?: string; color?: string; description?: string | null; ai?: boolean } = {};
  if (body['name'] !== undefined || !partial) {
    const name = typeof body['name'] === 'string' ? cleanText(body['name'], 'line').trim().slice(0, 40) : '';
    if (!name) throw new HelpPuffError('bad_request', { message: 'Give the label a name (up to 40 characters).', detail: 'label_name' });
    out.name = name;
  }
  if (body['color'] !== undefined) {
    if (typeof body['color'] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body['color'])) {
      throw new HelpPuffError('bad_request', { message: 'The colour is a hex colour like #3b82f6.', detail: 'label_color' });
    }
    out.color = body['color'].toLowerCase();
  }
  if (body['description'] !== undefined) {
    out.description = typeof body['description'] === 'string' ? cleanText(body['description'], 'line').slice(0, 200) || null : null;
  }
  if (body['ai'] !== undefined) out.ai = Boolean(body['ai']);
  return out;
}

inboxRoutes.get('/labels', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  return c.json({ labels: await listLabels(db(c), siteId), colors: LABEL_COLORS });
});

inboxRoutes.post('/labels', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const input = labelInput(body, false);
  const d = db(c);
  const count = await d.prepare('SELECT COUNT(*) AS n FROM labels WHERE site_id = ?').bind(siteId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_LABELS) throw new HelpPuffError('bad_request', { message: `At most ${MAX_LABELS} labels.`, detail: 'labels_too_many' });
  const taken = await d.prepare('SELECT id FROM labels WHERE site_id = ? AND name = ? COLLATE NOCASE').bind(siteId, input.name).first<{ id: string }>();
  if (taken) throw new HelpPuffError('conflict', { message: `There is a label called "${input.name}" already.`, detail: 'label_exists' });
  const id = `lbl_${crypto.randomUUID().slice(0, 12)}`;
  const color = input.color ?? LABEL_COLORS[(count?.n ?? 0) % LABEL_COLORS.length]!;
  await d
    .prepare('INSERT INTO labels (id, site_id, name, color, description, ai, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, siteId, input.name, color, input.description ?? null, input.ai === false ? 0 : 1, c.get('helppuff').platform.now())
    .run();
  return c.json({ id, name: input.name!, color, description: input.description ?? null, ai: input.ai !== false } satisfies Label, 201);
});

inboxRoutes.patch('/labels/:id', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const d = db(c);
  const row = await d.prepare('SELECT * FROM labels WHERE id = ?').bind(c.req.param('id')).first<{ id: string; site_id: string; name: string; color: string; description: string | null; ai: number }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such label.', detail: 'label_missing' });
  assertSiteAccess(c, row.site_id, 'label');
  const input = labelInput(await jsonBody(c), true);
  if (input.name && input.name.toLowerCase() !== row.name.toLowerCase()) {
    const taken = await d.prepare('SELECT id FROM labels WHERE site_id = ? AND name = ? COLLATE NOCASE').bind(row.site_id, input.name).first();
    if (taken) throw new HelpPuffError('conflict', { message: `There is a label called "${input.name}" already.`, detail: 'label_exists' });
  }
  const next = { ...row, ...input, ai: input.ai === undefined ? row.ai : input.ai ? 1 : 0 };
  await d.prepare('UPDATE labels SET name = ?, color = ?, description = ?, ai = ? WHERE id = ?').bind(next.name, next.color, next.description ?? null, next.ai, row.id).run();
  return c.json(labelView(next));
});

/** Removes the label from every conversation too. */
inboxRoutes.delete('/labels/:id', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const d = db(c);
  const id = c.req.param('id');
  const row = await d.prepare('SELECT site_id FROM labels WHERE id = ?').bind(id).first<{ site_id: string }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such label.', detail: 'label_missing' });
  assertSiteAccess(c, row.site_id, 'label');
  await d.batch([d.prepare('DELETE FROM conversation_labels WHERE label_id = ?').bind(id), d.prepare('DELETE FROM labels WHERE id = ?').bind(id)]);
  return c.json({ id, deleted: true });
});

// -------------------------------------------------------------- a conversation

/**
 * Change a conversation's labels and attributes. `labels` replaces the set;
 * `addLabels` / `removeLabels` change it; `attributes` merges (null removes a key).
 */
inboxRoutes.patch('/conversations/:id', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const d = db(c);
  const id = c.req.param('id');
  const row = await d.prepare('SELECT id, site_id, attributes FROM conversations WHERE id = ?').bind(id).first<{ id: string; site_id: string; attributes: string | null }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such conversation.', detail: 'admin_conversation_missing' });
  assertSiteAccess(c, row.site_id, 'conversation');
  const body = await jsonBody(c);
  const now = c.get('helppuff').platform.now();
  const statements: D1Statement[] = [];
  if (body['attributes'] !== undefined) {
    const attributes = mergeAttributes(parseJsonObject(row.attributes), body['attributes']);
    statements.push(d.prepare('UPDATE conversations SET attributes = ? WHERE id = ?').bind(attributesJson(attributes), id));
  }
  if (body['labels'] !== undefined || body['addLabels'] !== undefined || body['removeLabels'] !== undefined) {
    const current = (await d.prepare('SELECT label_id FROM conversation_labels WHERE conversation_id = ?').bind(id).all<{ label_id: string }>()).results.map((r) => r.label_id);
    let next = body['labels'] !== undefined ? await resolveLabels(d, row.site_id, body['labels']) : current;
    if (body['addLabels'] !== undefined) next = [...next, ...(await resolveLabels(d, row.site_id, body['addLabels']))];
    if (body['removeLabels'] !== undefined) {
      const gone = new Set(await resolveLabels(d, row.site_id, body['removeLabels']));
      next = next.filter((l) => !gone.has(l));
    }
    statements.push(...setLabelStatements(d, row.site_id, id, next, actorOf(admin), now));
  }
  if (!statements.length) throw new HelpPuffError('bad_request', { message: 'Nothing to update: send labels, addLabels, removeLabels or attributes.', detail: 'conversation_nothing' });
  await d.batch(statements);
  return c.json(await conversationExtras(d, id));
});

/** Who did it, as stored: the account's email, or the key. */
export const actorOf = (admin: Admin) => (admin.via === 'api-key' ? 'cli' : admin.email);

/** A conversation's labels, attributes, tool data and notes: what the detail view adds to the transcript. */
export async function conversationExtras(d: D1Like, id: string) {
  const [labels, notes, row] = await Promise.all([
    d
      .prepare('SELECT l.id, l.name, l.color, cl.added_by AS addedBy, cl.added_at AS addedAt FROM conversation_labels cl JOIN labels l ON l.id = cl.label_id WHERE cl.conversation_id = ? ORDER BY l.name COLLATE NOCASE')
      .bind(id)
      .all(),
    d.prepare('SELECT id, author, author_name AS authorName, text, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE conversation_id = ? ORDER BY created_at').bind(id).all(),
    d.prepare('SELECT attributes, data FROM conversations WHERE id = ?').bind(id).first<{ attributes: string | null; data: string | null }>(),
  ]);
  // `data`: what the site's tools returned or saved in it, by tool name.
  return { id, labels: labels.results, attributes: parseJsonObject(row?.attributes), data: parseData(row?.data), notes: notes.results };
}

// -------------------------------------------------------------------- notes

const noteText = (value: unknown) => {
  const text = typeof value === 'string' ? cleanText(value, 'input').trim().slice(0, 5000) : '';
  if (!text) throw new HelpPuffError('bad_request', { message: 'Write the note (up to 5000 characters).', detail: 'note_empty' });
  return text;
};

async function addNote(c: Context<HonoEnv>, target: { conversationId: string | null; leadId: string | null; siteId: string }) {
  const admin = await currentAdmin(c);
  const text = noteText((await jsonBody(c))['text']);
  const now = c.get('helppuff').platform.now();
  const id = `note_${now.toString(36)}${crypto.randomUUID().slice(0, 8)}`;
  await db(c)
    .prepare('INSERT INTO notes (id, site_id, conversation_id, lead_id, author, author_name, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, target.siteId, target.conversationId, target.leadId, actorOf(admin), admin.name, text, now, now)
    .run();
  return c.json({ id, conversationId: target.conversationId, leadId: target.leadId, author: actorOf(admin), authorName: admin.name, text, createdAt: now, updatedAt: now }, 201);
}

/** A private note on a conversation: the team sees it, the visitor never does. */
inboxRoutes.post('/conversations/:id/notes', async (c) => {
  assertSameOrigin(c);
  const row = await db(c).prepare('SELECT id, site_id, lead_id FROM conversations WHERE id = ?').bind(c.req.param('id')).first<{ id: string; site_id: string; lead_id: string | null }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such conversation.', detail: 'admin_conversation_missing' });
  assertSiteAccess(c, row.site_id, 'conversation');
  return addNote(c, { conversationId: row.id, leadId: row.lead_id, siteId: row.site_id });
});

/** A private note on a contact. */
inboxRoutes.post('/leads/:id/notes', async (c) => {
  assertSameOrigin(c);
  const row = await db(c).prepare('SELECT id, site_id FROM leads WHERE id = ?').bind(c.req.param('id')).first<{ id: string; site_id: string }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such lead.', detail: 'admin_lead_missing' });
  assertSiteAccess(c, row.site_id, 'lead');
  return addNote(c, { conversationId: null, leadId: row.id, siteId: row.site_id });
});

async function ownNote(c: Context<HonoEnv>) {
  const admin = await currentAdmin(c);
  const note = await db(c).prepare('SELECT * FROM notes WHERE id = ?').bind(c.req.param('id')).first<{ id: string; site_id: string; author: string }>();
  if (!note) throw new HelpPuffError('not_found', { message: 'No such note.', detail: 'note_missing' });
  assertSiteAccess(c, note.site_id, 'note');
  // Members change their own notes; admins any.
  if (admin.role === 'member' && note.author !== admin.email) throw new HelpPuffError('forbidden', { message: 'You can only change your own notes.', detail: 'note_not_yours' });
  return note;
}

inboxRoutes.patch('/notes/:id', async (c) => {
  assertSameOrigin(c);
  const note = await ownNote(c);
  const text = noteText((await jsonBody(c))['text']);
  const now = c.get('helppuff').platform.now();
  await db(c).prepare('UPDATE notes SET text = ?, updated_at = ? WHERE id = ?').bind(text, now, note.id).run();
  return c.json({ ...(await db(c).prepare('SELECT id, conversation_id AS conversationId, lead_id AS leadId, author, author_name AS authorName, text, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE id = ?').bind(note.id).first()) });
});

inboxRoutes.delete('/notes/:id', async (c) => {
  assertSameOrigin(c);
  const note = await ownNote(c);
  await db(c).prepare('DELETE FROM notes WHERE id = ?').bind(note.id).run();
  return c.json({ id: note.id, deleted: true });
});

// -------------------------------------------------------- personal settings

/** Each person's own notification settings for live chat. Defaults apply to anything not saved. */
export const DEFAULT_PREFS = {
  /** Take live chats: counted as available while the dashboard is open. */
  available: true,
  notifyNewChat: true,
  notifyNewMessage: true,
  soundNewChat: true,
  soundNewMessage: true,
  sound: 'chime' as 'chime' | 'bell' | 'pop',
  volume: 0.7,
  repeatUntilTaken: false,
};
export type Prefs = typeof DEFAULT_PREFS;

export function cleanPrefs(input: unknown, base: Prefs = DEFAULT_PREFS): Prefs {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const bool = (key: keyof Prefs) => (typeof o[key] === 'boolean' ? (o[key] as boolean) : (base[key] as boolean));
  return {
    available: bool('available'),
    notifyNewChat: bool('notifyNewChat'),
    notifyNewMessage: bool('notifyNewMessage'),
    soundNewChat: bool('soundNewChat'),
    soundNewMessage: bool('soundNewMessage'),
    sound: o['sound'] === 'bell' || o['sound'] === 'pop' || o['sound'] === 'chime' ? o['sound'] : base.sound,
    volume: typeof o['volume'] === 'number' && Number.isFinite(o['volume']) ? Math.min(1, Math.max(0, o['volume'])) : base.volume,
    repeatUntilTaken: bool('repeatUntilTaken'),
  };
}

export async function readPrefs(d: D1Like, email: string): Promise<Prefs> {
  const row = await d.prepare('SELECT prefs FROM admin_prefs WHERE email = ?').bind(email).first<{ prefs: string }>();
  try {
    return cleanPrefs(row ? (JSON.parse(row.prefs) as unknown) : {});
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

inboxRoutes.get('/prefs', async (c) => {
  const admin = await currentAdmin(c);
  return c.json(await readPrefs(db(c), admin.email));
});

inboxRoutes.put('/prefs', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const d = db(c);
  const prefs = cleanPrefs(await jsonBody(c), await readPrefs(d, admin.email));
  await d
    .prepare('INSERT INTO admin_prefs (email, prefs, updated_at) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at')
    .bind(admin.email, JSON.stringify(prefs), c.get('helppuff').platform.now())
    .run();
  return c.json(prefs);
});

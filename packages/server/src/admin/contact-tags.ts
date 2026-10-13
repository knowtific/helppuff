import { Hono } from 'hono';
import { cleanText } from '@helppuff/protocol';
import { HelpPuffError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import type { D1Like, D1Statement } from '../db/d1.js';
import { assertAdmin, assertSameOrigin, assertSiteAccess, currentAdmin, db, jsonBody, siteParam } from './guard.js';

export const contactTagRoutes = new Hono<HonoEnv>();

export const CONTACT_TAG_COLORS = ['#6b7280', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'] as const;
const MAX_TAGS = 100;
const MAX_PER_CONTACT = 20;

export type ContactTag = { id: string; name: string; color: string };

/** A contact's current tags, ordered by name, as a JSON column on a lead query. */
export const contactTagsSql = (alias = 'leads') =>
  `(SELECT COALESCE(json_group_array(json_object('id', ct.id, 'name', ct.name, 'color', ct.color)), '[]')
    FROM lead_tags lt JOIN contact_tags ct ON ct.id = lt.tag_id AND ct.site_id = lt.site_id
    WHERE lt.lead_id = ${alias}.id AND lt.site_id = ${alias}.site_id)`;

export function parseContactTags(value: unknown): ContactTag[] {
  if (Array.isArray(value)) return [...value as ContactTag[]].sort((a, b) => a.name.localeCompare(b.name));
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as ContactTag[]).sort((a, b) => a.name.localeCompare(b.name)) : [];
  } catch {
    return [];
  }
}

function tagInput(body: Record<string, unknown>, partial: boolean): { name?: string; color?: string } {
  const result: { name?: string; color?: string } = {};
  if (!partial || body['name'] !== undefined) {
    const name = typeof body['name'] === 'string' ? cleanText(body['name'], 'line').trim().slice(0, 40) : '';
    if (!name) throw new HelpPuffError('bad_request', { message: 'Give the tag a name (up to 40 characters).', detail: 'contact_tag_name' });
    result.name = name;
  }
  if (body['color'] !== undefined) {
    if (typeof body['color'] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body['color'])) {
      throw new HelpPuffError('bad_request', { message: 'The colour is a hex colour like #3b82f6.', detail: 'contact_tag_color' });
    }
    result.color = body['color'].toLowerCase();
  }
  return result;
}

/** Validate the complete replacement set before writing anything to a contact. */
export async function contactTagStatements(d: D1Like, siteId: string, leadId: string, value: unknown, now: number): Promise<D1Statement[]> {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
    throw new HelpPuffError('bad_request', { message: 'Tags must be a list of tag ids.', detail: 'contact_tags_invalid' });
  }
  const ids = [...new Set(value as string[])];
  if (ids.length > MAX_PER_CONTACT) throw new HelpPuffError('bad_request', { message: `At most ${MAX_PER_CONTACT} tags per contact.`, detail: 'contact_tags_too_many' });
  if (ids.length) {
    const found = await d.prepare(`SELECT id FROM contact_tags WHERE site_id = ? AND id IN (${ids.map(() => '?').join(', ')})`).bind(siteId, ...ids).all<{ id: string }>();
    if (found.results.length !== ids.length) throw new HelpPuffError('bad_request', { message: 'Choose tags from this site.', detail: 'contact_tag_unknown' });
  }
  return [
    d.prepare(`DELETE FROM lead_tags WHERE lead_id = ? AND site_id = ?${ids.length ? ` AND tag_id NOT IN (${ids.map(() => '?').join(', ')})` : ''}`).bind(leadId, siteId, ...ids),
    ...ids.map((id) => d.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id, site_id, added_at) VALUES (?, ?, ?, ?)').bind(leadId, id, siteId, now)),
  ];
}

contactTagRoutes.get('/contact-tags', async (c) => {
  await currentAdmin(c);
  const siteId = siteParam(c, c.req.query('site'));
  const rows = await db(c).prepare('SELECT id, name, color FROM contact_tags WHERE site_id = ? ORDER BY name COLLATE NOCASE').bind(siteId).all<ContactTag>();
  return c.json({ tags: rows.results, colors: CONTACT_TAG_COLORS });
});

contactTagRoutes.post('/contact-tags', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const input = tagInput(body, false);
  const d = db(c);
  const [count, taken] = await Promise.all([
    d.prepare('SELECT COUNT(*) AS n FROM contact_tags WHERE site_id = ?').bind(siteId).first<{ n: number }>(),
    d.prepare('SELECT id FROM contact_tags WHERE site_id = ? AND name = ? COLLATE NOCASE').bind(siteId, input.name).first(),
  ]);
  if ((count?.n ?? 0) >= MAX_TAGS) throw new HelpPuffError('bad_request', { message: `At most ${MAX_TAGS} contact tags.`, detail: 'contact_tags_limit' });
  if (taken) throw new HelpPuffError('conflict', { message: `A contact tag called “${input.name}” already exists.`, detail: 'contact_tag_exists' });
  const tag: ContactTag = { id: `ctag_${crypto.randomUUID()}`, name: input.name!, color: input.color ?? CONTACT_TAG_COLORS[(count?.n ?? 0) % CONTACT_TAG_COLORS.length]! };
  await d.prepare('INSERT INTO contact_tags (id, site_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)').bind(tag.id, siteId, tag.name, tag.color, c.get('helppuff').platform.now()).run();
  return c.json(tag, 201);
});

contactTagRoutes.patch('/contact-tags/:id', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const d = db(c);
  const row = await d.prepare('SELECT id, site_id, name, color FROM contact_tags WHERE id = ?').bind(c.req.param('id')).first<ContactTag & { site_id: string }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such contact tag.', detail: 'contact_tag_missing' });
  assertSiteAccess(c, row.site_id, 'contact tag');
  const input = tagInput(await jsonBody(c), true);
  if (input.name && input.name.toLowerCase() !== row.name.toLowerCase()) {
    const taken = await d.prepare('SELECT id FROM contact_tags WHERE site_id = ? AND name = ? COLLATE NOCASE').bind(row.site_id, input.name).first();
    if (taken) throw new HelpPuffError('conflict', { message: `A contact tag called “${input.name}” already exists.`, detail: 'contact_tag_exists' });
  }
  const tag = { id: row.id, name: input.name ?? row.name, color: input.color ?? row.color };
  await d.prepare('UPDATE contact_tags SET name = ?, color = ? WHERE id = ?').bind(tag.name, tag.color, tag.id).run();
  return c.json(tag);
});

contactTagRoutes.delete('/contact-tags/:id', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const d = db(c);
  const id = c.req.param('id');
  const row = await d.prepare('SELECT site_id FROM contact_tags WHERE id = ?').bind(id).first<{ site_id: string }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such contact tag.', detail: 'contact_tag_missing' });
  assertSiteAccess(c, row.site_id, 'contact tag');
  await d.batch([
    d.prepare('DELETE FROM lead_tags WHERE tag_id = ? AND site_id = ?').bind(id, row.site_id),
    d.prepare('DELETE FROM contact_tags WHERE id = ?').bind(id),
  ]);
  return c.json({ id, deleted: true });
});

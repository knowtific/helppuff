import { Hono } from 'hono';
import { ground } from '@murmur/rag';
import { resolveSite } from '../config/site.js';
import { resolveSecrets } from '../config/load.js';
import { MurmurError } from '../core/errors.js';
import { hitWindow, rateLimited } from '../core/ratelimit.js';
import type { HonoEnv } from '../core/request.js';
import { ownsKnowledge } from '../knowledge/env.js';

/**
 * Murmur's knowledge base as a Retell custom function: a Retell agent
 * (chat or voice) calls this to look things up on the site, so retrieval
 * stays on the owner's Cloudflare account while Retell owns the agent.
 *
 * Configure in Retell: a custom function, POST to
 * `https://<worker>/v1/sites/<site>/retell/kb`, parameters
 * `{ "query": { "type": "string" } }`. Retell signs every request with the
 * account's API key (retell-sdk `verify`, read 2026-10-04):
 *
 *   X-Retell-Signature: v=<unix ms>,d=<hex HMAC-SHA256(apiKey, rawBody + ms)>
 *
 * valid for five minutes. The answer is plain text (Retell caps a function
 * result at 15,000 characters).
 */

export const retellRoutes = new Hono<HonoEnv>();

const FIVE_MINUTES = 5 * 60_000;

export async function verifyRetellSignature(body: string, apiKey: string, header: string | undefined, now: number): Promise<boolean> {
  const match = /^v=(\d+),d=([0-9a-f]{64})$/i.exec(header ?? '');
  if (!match || !apiKey) return false;
  const stamp = Number(match[1]);
  if (!Number.isSafeInteger(stamp) || Math.abs(now - stamp) > FIVE_MINUTES) return false;
  const digest = Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(match[2]!.slice(i * 2, i * 2 + 2), 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, digest, new TextEncoder().encode(body + stamp));
}

function queryOf(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const root = body as Record<string, unknown>;
  // "Payload: args only" sends the arguments themselves; otherwise they are under `args`.
  const args = root['args'] && typeof root['args'] === 'object' ? (root['args'] as Record<string, unknown>) : root;
  const value = args['query'] ?? args['question'] ?? args['q'];
  return typeof value === 'string' ? value.trim().slice(0, 1000) : '';
}

retellRoutes.post('/v1/sites/:siteId/retell/kb', async (c) => {
  const ctx = c.get('mm');
  const siteId = c.req.param('siteId');
  const site = await resolveSite(ctx, siteId);
  if (site.connector.type !== 'retell' || !ownsKnowledge(site)) {
    throw new MurmurError('not_found', { detail: 'retell_kb_not_enabled' });
  }
  const verdict = await hitWindow(ctx.platform.kv, 'retellkb', siteId, 120, 60);
  if (!verdict.allowed) throw rateLimited(verdict, 'retell_kb_per_minute');

  const raw = await c.req.text();
  const options = resolveSecrets(site.connector.options ?? {}, ctx.env) as { apiKey?: unknown };
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey : '';
  if (!(await verifyRetellSignature(raw, apiKey, c.req.header('X-Retell-Signature'), ctx.platform.now()))) {
    throw new MurmurError('unauthorized', { detail: 'retell_signature_invalid' });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new MurmurError('bad_request', { detail: 'retell_body_not_json' });
  }
  const query = queryOf(body);
  if (!query) return c.text('Ask with a "query" argument: what the caller wants to know.');

  const grounding = await ground(ctx.env, siteId, query, { log: (e) => ctx.platform.log(e), waitUntil: ctx.platform.waitUntil });
  if (!grounding || !grounding.chunks.length) {
    return c.text('Nothing on the website answers this. Say you are not sure, and offer to connect the caller with the team.');
  }
  const text = grounding.chunks
    .map((chunk) => `${chunk.headingPath || chunk.title}${/^https?:/.test(chunk.url) ? ` (${chunk.url})` : ''}\n${chunk.content}`)
    .join('\n\n---\n\n')
    .slice(0, 14_000);
  return c.text(`From the website:\n\n${text}`);
});

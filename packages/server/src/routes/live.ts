import { Hono, type Context } from 'hono';
import { LIVE_SUBPROTOCOL, LIVE_TOKEN_PROTOCOL } from '@helppuff/protocol';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { assertAllowedOrigin } from '../core/origin.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { verifyToken } from '../core/token.js';
import { dbFrom } from '../db/d1.js';
import { agentSocket } from '../admin/live.js';
import { safeEqual } from '../admin/guard.js';
import { assignConversation, closeConversation, handBack, hubOf, HUB_ORIGIN, isLive, LiveError, liveDeps, readLiveState, sendAgentMessage } from '../live/service.js';
import { botApi, postToThread, readTelegram, readUpdate, saveTelegram, TELEGRAM_HELP, TELEGRAM_SECRET_HEADER, type TelegramUpdate } from '../live/telegram.js';

/**
 * Live chat's public doors: the visitor's socket, the team's socket (same
 * origin, signed in), and Telegram's webhook. Each authenticates first, then
 * hands the connection to the site's hub (`live/object.ts`) with who it is.
 * These are mounted before everything else: a WebSocket's 101 response has
 * headers that cannot be changed afterwards.
 */

export const liveSocketRoutes = new Hono<HonoEnv>();

/**
 * The visitor's socket. The session token rides as a subprotocol
 * (`helppuff.v1, t.<token>`), never in the URL; the Origin must be one of the
 * site's. Only a chat that is live (handed to a person) may connect.
 */
liveSocketRoutes.get('/v1/live/socket', async (c) => {
  const ctx = c.get('helppuff');
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') throw new HelpPuffError('bad_request', { detail: 'live_not_websocket' });
  const offered = (c.req.header('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim());
  const token = offered.find((p) => p.startsWith(LIVE_TOKEN_PROTOCOL))?.slice(LIVE_TOKEN_PROTOCOL.length);
  if (!offered.includes(LIVE_SUBPROTOCOL) || !token) throw new HelpPuffError('unauthorized', { detail: 'live_token_missing' });
  const payload = await verifyToken(requireSecret(ctx), token, ctx.platform.now());
  const site = await resolveSite(ctx, payload.siteId);
  assertAllowedOrigin(ctx.origin, site.origins);
  const db = dbFrom(ctx.env);
  const hub = hubOf(ctx.env, payload.siteId);
  if (!site.live.enabled || !db || !hub) throw new HelpPuffError('not_found', { detail: 'live_off' });
  if (!isLive(await readLiveState(db, payload.sessionId), site.live, ctx.platform.now())) throw new HelpPuffError('conflict', { message: 'This chat is not live.', detail: 'live_not_live' });
  return hub.fetch(`${HUB_ORIGIN}/socket`, {
    headers: {
      Upgrade: 'websocket',
      'Sec-WebSocket-Protocol': LIVE_SUBPROTOCOL,
      'X-Live-Kind': 'visitor',
      'X-Live-Conversation': payload.sessionId,
      'X-Live-Ip': await ctx.ipKey(),
      'X-Live-Limit': String(site.security.limits.liveSocketsPerIp),
    },
  });
});

/** The team's socket (see `admin/live.ts`). */
liveSocketRoutes.get('/admin/api/live/socket', (c) => agentSocket(c));

// ---------------------------------------------------------------- telegram

/**
 * Telegram's webhook for a site's bot: checked against the secret it was
 * given (`X-Telegram-Bot-Api-Secret-Token`), and only the linked chat is
 * read. Always answers 200 quickly, or Telegram retries; the work runs after.
 */
liveSocketRoutes.post('/v1/integrations/telegram/:site', async (c) => {
  const ctx = c.get('helppuff');
  const siteId = c.req.param('site');
  const db = dbFrom(ctx.env);
  if (!db || !ctx.config.sites[siteId] || ctx.secret.length < 32) throw new HelpPuffError('not_found', { detail: 'telegram_unknown_site' });
  const telegram = await readTelegram(db, ctx.secret, siteId);
  if (!telegram || !(await safeEqual(c.req.header(TELEGRAM_SECRET_HEADER) ?? '', telegram.secret))) {
    throw new HelpPuffError('unauthorized', { detail: 'telegram_bad_secret' });
  }
  const update = (await c.req.json().catch(() => ({}))) as TelegramUpdate;
  ctx.platform.waitUntil(handleUpdate(c, siteId, update).catch(() => ctx.platform.log('telegram.update_failed')));
  return c.json({ ok: true });
});

async function handleUpdate(c: Context<HonoEnv>, siteId: string, update: TelegramUpdate): Promise<void> {
  const ctx = c.get('helppuff');
  const deps = liveDeps(ctx);
  if (!deps) return;
  const telegram = await readTelegram(deps.db, ctx.secret, siteId);
  if (!telegram) return;
  const incoming = await readUpdate(deps.db, telegram, siteId, update);
  const site = await resolveSite(ctx, siteId);
  const reply = (chatId: string, text: string, threadId?: number | null) =>
    botApi(deps.fetch, telegram.token, 'sendMessage', { chat_id: chatId, text, ...(threadId ? { message_thread_id: threadId } : {}) }).catch(() => {});
  const inThread = (conversationId: string, text: string) => postToThread({ db: deps.db, fetch: deps.fetch, now: deps.now() }, telegram, siteId, conversationId, text).catch(() => {});

  switch (incoming.kind) {
    case 'link': {
      if (!telegram.config.linkCode || incoming.code !== telegram.config.linkCode) {
        await reply(incoming.chatId, telegram.config.chatId ? 'This bot is already linked to another chat.' : 'That code does not match. Copy it from the dashboard: Settings → Live chat → Telegram.');
        return;
      }
      // Topics: a forum group, or a private chat (its topic mode is tried at the first handover; replies work either way).
      await saveTelegram(deps.db, siteId, { ...telegram.config, chatId: incoming.chatId, chatTitle: incoming.chatTitle, topics: incoming.forum || incoming.private, linkCode: null }, telegram.secret, deps.now());
      await reply(
        incoming.chatId,
        `✅ Linked. Live chats from your website arrive here${incoming.forum || incoming.private ? ', one thread each' : ''}.${incoming.forum || incoming.private ? '' : '\nTurn on Topics for this group to get a thread per chat; until then, reply to a chat\'s message to answer it.'}`,
      );
      return;
    }
    case 'reply':
      try {
        await sendAgentMessage(deps, site.live, { conversationId: incoming.conversationId, text: incoming.text, author: incoming.from, from: 'telegram' });
      } catch (thrown) {
        if (thrown instanceof LiveError) await inThread(incoming.conversationId, `⚠️ Not sent: ${thrown.message}`);
      }
      return;
    case 'command': {
      const { conversationId, from } = incoming;
      try {
        if (incoming.command === 'take') await assignConversation(deps, site.live, { conversationId, to: from, by: from.id });
        else if (incoming.command === 'close') await closeConversation(deps, { conversationId, by: from.id, reason: 'team' });
        else if (incoming.command === 'ai') await handBack(deps, { conversationId, by: from.id });
        else if (incoming.command === 'info') {
          const row = await deps.db
            .prepare('SELECT c.page_url AS page, c.country, l.name, l.email, l.phone FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = ?')
            .bind(conversationId)
            .first<Record<string, string | null>>();
          const shown = telegram.config.shareContact ? [row?.['name'], row?.['email'], row?.['phone']] : [row?.['name']];
          await inThread(conversationId, [`Page: ${row?.['page'] ?? '—'}`, `Country: ${row?.['country'] ?? '—'}`, `Visitor: ${shown.filter(Boolean).join(' · ') || '—'}`].join('\n'));
        } else await inThread(conversationId, TELEGRAM_HELP);
      } catch (thrown) {
        if (thrown instanceof LiveError) await inThread(conversationId, `⚠️ ${thrown.message}`);
      }
      return;
    }
    default:
      return;
  }
}


import { Hono, type Context } from 'hono';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { assignConversation, closeConversation, handBack, hubOf, HUB_ORIGIN, LiveError, liveDeps, presence, sendAgentMessage, takeOver, type Author, type LiveDeps } from '../live/service.js';
import { botApi, connectTelegram, disconnectTelegram, readTelegram, saveTelegram, telegramReady, telegramStatus } from '../live/telegram.js';
import { assertAdmin, assertSameOrigin, assertSiteAccess, currentAdmin, db, jsonBody, siteParam, type Admin } from './guard.js';
import { actorOf, readPrefs } from './inbox.js';

/**
 * Live chat for the team: answer, take, give, close and hand back a chat;
 * who is available; Telegram. The visitor's side is `routes/live.ts`.
 */

export const liveRoutes = new Hono<HonoEnv>();

function deps(c: Context<HonoEnv>): LiveDeps {
  const found = liveDeps(c.get('helppuff'));
  if (!found) throw new HelpPuffError('not_found', { message: 'Live chat needs the dashboard database.', detail: 'live_no_db' });
  return found;
}

/** "sam.lee@acme.com" → "Sam": what the visitor sees when an account has no name. */
export function displayName(admin: Pick<Admin, 'email' | 'name'>): string {
  if (admin.name) return admin.name;
  const local = admin.email.split('@')[0] ?? admin.email;
  const first = local.split(/[._+-]/)[0] ?? local;
  return first ? first[0]!.toUpperCase() + first.slice(1) : admin.email;
}

const authorOf = (admin: Admin): Author => ({ id: actorOf(admin), name: admin.via === 'api-key' ? 'The team' : displayName(admin) });

function rethrow(thrown: unknown): never {
  if (thrown instanceof LiveError) {
    throw new HelpPuffError(thrown.code === 'not_found' ? 'not_found' : thrown.code === 'not_live' ? 'conflict' : 'bad_request', { message: thrown.message, detail: `live_${thrown.code}` });
  }
  throw thrown;
}

async function conversationSite(c: Context<HonoEnv>, id: string): Promise<string> {
  const row = await db(c).prepare('SELECT site_id FROM conversations WHERE id = ?').bind(id).first<{ site_id: string }>();
  if (!row) throw new HelpPuffError('not_found', { message: 'No such conversation.', detail: 'admin_conversation_missing' });
  assertSiteAccess(c, row.site_id, 'conversation');
  return row.site_id;
}

/** Reply to the visitor in a live chat. Writing takes the chat if nobody has. */
liveRoutes.post('/conversations/:id/reply', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const id = c.req.param('id');
  const site = await resolveSite(c.get('helppuff'), await conversationSite(c, id));
  if (!site.live.enabled) throw new HelpPuffError('bad_request', { message: 'Live chat is off: turn it on in Settings → Live chat.', detail: 'live_off' });
  const body = await jsonBody(c);
  try {
    const message = await sendAgentMessage(deps(c), site.live, { conversationId: id, text: typeof body['text'] === 'string' ? body['text'] : '', author: authorOf(admin) });
    return c.json(message, 201);
  } catch (thrown) {
    rethrow(thrown);
  }
});

/**
 * Take a chat (`to: "me"`), give it to someone on the team (`to: <email>`,
 * admins only), or unassign it (`to: null`). Members can take, not give.
 */
liveRoutes.post('/conversations/:id/assign', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const id = c.req.param('id');
  const site = await resolveSite(c.get('helppuff'), await conversationSite(c, id));
  const to = (await jsonBody(c))['to'];
  let target: Author | null;
  if (to === 'me' || (typeof to === 'string' && to.toLowerCase() === admin.email)) {
    if (admin.via !== 'session') throw new HelpPuffError('bad_request', { message: 'A key cannot take a chat: give it to someone with `to: <email>`.', detail: 'live_assign_key' });
    target = authorOf(admin);
  } else if (to === null) {
    target = null;
  } else if (typeof to === 'string') {
    if (admin.role === 'member') throw new HelpPuffError('forbidden', { message: 'Only an admin can give a chat to someone else. Take it yourself instead.', detail: 'admin_role_member' });
    const email = to.trim().toLowerCase();
    const owner = String(c.get('helppuff').env['ADMIN_EMAIL'] ?? '').toLowerCase();
    const row = await db(c).prepare('SELECT email, name FROM admins WHERE email = ?').bind(email).first<{ email: string; name: string | null }>();
    if (!row && email !== owner) throw new HelpPuffError('bad_request', { message: `${email} is not on the team.`, detail: 'live_assign_unknown' });
    target = { id: email, name: displayName({ email, name: row?.name ?? null }) };
  } else {
    throw new HelpPuffError('bad_request', { message: 'Send `to`: "me", a team member\'s email, or null.', detail: 'live_assign_body' });
  }
  try {
    return c.json(await assignConversation(deps(c), site.live, { conversationId: id, to: target, by: actorOf(admin) }));
  } catch (thrown) {
    rethrow(thrown);
  }
});

/** Close a conversation. The visitor of a live chat is told; their next message goes to the assistant. */
liveRoutes.post('/conversations/:id/close', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const id = c.req.param('id');
  await conversationSite(c, id);
  try {
    return c.json(await closeConversation(deps(c), { conversationId: id, by: actorOf(admin), reason: 'team' }));
  } catch (thrown) {
    rethrow(thrown);
  }
});

/** Hand a live chat back to the assistant, or reopen a closed one for it. */
liveRoutes.post('/conversations/:id/handback', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  const id = c.req.param('id');
  const site = await resolveSite(c.get('helppuff'), await conversationSite(c, id));
  try {
    return c.json(await handBack(deps(c), site.live, { conversationId: id, by: actorOf(admin) }));
  } catch (thrown) {
    rethrow(thrown);
  }
});

/**
 * Take a chat over, whatever it is doing: from the assistant, from a
 * colleague, or closed (this reopens it). It becomes live and yours. The
 * visitor sees who joined.
 */
liveRoutes.post('/conversations/:id/takeover', async (c) => {
  assertSameOrigin(c);
  const admin = await currentAdmin(c);
  if (admin.via !== 'session') throw new HelpPuffError('bad_request', { message: 'A key cannot take a chat: use a dashboard account, or reply with POST /conversations/:id/reply.', detail: 'live_takeover_key' });
  const id = c.req.param('id');
  const site = await resolveSite(c.get('helppuff'), await conversationSite(c, id));
  if (!site.live.enabled) throw new HelpPuffError('bad_request', { message: 'Live chat is off: turn it on in Settings → Live chat.', detail: 'live_off' });
  try {
    return c.json(await takeOver(deps(c), site.live, { conversationId: id, author: authorOf(admin) }));
  } catch (thrown) {
    rethrow(thrown);
  }
});

/** Is live chat on, who can take chats, and how many are waiting (the menu's badge). */
liveRoutes.get('/live/status', async (c) => {
  const admin = await currentAdmin(c);
  const ctx = c.get('helppuff');
  const siteId = siteParam(c, c.req.query('site'));
  const site = await resolveSite(ctx, siteId);
  const d = db(c);
  const cutoff = ctx.platform.now() - site.live.closeAfterMinutes * 60_000;
  const [people, counts, telegram] = await Promise.all([
    site.live.enabled ? presence(ctx.env, siteId) : Promise.resolve({ available: 0, agents: [] }),
    d
      .prepare(
        `SELECT COUNT(*) AS live,
                COALESCE(SUM(CASE WHEN assigned_to IS NULL THEN 1 ELSE 0 END), 0) AS unassigned,
                COALESCE(SUM(CASE WHEN waiting_since IS NOT NULL THEN 1 ELSE 0 END), 0) AS waiting,
                COALESCE(SUM(CASE WHEN assigned_to = ? AND waiting_since IS NOT NULL THEN 1 ELSE 0 END), 0) AS mine
         FROM conversations WHERE site_id = ? AND status = 'live' AND last_at >= ?`,
      )
      .bind(admin.email, siteId, cutoff)
      .first<{ live: number; unassigned: number; waiting: number; mine: number }>(),
    telegramStatus(d, siteId),
  ]);
  return c.json({
    enabled: site.live.enabled,
    hub: Boolean(hubOf(ctx.env, siteId)),
    available: people.available,
    agents: people.agents,
    telegram: { connected: Boolean(telegram.config), linked: Boolean(telegram.config?.chatId) },
    live: counts?.live ?? 0,
    unassigned: counts?.unassigned ?? 0,
    waiting: counts?.waiting ?? 0,
    mine: counts?.mine ?? 0,
  });
});

// ------------------------------------------------------------------- socket

/**
 * The team's live socket, at `/admin/api/live/socket`: new chats waiting,
 * messages, who took what. Mounted on the app ahead of the admin router (a
 * 101 response's headers cannot be changed afterwards). Same-origin only
 * (the cookie alone would let another site open it), and the session is
 * checked like any request: signing out or a password change ends it at the
 * next connection.
 */
export async function agentSocket(c: Context<HonoEnv>): Promise<Response> {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') throw new HelpPuffError('bad_request', { message: 'Expected a WebSocket.', detail: 'live_not_websocket' });
  const origin = c.req.header('Origin');
  if (!origin || origin !== new URL(c.req.url).origin) throw new HelpPuffError('forbidden_origin', { message: 'Cross-origin request refused.', detail: 'admin_cross_origin' });
  const admin = await currentAdmin(c);
  if (admin.via !== 'session') throw new HelpPuffError('unauthorized', { message: 'Please sign in.', detail: 'live_socket_session' });
  const siteId = siteParam(c, c.req.query('site'));
  const hub = hubOf(c.get('helppuff').env, siteId);
  if (!hub) throw new HelpPuffError('not_found', { message: 'Live chat needs a redeploy (`helppuff upgrade`).', detail: 'live_no_hub' });
  const prefs = await readPrefs(db(c), admin.email);
  const headers = new Headers({
    Upgrade: 'websocket',
    'X-Live-Kind': 'agent',
    'X-Live-Email': admin.email,
    'X-Live-Name': displayName(admin),
    'X-Live-Available': prefs.available ? '1' : '0',
  });
  const protocols = c.req.header('Sec-WebSocket-Protocol');
  if (protocols) headers.set('Sec-WebSocket-Protocol', protocols);
  return hub.fetch(`${HUB_ORIGIN}/socket`, { headers });
}

// ----------------------------------------------------------------- telegram

const webhookUrl = (c: Context<HonoEnv>, siteId: string) => `${new URL(c.req.url).origin}/v1/integrations/telegram/${encodeURIComponent(siteId)}`;

function telegramView(status: Awaited<ReturnType<typeof telegramStatus>>) {
  const config = status.config;
  return {
    connected: Boolean(config),
    linked: Boolean(config?.chatId),
    bot: config ? { name: config.botName, username: config.username } : null,
    chat: config?.chatId ? { title: config.chatTitle, topics: config.topics } : null,
    /** Send `/link <code>` in the chat to answer from (until one is linked). */
    linkCode: config && !config.chatId ? config.linkCode : null,
    shareContact: config?.shareContact ?? true,
    status: status.status,
    lastError: status.lastError,
    updatedAt: status.updatedAt,
  };
}

liveRoutes.get('/live/telegram', async (c) => {
  assertAdmin(await currentAdmin(c));
  return c.json(telegramView(await telegramStatus(db(c), siteParam(c, c.req.query('site')))));
});

/** Connect a bot by its token (from @BotFather). The answer has the code to send as `/link <code>` in the chat to answer from. */
liveRoutes.post('/live/telegram', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const ctx = c.get('helppuff');
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const token = typeof body['token'] === 'string' ? body['token'].trim() : '';
  try {
    await connectTelegram({ db: db(c), fetch: globalThis.fetch.bind(globalThis), secret: requireSecret(ctx), now: ctx.platform.now() }, siteId, token, webhookUrl(c, siteId));
  } catch (thrown) {
    throw new HelpPuffError('bad_request', { message: (thrown as Error).message.replace(/bot\d+:[\w-]+/g, 'bot…'), detail: 'telegram_connect_failed' });
  }
  return c.json(telegramView(await telegramStatus(db(c), siteId)), 201);
});

liveRoutes.patch('/live/telegram', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const ctx = c.get('helppuff');
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const telegram = await readTelegram(db(c), requireSecret(ctx), siteId);
  if (!telegram) throw new HelpPuffError('not_found', { message: 'Telegram is not connected.', detail: 'telegram_not_connected' });
  const config = { ...telegram.config, ...(typeof body['shareContact'] === 'boolean' ? { shareContact: body['shareContact'] } : {}) };
  await saveTelegram(db(c), siteId, config, telegram.secret, ctx.platform.now());
  return c.json(telegramView(await telegramStatus(db(c), siteId)));
});

/** Send a test message to the linked chat. */
liveRoutes.post('/live/telegram/test', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const ctx = c.get('helppuff');
  const siteId = siteParam(c, (await jsonBody(c))['site']);
  const telegram = await readTelegram(db(c), requireSecret(ctx), siteId);
  if (!telegramReady(telegram)) throw new HelpPuffError('bad_request', { message: 'Link a chat first: send /link <code> there.', detail: 'telegram_not_linked' });
  try {
    await botApi(globalThis.fetch.bind(globalThis), telegram.token, 'sendMessage', { chat_id: telegram.config.chatId, text: '✅ HelpPuff test: live chats will arrive here, one thread each.' });
  } catch (thrown) {
    throw new HelpPuffError('bad_request', { message: (thrown as Error).message.replace(/bot\d+:[\w-]+/g, 'bot…'), detail: 'telegram_test_failed' });
  }
  return c.json({ ok: true });
});

liveRoutes.delete('/live/telegram', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const ctx = c.get('helppuff');
  const siteId = siteParam(c, c.req.query('site'));
  await disconnectTelegram({ db: db(c), fetch: globalThis.fetch.bind(globalThis), secret: requireSecret(ctx) }, siteId);
  return c.json({ connected: false });
});

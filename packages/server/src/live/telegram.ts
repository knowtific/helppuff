import type { D1Like } from '../db/d1.js';
import { open, seal } from '../core/secretbox.js';

/**
 * Telegram as a place the team answers live chats from: each handover is a
 * topic (thread) in the linked chat — a group with Topics on, the bot an
 * admin with "Manage topics", or a private chat with the bot when its topic
 * mode is on in @BotFather. Everything written in that topic goes to that
 * visitor. Where topics are off, each handover is a message and replying to
 * it answers that visitor.
 *
 * The bot token is the owner's (made with @BotFather; an agent cannot do that
 * step) and is stored encrypted (core/secretbox.ts). Telegram's webhook is
 * checked with the secret header it echoes back, and only the linked chat is
 * listened to.
 *
 * Bot API: https://core.telegram.org/bots/api (createForumTopic,
 * closeForumTopic, sendMessage `message_thread_id`, setWebhook
 * `secret_token`, header X-Telegram-Bot-Api-Secret-Token).
 */

const PURPOSE = 'telegram-bot-token';
export const TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

export type TelegramConfig = {
  /** The sealed bot token. */
  token: string;
  botId: number;
  botName: string;
  username: string;
  /** The chat replies come from; null until `/link <code>` is sent there. */
  chatId: string | null;
  chatTitle: string | null;
  /** Topics work in the linked chat (else: one message per handover, answered by replying). */
  topics: boolean;
  /** The one-time code `/link` expects, until a chat is linked. */
  linkCode: string | null;
  /** Include the visitor's email and phone in what is sent to Telegram. */
  shareContact: boolean;
};

export type Telegram = { config: TelegramConfig; token: string; secret: string };

type Fetch = typeof fetch;

/** One Bot API call. Throws with Telegram's description on failure (never the token). */
export async function botApi<T>(doFetch: Fetch, token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await doFetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!json?.ok) throw new Error(`Telegram ${method}: ${json?.description?.slice(0, 200) ?? `HTTP ${response.status}`}`);
  return json.result as T;
}

export async function readTelegram(db: D1Like, secret: string, siteId: string): Promise<Telegram | null> {
  const row = await db
    .prepare("SELECT config, secret FROM integrations WHERE site_id = ? AND kind = 'telegram'")
    .bind(siteId)
    .first<{ config: string; secret: string | null }>()
    .catch(() => null);
  if (!row?.secret) return null;
  try {
    const config = JSON.parse(row.config) as TelegramConfig;
    const token = await open(secret, PURPOSE, config.token);
    return token ? { config, token, secret: row.secret } : null;
  } catch {
    return null;
  }
}

export async function saveTelegram(db: D1Like, siteId: string, config: TelegramConfig, webhookSecret: string, now: number, status = 'ok', error: string | null = null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO integrations (site_id, kind, config, secret, status, last_error, updated_at) VALUES (?, 'telegram', ?, ?, ?, ?, ?)
       ON CONFLICT (site_id, kind) DO UPDATE SET config = excluded.config, secret = excluded.secret, status = excluded.status, last_error = excluded.last_error, updated_at = excluded.updated_at`,
    )
    .bind(siteId, JSON.stringify(config), webhookSecret, status, error, now)
    .run();
}

export async function telegramStatus(db: D1Like, siteId: string): Promise<{ status: string | null; lastError: string | null; updatedAt: number | null; config: TelegramConfig | null }> {
  const row = await db
    .prepare("SELECT config, status, last_error, updated_at FROM integrations WHERE site_id = ? AND kind = 'telegram'")
    .bind(siteId)
    .first<{ config: string; status: string | null; last_error: string | null; updated_at: number }>()
    .catch(() => null);
  if (!row) return { status: null, lastError: null, updatedAt: null, config: null };
  let config: TelegramConfig | null = null;
  try {
    config = JSON.parse(row.config) as TelegramConfig;
  } catch {
    // Unreadable: reported as not connected.
  }
  return { status: row.status, lastError: row.last_error, updatedAt: row.updated_at, config };
}

const randomCode = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Connect a bot: check the token (`getMe`), point its webhook here with a
 * fresh secret, and store it sealed, waiting for `/link <code>` in a chat.
 */
export async function connectTelegram(
  deps: { db: D1Like; fetch: Fetch; secret: string; now: number },
  siteId: string,
  token: string,
  webhookUrl: string,
): Promise<TelegramConfig> {
  if (!/^\d{5,16}:[A-Za-z0-9_-]{30,64}$/.test(token)) throw new Error('That does not look like a bot token. Copy it from @BotFather: digits, a colon, then letters.');
  const me = await botApi<{ id: number; first_name: string; username: string }>(deps.fetch, token, 'getMe');
  const webhookSecret = randomCode(24);
  await botApi(deps.fetch, token, 'setWebhook', { url: webhookUrl, secret_token: webhookSecret, allowed_updates: ['message'], drop_pending_updates: true });
  const config: TelegramConfig = {
    token: await seal(deps.secret, PURPOSE, token),
    botId: me.id,
    botName: me.first_name,
    username: me.username,
    chatId: null,
    chatTitle: null,
    topics: false,
    linkCode: randomCode(4),
    shareContact: true,
  };
  await saveTelegram(deps.db, siteId, config, webhookSecret, deps.now, 'linking');
  return config;
}

export async function disconnectTelegram(deps: { db: D1Like; fetch: Fetch; secret: string }, siteId: string): Promise<void> {
  const telegram = await readTelegram(deps.db, deps.secret, siteId);
  if (telegram) await botApi(deps.fetch, telegram.token, 'deleteWebhook', {}).catch(() => {});
  await deps.db.batch([
    deps.db.prepare("DELETE FROM integrations WHERE site_id = ? AND kind = 'telegram'").bind(siteId),
    deps.db.prepare('DELETE FROM telegram_threads WHERE site_id = ?').bind(siteId),
  ]);
}

/** Linked and answering: Telegram counts as someone available (it has no presence of its own). */
export const telegramReady = (telegram: Telegram | null): telegram is Telegram => Boolean(telegram?.config.chatId);

// ------------------------------------------------------------------ threads

export type Thread = { chatId: string; threadId: string };

/**
 * Open a thread for a handover in the linked chat, with what the team needs:
 * who, which page, and the last few messages. Returns where it went.
 */
export async function openThread(
  deps: { db: D1Like; fetch: Fetch; now: number },
  telegram: Telegram,
  siteId: string,
  conversationId: string,
  title: string,
  intro: string,
): Promise<Thread | null> {
  const chatId = telegram.config.chatId;
  if (!chatId) return null;
  let threadId: string | null = null;
  if (telegram.config.topics) {
    try {
      const topic = await botApi<{ message_thread_id: number }>(deps.fetch, telegram.token, 'createForumTopic', { chat_id: chatId, name: title.slice(0, 128) });
      threadId = String(topic.message_thread_id);
      await sendText(deps.fetch, telegram, { chatId, threadId }, intro);
    } catch {
      // Topics turned off since the link: one message, answered by replying.
      threadId = null;
    }
  }
  if (!threadId) {
    const sent = await botApi<{ message_id: number }>(deps.fetch, telegram.token, 'sendMessage', {
      chat_id: chatId,
      text: `${title}\n\n${intro}\n\nReply to this message to answer.`.slice(0, 4096),
      link_preview_options: { is_disabled: true },
    });
    threadId = `r${sent.message_id}`;
  }
  await deps.db
    .prepare('INSERT OR REPLACE INTO telegram_threads (site_id, chat_id, thread_id, conversation_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(siteId, chatId, threadId, conversationId, deps.now)
    .run();
  return { chatId, threadId };
}

export async function threadOf(db: D1Like, conversationId: string): Promise<Thread | null> {
  const row = await db
    .prepare('SELECT chat_id, thread_id FROM telegram_threads WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(conversationId)
    .first<{ chat_id: string; thread_id: string }>()
    .catch(() => null);
  return row ? { chatId: row.chat_id, threadId: row.thread_id } : null;
}

/** Text into a thread: the topic, or (reply mode) as a reply to the handover's message, so a reply to it routes back. */
export async function sendText(doFetch: Fetch, telegram: Telegram, thread: Thread, text: string): Promise<number | null> {
  const where = thread.threadId.startsWith('r')
    ? { reply_parameters: { message_id: Number(thread.threadId.slice(1)), allow_sending_without_reply: true } }
    : { message_thread_id: Number(thread.threadId) };
  const sent = await botApi<{ message_id: number }>(doFetch, telegram.token, 'sendMessage', {
    chat_id: thread.chatId,
    text: text.slice(0, 4096),
    link_preview_options: { is_disabled: true },
    ...where,
  });
  return sent.message_id;
}

/** Text into a conversation's thread, if it has one. In reply mode the new message is mapped too, so a reply to it routes back. */
export async function postToThread(deps: { db: D1Like; fetch: Fetch; now: number }, telegram: Telegram, siteId: string, conversationId: string, text: string): Promise<void> {
  const thread = await threadOf(deps.db, conversationId);
  if (!thread) return;
  const id = await sendText(deps.fetch, telegram, thread, text);
  if (id && thread.threadId.startsWith('r')) {
    await deps.db
      .prepare('INSERT OR IGNORE INTO telegram_threads (site_id, chat_id, thread_id, conversation_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(siteId, thread.chatId, `r${id}`, conversationId, deps.now)
      .run();
  }
}

export async function closeThread(deps: { db: D1Like; fetch: Fetch }, telegram: Telegram, conversationId: string, text: string): Promise<void> {
  const thread = await threadOf(deps.db, conversationId);
  if (!thread) return;
  await sendText(deps.fetch, telegram, thread, text).catch(() => null);
  if (!thread.threadId.startsWith('r')) {
    await botApi(deps.fetch, telegram.token, 'closeForumTopic', { chat_id: thread.chatId, message_thread_id: Number(thread.threadId) }).catch(() => {});
  }
}

// ----------------------------------------------------------------- updates

export type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id: number;
    message_thread_id?: number;
    is_topic_message?: boolean;
    from?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
    chat: { id: number; type: string; title?: string; is_forum?: boolean; first_name?: string };
    text?: string;
    reply_to_message?: { message_id: number };
  };
};

/** What an incoming message means for HelpPuff. */
export type Incoming =
  | { kind: 'link'; code: string; chatId: string; chatTitle: string; forum: boolean; private: boolean }
  | { kind: 'command'; command: 'close' | 'ai' | 'take' | 'info' | 'help'; conversationId: string; from: TelegramUser }
  | { kind: 'reply'; conversationId: string; text: string; from: TelegramUser }
  | { kind: 'unrouted'; chatId: string; threadId: number | null }
  | { kind: 'ignore' };

export type TelegramUser = { id: string; name: string };

const COMMAND = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/;

/** Read an update from Telegram: a link, a command in a thread, a reply to a visitor, or nothing for us. */
export async function readUpdate(db: D1Like, telegram: Telegram, siteId: string, update: TelegramUpdate): Promise<Incoming> {
  const message = update.message;
  if (!message?.text || !message.from || message.from.is_bot) return { kind: 'ignore' };
  const text = message.text.trim();
  const chatId = String(message.chat.id);
  const command = COMMAND.exec(text);
  if (command?.[1] === 'link') {
    return {
      kind: 'link',
      code: (command[2] ?? '').trim(),
      chatId,
      chatTitle: message.chat.title ?? message.chat.first_name ?? 'Private chat',
      forum: Boolean(message.chat.is_forum),
      private: message.chat.type === 'private',
    };
  }
  // Only the linked chat is listened to.
  if (!telegram.config.chatId || chatId !== telegram.config.chatId) return { kind: 'ignore' };
  const threadId = message.is_topic_message && message.message_thread_id ? String(message.message_thread_id) : null;
  const replyTo = message.reply_to_message?.message_id;
  const candidates = [...(threadId ? [threadId] : []), ...(replyTo ? [`r${replyTo}`] : [])];
  let conversationId: string | null = null;
  for (const candidate of candidates) {
    const row = await db
      .prepare('SELECT conversation_id FROM telegram_threads WHERE site_id = ? AND chat_id = ? AND thread_id = ?')
      .bind(siteId, chatId, candidate)
      .first<{ conversation_id: string }>();
    if (row) {
      conversationId = row.conversation_id;
      break;
    }
  }
  if (!conversationId) return { kind: 'unrouted', chatId, threadId: threadId ? Number(threadId) : null };
  const from: TelegramUser = { id: `telegram:${message.from.id}`, name: (message.from.first_name ?? message.from.username ?? 'Telegram').slice(0, 80) };
  if (command) {
    const name = command[1]!.toLowerCase();
    const known = { close: 'close', ai: 'ai', take: 'take', claim: 'take', info: 'info', help: 'help', start: 'help' } as const;
    const found = known[name as keyof typeof known];
    if (found) return { kind: 'command', command: found, conversationId, from };
  }
  return { kind: 'reply', conversationId, text, from };
}

export const TELEGRAM_HELP = [
  'Write in this thread to answer the visitor.',
  '/take — take the chat (writing takes it too)',
  '/close — close the chat',
  '/ai — hand back to the assistant',
  '/info — the visitor’s page and details',
].join('\n');

import type { Message } from '@murmur/protocol';
import { MAX_STORED_MESSAGES, type State } from './store.js';

/** Bumping this discards every older payload rather than migrating it. */
export const PERSIST_VERSION = 1;

export type Persisted = {
  v: typeof PERSIST_VERSION;
  sessionToken: string;
  sessionId: string;
  expiresAt: number;
  lead?: Record<string, string>;
  messages: Message[];
  consumedActions: string[];
  ui: { sound: boolean; teaserDismissed: boolean };
};

export const storageKey = (siteId: string) => `mm:${siteId}`;

/**
 * Storage is never load-bearing. Every read and write is guarded, and
 * an unavailable or corrupt store degrades to an in-memory session rather than
 * failing.
 */
function safeStorage(): Storage | null {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    // Safari in private mode throws on write, not on access.
    const probe = '__mm__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function load(siteId: string, now = Date.now()): Partial<State> | null {
  const store = safeStorage();
  if (!store) return null;

  let raw: string | null;
  try {
    raw = store.getItem(storageKey(siteId));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clear(siteId);
    return null;
  }

  const data = validate(parsed, now);
  if (!data) {
    clear(siteId);
    return null;
  }

  return {
    session: { token: data.sessionToken, id: data.sessionId, expiresAt: data.expiresAt },
    ...(data.lead ? { lead: data.lead } : {}),
    messages: data.messages,
    consumedActions: data.consumedActions,
    sound: data.ui.sound,
    teaserDismissed: data.ui.teaserDismissed,
  };
}

/**
 * Validate at the boundary once, then treat the data as typed. A field
 * of the wrong type is treated as absent and its default applied; a wrong
 * version or a past expiry discards the whole payload.
 */
function validate(value: unknown, now: number): Persisted | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  if (v['v'] !== PERSIST_VERSION) return null;
  if (typeof v['sessionToken'] !== 'string' || !v['sessionToken']) return null;
  if (typeof v['sessionId'] !== 'string' || !v['sessionId']) return null;
  if (typeof v['expiresAt'] !== 'number' || v['expiresAt'] <= now) return null;

  const ui = typeof v['ui'] === 'object' && v['ui'] !== null ? (v['ui'] as Record<string, unknown>) : {};

  return {
    v: PERSIST_VERSION,
    sessionToken: v['sessionToken'],
    sessionId: v['sessionId'],
    expiresAt: v['expiresAt'],
    ...(isStringRecord(v['lead']) ? { lead: v['lead'] } : {}),
    messages: isMessageArray(v['messages']) ? v['messages'].slice(-MAX_STORED_MESSAGES) : [],
    consumedActions: isStringArray(v['consumedActions']) ? v['consumedActions'].slice(-200) : [],
    ui: {
      sound: ui['sound'] === true,
      teaserDismissed: ui['teaserDismissed'] === true,
    },
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

/**
 * A shallow shape check only. The renderer treats an unknown `type` as
 * nothing, so a stale message cannot break the thread.
 */
function isMessageArray(value: unknown): value is Message[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Message).id === 'string' &&
        typeof (item as Message).type === 'string' &&
        typeof (item as Message).role === 'string',
    )
  );
}

export function save(siteId: string, state: State): void {
  const store = safeStorage();
  if (!store || !state.session) return;

  const payload: Persisted = {
    v: PERSIST_VERSION,
    sessionToken: state.session.token,
    sessionId: state.session.id,
    expiresAt: state.session.expiresAt,
    ...(state.lead ? { lead: state.lead } : {}),
    messages: state.messages.slice(-MAX_STORED_MESSAGES),
    consumedActions: state.consumedActions.slice(-200),
    ui: { sound: state.sound, teaserDismissed: state.teaserDismissed },
  };

  try {
    store.setItem(storageKey(siteId), JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — the session continues in memory.
  }
}

export function clear(siteId: string): void {
  try {
    safeStorage()?.removeItem(storageKey(siteId));
  } catch {
    // Nothing to do; the widget does not depend on this succeeding.
  }
}

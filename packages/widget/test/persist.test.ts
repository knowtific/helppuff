import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@helppuff/protocol';
import { PERSIST_VERSION, clear, load, save, storageKey, type Persisted } from '../src/app/persist.js';
import { MAX_STORED_MESSAGES, initialState, type State } from '../src/app/store.js';

/** A localStorage stand-in whose failure modes can be switched on per test. */
function fakeStorage(options: { throwOnSet?: boolean; throwOnGet?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => {
      if (options.throwOnGet) throw new Error('storage blocked');
      return map.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (options.throwOnSet) throw new Error('QuotaExceededError');
      map.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
    get size() {
      return map.size;
    },
    raw: map,
  };
}

function install(storage: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}

afterEach(() => {
  install(undefined);
  vi.restoreAllMocks();
});

const message = (id: string): Message => ({ id, ts: 1, role: 'agent', type: 'text', text: 'hi' });

const liveState = (overrides: Partial<State> = {}): State => ({
  ...initialState,
  session: { token: 'tok', id: 'sid', expiresAt: 9e15 },
  lead: { name: 'Ada' },
  messages: [message('a')],
  consumedActions: ['opt1'],
  sound: true,
  teaserDismissed: true,
  ...overrides,
});

const valid = (overrides: Partial<Persisted> = {}): Persisted => ({
  v: PERSIST_VERSION,
  sessionToken: 'tok',
  sessionId: 'sid',
  expiresAt: 9e15,
  lead: { name: 'Ada' },
  messages: [message('a')],
  consumedActions: ['opt1'],
  ui: { sound: true, teaserDismissed: true },
  ...overrides,
});

describe('save and load', () => {
  it('round-trips a live session', () => {
    const storage = fakeStorage();
    install(storage);

    save('demo', liveState());
    const restored = load('demo');

    expect(restored).toMatchObject({
      session: { token: 'tok', id: 'sid' },
      lead: { name: 'Ada' },
      consumedActions: ['opt1'],
      sound: true,
      teaserDismissed: true,
    });
    expect(restored?.messages).toHaveLength(1);
  });

  it('uses one key per site, prefixed hp:', () => {
    const storage = fakeStorage();
    install(storage);
    save('demo', liveState());
    expect([...storage.raw.keys()]).toEqual(['hp:demo']);
    expect(storageKey('other')).toBe('hp:other');
  });

  it('writes nothing when there is no session to keep', () => {
    const storage = fakeStorage();
    install(storage);
    save('demo', { ...initialState, messages: [message('a')] });
    expect(storage.size).toBe(0);
  });

  it('caps the stored transcript', () => {
    const storage = fakeStorage();
    install(storage);
    const many = Array.from({ length: MAX_STORED_MESSAGES + 20 }, (_, i) => message(`m${i}`));
    save('demo', liveState({ messages: many }));
    expect(load('demo')?.messages).toHaveLength(MAX_STORED_MESSAGES);
  });

  it('sets no cookies and touches no other key', () => {
    const storage = fakeStorage();
    install(storage);
    storage.raw.set('host-page-key', 'do not touch');
    save('demo', liveState());
    clear('demo');
    expect(storage.raw.get('host-page-key')).toBe('do not touch');
  });
});

describe('load rejects anything it cannot trust', () => {
  const rejects = (stored: unknown) => {
    const storage = fakeStorage();
    install(storage);
    storage.raw.set('hp:demo', typeof stored === 'string' ? stored : JSON.stringify(stored));
    return load('demo');
  };

  it('returns null when nothing is stored', () => {
    install(fakeStorage());
    expect(load('demo')).toBeNull();
  });

  it.each([
    ['unparseable JSON', '{ not json'],
    ['a bare string', '"hello"'],
    ['null', 'null'],
    ['an array', '[]'],
  ])('discards %s', (_name, stored) => {
    expect(rejects(stored)).toBeNull();
  });

  it('discards a payload from an older version', () => {
    expect(rejects({ ...valid(), v: 0 })).toBeNull();
  });

  it('discards an expired session', () => {
    expect(rejects({ ...valid(), expiresAt: Date.now() - 1000 })).toBeNull();
  });

  it.each([
    ['a missing token', { sessionToken: undefined }],
    ['an empty token', { sessionToken: '' }],
    ['a non-string token', { sessionToken: 42 }],
    ['a missing session id', { sessionId: undefined }],
    ['a non-numeric expiry', { expiresAt: 'soon' }],
  ])('discards %s', (_name, patch) => {
    expect(rejects({ ...valid(), ...patch })).toBeNull();
  });

  it('erases a payload it rejected, so the next load starts clean', () => {
    const storage = fakeStorage();
    install(storage);
    storage.raw.set('hp:demo', '{ not json');
    load('demo');
    expect(storage.raw.has('hp:demo')).toBe(false);
  });

  it('treats a malformed field as absent rather than failing the whole restore', () => {
    const restored = rejects({ ...valid(), messages: 'not an array', consumedActions: [1, 2], lead: { name: 5 } });
    expect(restored).not.toBeNull();
    expect(restored?.messages).toEqual([]);
    expect(restored?.consumedActions).toEqual([]);
    expect(restored?.lead).toBeUndefined();
  });

  it('drops messages that are not shaped like messages', () => {
    expect(rejects({ ...valid(), messages: [{ nope: true }] })?.messages).toEqual([]);
  });

  it('defaults the ui block when it is missing or wrong', () => {
    const restored = rejects({ ...valid(), ui: 'nope' });
    expect(restored?.sound).toBe(false);
    expect(restored?.teaserDismissed).toBe(false);
  });
});

describe('storage is never load-bearing', () => {
  it('degrades to in-memory when localStorage is absent', () => {
    install(undefined);
    expect(load('demo')).toBeNull();
    expect(() => save('demo', liveState())).not.toThrow();
    expect(() => clear('demo')).not.toThrow();
  });

  it('degrades when the accessor itself throws, as in a locked-down browser', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(load('demo')).toBeNull();
    expect(() => save('demo', liveState())).not.toThrow();
  });

  it('degrades when writing throws, as in Safari private mode', () => {
    install(fakeStorage({ throwOnSet: true }));
    expect(() => save('demo', liveState())).not.toThrow();
    expect(load('demo')).toBeNull();
  });

  it('degrades when reading throws', () => {
    install(fakeStorage({ throwOnGet: true }));
    expect(load('demo')).toBeNull();
  });

  it('survives a quota error on save without losing the in-memory session', () => {
    const storage = fakeStorage({ throwOnSet: true });
    install(storage);
    const state = liveState();
    save('demo', state);
    expect(state.session).not.toBeNull();
  });
});

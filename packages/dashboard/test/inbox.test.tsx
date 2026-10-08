import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../src/components/Shell';
import { AttributesEditor, NotesPanel } from '../src/components/inbox';
import { NotificationSettings } from '../src/components/LiveChat';
import { Conversations } from '../src/pages/Conversations';
import type { ConversationRow, Note } from '../src/lib/api';
import { button, byText, click, fakeApi, flush, me, mount, select, type, unmount } from './helpers';

/**
 * The dashboard's inbox as the team uses it: what a member sees, the
 * conversation filters that survive a reload, the waiting indicator, custom
 * attributes, notes, and each person's notification settings.
 */

/** The team's live socket: opened by the shell, never connected in tests. */
class NoSocket {
  static made = 0;
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  constructor() {
    NoSocket.made++;
  }
  send() {}
  close() {}
}

beforeEach(() => {
  NoSocket.made = 0;
  vi.stubGlobal('WebSocket', NoSocket);
});

const PREFS = { available: true, notifyNewChat: true, notifyNewMessage: true, soundNewChat: true, soundNewMessage: true, sound: 'chime', volume: 0.7, repeatUntilTaken: false };
const STATUS = { enabled: true, hub: true, available: 1, agents: [], telegram: { connected: false, linked: false }, live: 1, unassigned: 1, waiting: 1, mine: 0 };

const row = (id: string, extra: Partial<ConversationRow> = {}): ConversationRow => ({
  id,
  site: 'acme',
  startedAt: Date.now() - 600_000,
  lastAt: Date.now() - 60_000,
  pageUrl: 'https://acme.test/',
  country: 'AU',
  firstMessage: `Question ${id}`,
  messageCount: 3,
  summary: null,
  intent: null,
  leadName: null,
  leadEmail: null,
  leadPhone: null,
  leadStatus: null,
  callback: null,
  status: 'bot',
  labels: [],
  attributes: {},
  ...extra,
});

describe('the shell', () => {
  const base = { 'GET /callbacks?status=open': { items: [], counts: { open: 0, done: 0, dismissed: 0 } }, 'GET /prefs': PREFS, 'GET /live/status': STATUS, 'GET /version': {} };

  it('shows a member the inbox only, and their own Notifications in settings', async () => {
    fakeApi(base);
    const view = await mount(
      <Shell me={me('member')} route={{ page: 'settings' }} onLogout={() => {}}>
      <div />
    </Shell>,
    );
    const nav = [...view.querySelectorAll('nav[aria-label="Main"]')[0]!.querySelectorAll(':scope > a, :scope > div > button')].map((el) => el.textContent?.replace(/\d+/g, '').trim());
    expect(nav).toEqual(['Conversations', 'Contacts', 'Callbacks', 'Settings']);
    const sections = [...view.querySelectorAll('#settings-menu a')].map((a) => a.textContent);
    expect(sections).toEqual(['Notifications']);
    await unmount();
  });

  it('shows an admin everything, and the live chats waiting on the menu and the tab title', async () => {
    fakeApi(base);
    document.title = 'Acme · Dashboard';
    const view = await mount(
      <Shell me={me('owner')} route={{ page: 'settings' }} onLogout={() => {}}>
      <div />
    </Shell>,
    );
    await flush(5);
    const sections = [...view.querySelectorAll('#settings-menu a')].map((a) => a.textContent);
    expect(sections).toEqual(expect.arrayContaining(['Live chat', 'Labels', 'Notifications', 'Team & security']));
    expect(view.querySelector('[aria-label="1 live chats waiting"]')).toBeTruthy();
    expect(document.title).toBe('(1) Acme · Dashboard');
    // The live connection is opened once, for this tab.
    expect(NoSocket.made).toBe(1);
    // The Available switch.
    expect(view.querySelector('[role="switch"][aria-label="Available for live chats"]')?.getAttribute('aria-checked')).toBe('true');
    await unmount();
  });

  it('opens no live connection while live chat is off', async () => {
    fakeApi(base);
    await mount(
      <Shell me={me('owner', false)} route={{ page: 'home' }} onLogout={() => {}}>
      <div />
    </Shell>,
    );
    expect(NoSocket.made).toBe(0);
    await unmount();
  });
});

describe('the conversation list', () => {
  it('filters by who is answering and by label, remembers the choice across a reload, and marks who is waiting', async () => {
    const calls = fakeApi({
      'GET /labels': { labels: [{ id: 'l1', name: 'Urgent', color: '#ef4444', description: null, ai: true }], colors: [] },
      'GET /admins': { me: 'owner@acme.test', owner: 'owner@acme.test', admins: [] },
      'GET /conversations': ({ path }: { path: string }) =>
        path.includes('status=live')
          ? { items: [row('c2', { status: 'live', waitingSince: Date.now() - 120_000, labels: [{ id: 'l1', name: 'Urgent', color: '#ef4444' }] })], next: null }
          : { items: [row('c1'), row('c2', { status: 'live' })], next: null },
    });
    const lastList = () => calls.filter((c) => c.path.startsWith('/conversations?')).at(-1)?.path;
    const view = await mount(<Conversations me={me('owner')} />);
    expect(lastList()).toMatch(/^\/conversations\?filter=all&status=all/);
    await click(view.querySelector('[role="radio"][aria-checked="false"]:nth-of-type(3)'));
    await flush();
    expect(lastList()).toContain('status=live');
    expect(byText(view, /Waiting 2m/)).toBeTruthy();
    expect(byText(view, 'Urgent', 'span')).toBeTruthy();
    await select(view.querySelector('select[aria-label="Label"]'), 'Urgent');
    expect(lastList()).toContain('label=Urgent');
    expect(localStorage.getItem('hp-conversations-status')).toBe('live');
    await unmount();

    // A reload: the same filters, from localStorage.
    const again = await mount(<Conversations me={me('owner')} />);
    expect(again.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('Live agent');
    expect(lastList()).toContain('status=live');
    expect(lastList()).toContain('label=Urgent');
    await unmount();
  });

  it('ignores a stored filter it does not know', async () => {
    localStorage.setItem('hp-conversations-status', 'everything');
    fakeApi({ 'GET /labels': { labels: [], colors: [] }, 'GET /admins': { me: '', owner: '', admins: [] }, 'GET /conversations': { items: [], next: null } });
    const view = await mount(<Conversations me={me('owner')} />);
    expect(view.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe('All');
    await unmount();
  });
});

describe('attributes and notes', () => {
  it('adds, changes and removes attributes, one change at a time', async () => {
    const saved: Record<string, string | null>[] = [];
    const view = await mount(<AttributesEditor value={{ plan: 'pro' }} onSave={async (patch) => void saved.push(patch)} />);
    await click(byText(view, 'Add attribute', 'button'));
    await type(view.querySelector('input[aria-label="Attribute key"]'), 'order_id');
    await type(view.querySelector('input[aria-label="Attribute value"]'), 'A-1042');
    await click(button(view, 'Add'));
    await click(button(view, 'Remove plan'));
    expect(saved).toEqual([{ order_id: 'A-1042' }, { plan: null }]);
    await unmount();
  });

  it('shows why an attribute was refused', async () => {
    const view = await mount(
      <AttributesEditor
        value={{}}
        onSave={async () => {
          throw new Error('Check attribute "bad/key": up to 64 letters, digits, spaces, _ - or .');
        }}
      />,
    );
    await click(byText(view, 'Add attribute', 'button'));
    await type(view.querySelector('input[aria-label="Attribute key"]'), 'bad/key');
    await click(button(view, 'Add'));
    expect(view.querySelector('[role="alert"]')?.textContent).toContain('bad/key');
    await unmount();
  });

  it('lets people edit only their own notes, and admins delete any', async () => {
    const notes: Note[] = [
      { id: 'n1', author: 'mo@acme.test', authorName: 'Mo', text: 'Mine', createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'n2', author: 'sam@acme.test', authorName: 'Sam', text: 'Theirs', createdAt: Date.now(), updatedAt: Date.now() },
    ];
    const calls = fakeApi({ 'POST /conversations/c1/notes': { id: 'n3' } });
    const member = await mount(<NotesPanel notes={notes} me="mo@acme.test" isAdmin={false} addPath="/conversations/c1/notes" onChange={() => {}} />);
    expect(member.querySelectorAll('[aria-label="Edit note"]')).toHaveLength(1);
    expect(member.querySelectorAll('[aria-label="Delete note"]')).toHaveLength(1);
    await type(member.querySelector('textarea[aria-label="New note"]'), 'Called back');
    await click(byText(member, 'Add note', 'button'));
    expect(calls).toContainEqual({ method: 'POST', path: '/conversations/c1/notes', body: { text: 'Called back' } });
    await unmount();
    const admin = await mount(<NotesPanel notes={notes} me="owner@acme.test" isAdmin addPath="/x" onChange={() => {}} />);
    expect(admin.querySelectorAll('[aria-label="Edit note"]')).toHaveLength(0);
    expect(admin.querySelectorAll('[aria-label="Delete note"]')).toHaveLength(2);
    await unmount();
  });
});

describe('notification settings', () => {
  it('explains how to allow notifications when the browser blocked them, and saves each choice', async () => {
    vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'denied', requestPermission: async () => 'denied' }));
    const calls = fakeApi({ 'GET /prefs': PREFS, 'PUT /prefs': ({ body }: { body: unknown }) => ({ ...PREFS, ...(body as object) }) });
    const view = await mount(<NotificationSettings />);
    expect(byText(view, /Notifications are blocked for this site/)).toBeTruthy();
    const repeat = byText(view, 'Repeat it every 15 seconds until someone takes the chat', 'span')!.closest('label')!.querySelector('input')!;
    await click(repeat);
    expect(calls).toContainEqual({ method: 'PUT', path: '/prefs', body: { repeatUntilTaken: true } });
    await select(view.querySelector('select'), 'bell');
    expect(calls).toContainEqual({ method: 'PUT', path: '/prefs', body: { sound: 'bell' } });
    await unmount();
  });

  it('offers to allow notifications when the browser has not been asked', async () => {
    const ask = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'default', requestPermission: ask }));
    fakeApi({ 'GET /prefs': PREFS });
    const view = await mount(<NotificationSettings />);
    await click(byText(view, 'Allow notifications', 'button'));
    expect(ask).toHaveBeenCalled();
    expect(byText(view, 'Test notification', 'button')).toBeTruthy();
    await unmount();
  });
});

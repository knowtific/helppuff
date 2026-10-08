import type { Message } from '@helppuff/protocol';

/**
 * The live hub: one per site, holding the open live-chat sockets — visitors
 * waiting for or talking to a person, and the team's dashboards — and
 * passing events between them. It never writes the conversation: the Worker
 * records every message in D1 first (the same pipeline as the assistant's),
 * then publishes it here. The hub only fans out, and keeps the timers: a
 * chat nobody takes in `waitSeconds`, and a live chat quiet for
 * `closeAfterMinutes`.
 *
 * Pure logic over injected sockets, storage and clock (like the crawl's
 * `StepLike`), so it is tested without the Workers runtime. The Durable
 * Object (`live/object.ts`) is a thin shell around it that follows the
 * Hibernation API's rules: sockets accepted with `acceptWebSocket`, state in
 * socket attachments and storage, never only in memory, and alarms rather
 * than timers.
 */

/** A socket, as the Hibernation API exposes it. */
export type HubSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

export type HubStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
};

export type HubDeps = {
  /** Open sockets, all or by tag (`agent`, `v:<conversationId>`). */
  sockets(tag?: string): HubSocket[];
  storage: HubStorage;
  now(): number;
};

/** Who a socket is, kept in its attachment so it survives hibernation. */
export type Attachment =
  | { kind: 'visitor'; conversationId: string; ip: string }
  | { kind: 'agent'; email: string; name: string | null; available: boolean };

export const AGENT_TAG = 'agent';
export const visitorTag = (conversationId: string) => `v:${conversationId}`;

/** A live chat the hub keeps time for. */
export type Tracked = {
  conversationId: string;
  /** When the visitor's wait for a person ends (then: the callback form); null once someone took it or it was offered. */
  deadline: number | null;
  lastAt: number;
  assignedTo: string | null;
};

export type HubSettings = { waitSeconds: number; closeAfterMinutes: number };
const DEFAULT_SETTINGS: HubSettings = { waitSeconds: 120, closeAfterMinutes: 60 };

/** What the Worker publishes. Every message in one was recorded in D1 first. */
export type HubEvent =
  | { type: 'handover'; siteId: string; conversationId: string; conversation: Record<string, unknown>; settings: HubSettings; messages?: Message[] }
  /** The visitor wrote (recorded): to the team. */
  | { type: 'visitor'; conversationId: string; message: Message }
  /** The team wrote (recorded): to the visitor and the team. */
  | { type: 'agent'; conversationId: string; message: Message; by: string }
  | { type: 'assigned'; conversationId: string; to: string | null; name: string | null; messages?: Message[] }
  /** Back to the assistant, or closed: the visitor's socket is told and closed. */
  | { type: 'ended'; conversationId: string; status: 'left' | 'closed'; messages?: Message[] }
  /** Anything else about a conversation the dashboards should reload (labels, attributes, notes). */
  | { type: 'changed'; conversationId: string };

/** What the alarm found: chats nobody took in time, and live chats gone quiet. The shell records them and publishes the result. */
export type Due = { missed: string[]; stale: string[] };

const LIVE_PREFIX = 'live:';

function send(socket: HubSocket, frame: unknown): void {
  try {
    socket.send(JSON.stringify(frame));
  } catch {
    // A socket closing as we send: it is gone either way.
  }
}

function attachment(socket: HubSocket): Attachment | null {
  try {
    return (socket.deserializeAttachment() as Attachment | null) ?? null;
  } catch {
    return null;
  }
}

export class HubCore {
  constructor(private readonly deps: HubDeps) {}

  // --------------------------------------------------------------- sockets

  /** Tags and attachment for a socket the shell is about to accept. */
  static visitor(conversationId: string, ip: string): { tags: string[]; attachment: Attachment } {
    return { tags: [visitorTag(conversationId)], attachment: { kind: 'visitor', conversationId, ip } };
  }

  static agent(email: string, name: string | null, available: boolean): { tags: string[]; attachment: Attachment } {
    return { tags: [AGENT_TAG], attachment: { kind: 'agent', email, name, available } };
  }

  /** Visitor sockets open from one IP (the `liveSocketsPerIp` limit). */
  visitorSocketsFrom(ip: string): number {
    return this.deps.sockets().filter((s) => {
      const a = attachment(s);
      return a?.kind === 'visitor' && a.ip === ip;
    }).length;
  }

  /** The team members who can take a chat now: a dashboard open and set to available. */
  presence(): { available: number; agents: { email: string; name: string | null; available: boolean }[] } {
    const agents = new Map<string, { email: string; name: string | null; available: boolean }>();
    for (const socket of this.deps.sockets(AGENT_TAG)) {
      const a = attachment(socket);
      if (a?.kind !== 'agent') continue;
      const seen = agents.get(a.email);
      // One person, several tabs: available if any tab says so.
      agents.set(a.email, { email: a.email, name: a.name, available: Boolean(seen?.available || a.available) });
    }
    const list = [...agents.values()];
    return { available: list.filter((a) => a.available).length, agents: list };
  }

  /** A frame from a socket: typing, or an agent's availability. Anything else is ignored. */
  onMessage(socket: HubSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const a = attachment(socket);
    if (!a || !frame || typeof frame !== 'object') return;
    if (a.kind === 'visitor') {
      if (frame['t'] === 'typing') this.toAgents({ t: 'typing', conversationId: a.conversationId, on: Boolean(frame['on']) });
      return;
    }
    if (frame['t'] === 'available') {
      socket.serializeAttachment({ ...a, available: Boolean(frame['on']) });
      this.toAgents({ t: 'presence', ...this.presence() });
      return;
    }
    if (frame['t'] === 'typing' && typeof frame['conversationId'] === 'string') {
      for (const visitor of this.deps.sockets(visitorTag(frame['conversationId']))) send(visitor, { t: 'typing', on: Boolean(frame['on']) });
    }
  }

  /** An agent connected or left: everyone's presence changes. */
  presenceChanged(): void {
    this.toAgents({ t: 'presence', ...this.presence() });
  }

  private toAgents(frame: unknown): void {
    for (const socket of this.deps.sockets(AGENT_TAG)) send(socket, frame);
  }

  private toVisitor(conversationId: string, frame: unknown): void {
    for (const socket of this.deps.sockets(visitorTag(conversationId))) send(socket, frame);
  }

  // ---------------------------------------------------------------- events

  async publish(event: HubEvent): Promise<void> {
    const now = this.deps.now();
    const key = `${LIVE_PREFIX}${event.conversationId}`;
    switch (event.type) {
      case 'handover': {
        await this.deps.storage.put('settings', event.settings);
        await this.deps.storage.put('site', event.siteId);
        await this.deps.storage.put(key, {
          conversationId: event.conversationId,
          deadline: now + event.settings.waitSeconds * 1000,
          lastAt: now,
          assignedTo: null,
        } satisfies Tracked);
        this.toAgents({ t: 'handover', conversationId: event.conversationId, conversation: event.conversation });
        for (const message of event.messages ?? []) this.toVisitor(event.conversationId, { t: 'msg', message });
        break;
      }
      case 'visitor': {
        await this.touch(key, now, {});
        this.toAgents({ t: 'message', conversationId: event.conversationId, message: event.message });
        break;
      }
      case 'agent': {
        // A reply ends the wait: the chat is taken.
        await this.touch(key, now, { deadline: null });
        this.toVisitor(event.conversationId, { t: 'msg', message: event.message });
        this.toAgents({ t: 'message', conversationId: event.conversationId, message: event.message, by: event.by });
        break;
      }
      case 'assigned': {
        await this.touch(key, now, { deadline: null, assignedTo: event.to });
        if (event.to) this.toVisitor(event.conversationId, { t: 'status', status: 'joined', ...(event.name ? { agentName: event.name } : {}) });
        for (const message of event.messages ?? []) this.toVisitor(event.conversationId, { t: 'msg', message });
        this.toAgents({ t: 'assigned', conversationId: event.conversationId, to: event.to, name: event.name });
        break;
      }
      case 'ended': {
        await this.deps.storage.delete(key);
        for (const message of event.messages ?? []) this.toVisitor(event.conversationId, { t: 'msg', message });
        this.toVisitor(event.conversationId, { t: 'status', status: event.status });
        for (const socket of this.deps.sockets(visitorTag(event.conversationId))) {
          try {
            socket.close(1000, event.status);
          } catch {
            // Already closing.
          }
        }
        this.toAgents({ t: 'ended', conversationId: event.conversationId, status: event.status });
        break;
      }
      case 'changed':
        this.toAgents({ t: 'changed', conversationId: event.conversationId });
        return;
    }
    await this.schedule();
  }

  private async touch(key: string, now: number, patch: Partial<Tracked>): Promise<void> {
    const tracked = await this.deps.storage.get<Tracked>(key);
    if (tracked) await this.deps.storage.put(key, { ...tracked, ...patch, lastAt: now });
  }

  /** Point the alarm at the next deadline or close, or clear it. */
  async schedule(): Promise<void> {
    const settings = (await this.deps.storage.get<HubSettings>('settings')) ?? DEFAULT_SETTINGS;
    const tracked = [...(await this.deps.storage.list<Tracked>({ prefix: LIVE_PREFIX })).values()];
    const times = tracked.flatMap((t) => [t.deadline ?? Infinity, t.lastAt + settings.closeAfterMinutes * 60_000]);
    const next = Math.min(...times);
    if (Number.isFinite(next)) await this.deps.storage.setAlarm(Math.max(next, this.deps.now() + 1000));
    else await this.deps.storage.deleteAlarm();
  }

  /**
   * The alarm: which waits ran out and which chats went quiet. A missed wait
   * is offered once (the deadline is cleared); a quiet chat stops being
   * tracked. The shell records both and publishes what the visitor sees.
   */
  async due(): Promise<Due> {
    const now = this.deps.now();
    const settings = (await this.deps.storage.get<HubSettings>('settings')) ?? DEFAULT_SETTINGS;
    const due: Due = { missed: [], stale: [] };
    for (const [key, tracked] of await this.deps.storage.list<Tracked>({ prefix: LIVE_PREFIX })) {
      if (tracked.lastAt + settings.closeAfterMinutes * 60_000 <= now) {
        due.stale.push(tracked.conversationId);
        await this.deps.storage.delete(key);
      } else if (tracked.deadline !== null && tracked.deadline <= now) {
        due.missed.push(tracked.conversationId);
        await this.deps.storage.put(key, { ...tracked, deadline: null });
      }
    }
    return due;
  }

  /** Tell a visitor their wait ran out (the messages were recorded by the shell). */
  missed(conversationId: string, messages: Message[]): void {
    for (const message of messages) this.toVisitor(conversationId, { t: 'msg', message });
    this.toVisitor(conversationId, { t: 'status', status: 'missed' });
    this.toAgents({ t: 'missed', conversationId });
  }
}

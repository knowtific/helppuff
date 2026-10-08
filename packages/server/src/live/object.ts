import { DurableObject } from 'cloudflare:workers';
import { LIVE_PING, LIVE_SUBPROTOCOL } from '@helppuff/protocol';
import { dbFrom } from '../db/d1.js';
import { HubCore, type HubEvent, type HubSocket } from './hub.js';
import { runDue, type LiveDeps } from './service.js';

/**
 * The live hub's Durable Object: one per site (`idFromName(siteId)`), SQLite
 * storage (the Workers Free plan's kind). A thin shell around `HubCore`
 * following the Hibernation API, so idle sockets cost nothing:
 * `ctx.acceptWebSocket` (never `ws.accept()`), who each socket is in its
 * attachment, keep-alive pings answered by `setWebSocketAutoResponse`
 * without waking the object, and alarms instead of timers.
 *
 * Reached only through the Worker (`routes/live.ts`, `admin/live.ts`), which
 * authenticates every socket first and passes who it is in headers; the
 * object has no route of its own on the internet.
 */

type Env = Record<string, unknown>;

export class LiveHub extends DurableObject<Env> {
  private readonly core: HubCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVE_PING, 'pong'));
    const storage = this.ctx.storage;
    this.core = new HubCore({
      sockets: (tag) => this.ctx.getWebSockets(tag) as unknown as HubSocket[],
      storage: {
        get: (key) => storage.get(key),
        put: (key, value) => storage.put(key, value),
        delete: (key) => storage.delete(key),
        list: (options) => storage.list(options),
        setAlarm: (at) => storage.setAlarm(at),
        deleteAlarm: () => storage.deleteAlarm(),
      },
      now: () => Date.now(),
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/socket') return this.accept(request);
    if (url.pathname === '/presence') return Response.json(this.core.presence());
    if (url.pathname === '/publish' && request.method === 'POST') {
      await this.core.publish((await request.json()) as HubEvent);
      return new Response(null, { status: 204 });
    }
    return new Response('Not found', { status: 404 });
  }

  /** A socket the Worker has already authenticated: who it is comes in `X-Live-*` headers. */
  private accept(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const kind = request.headers.get('X-Live-Kind');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    let who: ReturnType<typeof HubCore.visitor>;
    if (kind === 'visitor') {
      const conversationId = request.headers.get('X-Live-Conversation') ?? '';
      const ip = request.headers.get('X-Live-Ip') ?? '';
      const limit = Number(request.headers.get('X-Live-Limit') ?? 3) || 3;
      if (!conversationId) return new Response('No conversation', { status: 400 });
      if (this.core.visitorSocketsFrom(ip) >= limit) return new Response('Too many connections', { status: 429 });
      who = HubCore.visitor(conversationId, ip);
    } else if (kind === 'agent') {
      const email = request.headers.get('X-Live-Email') ?? '';
      if (!email) return new Response('No agent', { status: 400 });
      who = HubCore.agent(email, request.headers.get('X-Live-Name') || null, request.headers.get('X-Live-Available') !== '0');
    } else {
      return new Response('Unknown socket', { status: 400 });
    }
    this.ctx.acceptWebSocket(server, who.tags);
    server.serializeAttachment(who.attachment);
    if (kind === 'agent') this.core.presenceChanged();
    // The browser refuses the connection unless the server picks one of the subprotocols it offered.
    const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim());
    const headers = offered.includes(LIVE_SUBPROTOCOL) ? { 'Sec-WebSocket-Protocol': LIVE_SUBPROTOCOL } : undefined;
    return new Response(null, { status: 101, webSocket: client, ...(headers ? { headers } : {}) });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.core.onMessage(ws as unknown as HubSocket, message);
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Before the compatibility date that closes automatically, the server completes the close.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
    const attachment = (() => {
      try {
        return ws.deserializeAttachment() as { kind?: string } | null;
      } catch {
        return null;
      }
    })();
    if (attachment?.kind === 'agent') this.core.presenceChanged();
  }

  override webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws, 1011, 'error');
  }

  /** Waits that ran out get the callback form; quiet live chats are closed (`runDue`). */
  override async alarm(): Promise<void> {
    const db = dbFrom(this.env);
    const deps: LiveDeps | null = db
      ? {
          db,
          env: this.env,
          secret: typeof this.env['HELPPUFF_SECRET'] === 'string' ? this.env['HELPPUFF_SECRET'] : '',
          now: () => Date.now(),
          fetch: globalThis.fetch.bind(globalThis),
          waitUntil: (p) => this.ctx.waitUntil(p.catch(() => {})),
          log: () => {},
        }
      : null;
    await runDue(this.core, deps, await this.ctx.storage.get<string>('site'));
  }
}

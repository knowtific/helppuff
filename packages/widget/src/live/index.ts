import type { HandoverStatus, Message } from '@helppuff/protocol';

/**
 * Live chat's client: its own small chunk (`live-*.js`), loaded while a chat
 * is open on a site with live chat, so a person can take it over at any time.
 * Sites without live chat never download it.
 *
 * It receives what the team sends — over a WebSocket to the site's hub, with
 * the session token as a subprotocol, never in the URL — and falls back to
 * polling `GET /v1/sessions/messages?after=` when sockets cannot connect (a
 * strict host page, a proxy). The visitor's own messages still go over HTTP,
 * through the same limits as every other message.
 *
 * Fail-safe like the rest of the widget: nothing here throws into the host
 * page; every failure ends in "poll", then "stop".
 */

const PROTOCOL = 'helppuff.v1';

export type LiveHooks = {
  /** A message from the team (already recorded by the server), parsed by the app's validator. */
  onMessage: (message: Message) => void;
  onStatus: (status: HandoverStatus, agentName?: string) => void;
  onTyping: (on: boolean) => void;
  /** The app's hand-rolled validator: anything it rejects is dropped. */
  parse: (input: unknown) => Message | null;
};

export type LiveOptions = {
  apiBase: string;
  /** The current session token (it is refreshed by every send). */
  token: () => string | null;
  /** The newest message's time: what a reconnect or a poll asks for after. */
  lastTs: () => number;
  /**
   * Whether a person has the chat now. The socket stays open either way (the
   * team can take a chat over at any time; idle, it costs nothing), but the
   * polling fallback runs only while this is true.
   */
  active?: () => boolean;
  hooks: LiveHooks;
  /** For tests. */
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
};

export type LiveConnection = { close: () => void; typing: (on: boolean) => void };

export function connectLive(options: LiveOptions): LiveConnection {
  const Socket = options.WebSocket ?? (typeof WebSocket === 'undefined' ? undefined : WebSocket);
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const { hooks } = options;
  let ws: WebSocket | null = null;
  let stopped = false;
  let opened = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let polling: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    stopped = true;
    clearTimeout(retry);
    clearTimeout(polling);
    clearInterval(ping);
    document.removeEventListener('visibilitychange', onVisible);
    try {
      ws?.close(1000);
    } catch {
      // Already closed.
    }
    ws = null;
  };

  const deliver = (raw: unknown) => {
    const message = hooks.parse(raw);
    if (message) hooks.onMessage(message);
  };

  /** Messages missed while not connected (or the whole channel, when polling). */
  const catchUp = async (): Promise<boolean> => {
    const token = options.token();
    if (!token) return false;
    try {
      const response = await doFetch(`${options.apiBase}/v1/sessions/messages?after=${options.lastTs()}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'omit',
        mode: 'cors',
      });
      // Refused (not live, an expired token): nothing to wait for. Busy or down: try again later.
      if (!response.ok) return response.status === 429 || response.status >= 500;
      const body = (await response.json()) as { messages?: unknown[] };
      for (const raw of body.messages ?? []) {
        deliver(raw);
        const status = (raw as { type?: string; status?: HandoverStatus }).type === 'handover' ? (raw as { status: HandoverStatus }).status : null;
        if (status) hooks.onStatus(status);
      }
      return true;
    } catch {
      return true;
    }
  };

  const active = options.active ?? (() => true);
  const poll = () => {
    if (stopped) return;
    // With the assistant: no requests, just look again later (a takeover then needs the visitor's next message).
    if (!active()) {
      polling = setTimeout(poll, 15_000);
      return;
    }
    void catchUp().then((go) => {
      if (!go) return stop();
      // Quicker while the visitor is looking.
      polling = setTimeout(poll, document.hidden ? 15_000 : 4000);
    });
  };

  const connect = () => {
    if (stopped) return;
    const token = options.token();
    if (!Socket || !token) return poll();
    let socket: WebSocket;
    try {
      socket = new Socket(`${options.apiBase.replace(/^http/, 'ws')}/v1/live/socket`, [PROTOCOL, `t.${token}`]);
    } catch {
      return poll();
    }
    ws = socket;
    socket.onopen = () => {
      opened = true;
      failures = 0;
      clearInterval(ping);
      // Answered by the hub without waking it.
      ping = setInterval(() => socket.readyState === 1 && socket.send('ping'), 30_000);
      void catchUp();
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data === 'pong') return;
      let frame: { t?: string; message?: unknown; status?: HandoverStatus; agentName?: string; on?: boolean };
      try {
        frame = JSON.parse(event.data) as typeof frame;
      } catch {
        return;
      }
      if (frame.t === 'msg') deliver(frame.message);
      else if (frame.t === 'typing') hooks.onTyping(Boolean(frame.on));
      else if (frame.t === 'status' && frame.status) hooks.onStatus(frame.status, frame.agentName);
    };
    socket.onclose = () => {
      clearInterval(ping);
      if (ws === socket) ws = null;
      if (stopped) return;
      failures++;
      // Never connected after a few tries: sockets are blocked here, so poll instead.
      if (!opened && failures >= 3) return poll();
      const delay = Math.min(30_000, 1000 * 2 ** failures) * (0.7 + Math.random() * 0.6);
      retry = setTimeout(connect, delay);
    };
  };

  // Phones drop sockets in the background: reconnect when the page is back.
  const onVisible = () => {
    if (!document.hidden && !ws && !stopped && !polling) {
      clearTimeout(retry);
      connect();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  connect();

  return {
    close: stop,
    typing: (on) => {
      try {
        if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'typing', on }));
      } catch {
        // Typing is a nicety.
      }
    },
  };
}

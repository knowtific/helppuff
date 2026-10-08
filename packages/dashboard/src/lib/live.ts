import { useEffect, useRef, useState } from 'react';
import { api, type Prefs } from './api';

/**
 * The team's live connection: one WebSocket per dashboard tab, to the site's
 * hub. It tells every open page what changed (a new chat waiting, a message,
 * who took what) and, per each person's settings, shows a browser
 * notification and plays a sound. Reconnects with backoff, and again when the
 * tab comes back into view.
 */

export type LiveEvent =
  | { t: 'handover'; conversationId: string; conversation: { leadName?: string | null; leadEmail?: string | null; firstMessage?: string | null; pageUrl?: string | null } }
  | { t: 'message'; conversationId: string; message: { role: string; text?: string }; by?: string }
  | { t: 'assigned'; conversationId: string; to: string | null; name: string | null }
  | { t: 'ended'; conversationId: string; status: 'left' | 'closed' }
  | { t: 'missed'; conversationId: string }
  | { t: 'changed'; conversationId: string }
  | { t: 'typing'; conversationId: string; on: boolean }
  | { t: 'presence'; available: number; agents: { email: string; name: string | null; available: boolean }[] };

const listeners = new Set<(event: LiveEvent) => void>();

/** Subscribe to live events; returns the unsubscribe. */
export function onLive(listener: (event: LiveEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Run `handler` on every live event while mounted. */
export function useLiveEvents(handler: (event: LiveEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onLive((event) => ref.current(event)), []);
}

let socket: WebSocket | null = null;

/** Tell the hub whether this person takes chats now (saved as their setting too). */
export async function setAvailable(on: boolean): Promise<Prefs> {
  try {
    socket?.send(JSON.stringify({ t: 'available', on }));
  } catch {
    // Reconnects with the saved setting.
  }
  return api<Prefs>('/prefs', { method: 'PUT', json: { available: on } });
}

export function sendTyping(conversationId: string, on: boolean): void {
  try {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'typing', conversationId, on }));
  } catch {
    // Typing is a nicety.
  }
}

// ------------------------------------------------------------------- sound

let audio: AudioContext | null = null;

/** Browsers start audio only after a click: the first one on the page unlocks it. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    // No Web Audio: no sound.
  }
}

const TONES: Record<Prefs['sound'], number[]> = { chime: [880, 1318.5], bell: [659.3, 987.8, 1318.5], pop: [520] };

/** A short synthesised sound: no audio files, nothing for the page's CSP to allow. */
export function playSound(kind: Prefs['sound'], volume: number): void {
  try {
    unlockAudio();
    if (!audio || volume <= 0) return;
    const start = audio.currentTime + 0.01;
    TONES[kind].forEach((frequency, index) => {
      const at = start + index * 0.13;
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = kind === 'pop' ? 'triangle' : 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.25 * volume), at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + (kind === 'pop' ? 0.12 : 0.45));
      osc.connect(gain).connect(audio!.destination);
      osc.start(at);
      osc.stop(at + 0.5);
    });
  } catch {
    // Sound is a nicety.
  }
}

// ---------------------------------------------------------- notifications

export function notificationState(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Ask for permission (from a click: browsers ignore it otherwise). */
export async function askNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

function notify(title: string, body: string, conversationId: string): void {
  if (notificationState() !== 'granted') return;
  try {
    const n = new Notification(title, { body: body.slice(0, 160), tag: `hp-${conversationId}` });
    n.onclick = () => {
      window.focus();
      window.location.hash = `#/conversations/${conversationId}`;
      n.close();
    };
  } catch {
    // Some browsers allow notifications only from a service worker.
  }
}

export function testNotification(): void {
  if (notificationState() !== 'granted') return;
  try {
    new Notification('HelpPuff', { body: 'Notifications work. New live chats will show like this.' });
  } catch {
    // Not available here.
  }
}

// ----------------------------------------------------------------- the hook

/**
 * Keep this tab connected while live chat is on, and alert per `prefs`.
 * Returns whether the socket is connected.
 */
export function useLiveConnection(enabled: boolean, prefs: Prefs | null, me: string): boolean {
  const [connected, setConnected] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    // Chats waiting for someone to take them, and the sound repeating for each (when that is on).
    const waiting = new Map<string, ReturnType<typeof setInterval>>();
    const stopRepeat = (id: string) => {
      clearInterval(waiting.get(id));
      waiting.delete(id);
    };

    const alert = (event: LiveEvent) => {
      const p = prefsRef.current;
      if (!p) return;
      if (event.t === 'handover') {
        const who = event.conversation.leadName ?? event.conversation.leadEmail ?? 'A visitor';
        if (p.notifyNewChat) notify(`${who} wants to talk to someone`, event.conversation.firstMessage ?? 'A new live chat is waiting.', event.conversationId);
        if (p.soundNewChat) {
          playSound(p.sound, p.volume);
          if (p.repeatUntilTaken) {
            let times = 0;
            waiting.set(
              event.conversationId,
              setInterval(() => {
                if (++times > 10) return stopRepeat(event.conversationId);
                playSound(p.sound, p.volume);
              }, 15_000),
            );
          }
        }
      } else if (event.t === 'message' && event.message.role === 'user') {
        if (p.notifyNewMessage && document.hidden) notify('New message', event.message.text ?? '', event.conversationId);
        if (p.soundNewMessage) playSound(p.sound, p.volume * 0.7);
      } else if (event.t === 'assigned' || event.t === 'ended') {
        stopRepeat(event.conversationId);
      }
    };

    const connect = () => {
      if (stopped) return;
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/admin/api/live/socket`;
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        clearInterval(ping);
        // Answered by the hub without waking it (keeps proxies from closing an idle socket).
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 30_000);
      };
      ws.onmessage = (message) => {
        if (typeof message.data !== 'string' || message.data === 'pong') return;
        let event: LiveEvent;
        try {
          event = JSON.parse(message.data) as LiveEvent;
        } catch {
          return;
        }
        if (event.t === 'message' && event.by === me) return void listeners.forEach((l) => l(event));
        alert(event);
        listeners.forEach((listener) => listener(event));
      };
      ws.onclose = () => {
        setConnected(false);
        clearInterval(ping);
        if (socket === ws) socket = null;
        if (stopped) return;
        // Backoff with jitter: 1s, 2s, 4s … up to 30s.
        const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.7 + Math.random() * 0.6);
        retry = setTimeout(connect, delay);
      };
    };

    const onVisible = () => {
      if (!document.hidden && !socket) {
        clearTimeout(retry);
        attempt = 0;
        connect();
      }
    };
    const onFirstClick = () => unlockAudio();
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('pointerdown', onFirstClick, { once: true });
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      waiting.forEach((timer) => clearInterval(timer));
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('pointerdown', onFirstClick);
      socket?.close();
      socket = null;
    };
  }, [enabled, me]);

  return connected;
}

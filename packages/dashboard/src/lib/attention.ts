/**
 * Getting a person's attention back to the dashboard, the way support tools
 * do it (Intercom, Crisp, Zendesk, Front): a count in the tab's title, the
 * title alternating with what happened while they are away, and a badge on
 * the tab's icon, so it shows even in a crowded tab bar. Everything clears
 * the moment they look again.
 *
 * Which events concern a person is `concerns()`: the live connection
 * (`lib/live.ts`) asks it before a notification, a sound or a toast.
 */

let base = typeof document === 'undefined' ? '' : document.title.replace(/^\(\d+\) /, '');
let waiting = 0;
let unread = 0;
let flash: string | null = null;
let flashOn = false;
let timer: ReturnType<typeof setInterval> | null = null;
let accent = '#5B5BF7';
let icon: HTMLLinkElement | null = null;

/** Whether the person is looking at the dashboard right now. */
export const looking = () => typeof document !== 'undefined' && !document.hidden && document.hasFocus();

/** Whether they are looking at this conversation (then nothing needs to tell them). */
export const watching = (conversationId: string) => looking() && window.location.hash === `#/conversations/${conversationId}`;

function render(): void {
  const count = waiting + unread;
  const title = `${count > 0 ? `(${count}) ` : ''}${base}`;
  document.title = flash && flashOn ? `💬 ${flash}` : title;
  drawIcon(count);
}

/** The page's own title (the shell sets it per site), without the count. */
export function setBaseTitle(title: string): void {
  base = title.replace(/^\(\d+\) /, '');
  render();
}

/** Live chats waiting for the team: always in the count, looking or not. */
export function setWaiting(count: number): void {
  waiting = count;
  render();
}

export function setAccent(color: string): void {
  if (/^#[0-9a-f]{3,8}$/i.test(color)) accent = color;
  render();
}

/** Something happened while they were away: count it and flash it in the title until they look. */
export function nudge(text: string): void {
  if (looking()) return;
  unread++;
  flash = text.replace(/\s+/g, ' ').slice(0, 60);
  if (!timer) {
    timer = setInterval(() => {
      flashOn = !flashOn;
      render();
    }, 1200);
  }
  render();
}

function clear(): void {
  if (!looking()) return;
  unread = 0;
  flash = null;
  flashOn = false;
  if (timer) clearInterval(timer);
  timer = null;
  render();
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', clear);
  document.addEventListener('visibilitychange', clear);
}

/** The tab's icon: a dot in the site's colour, with a red count when something waits. Drawn, so no image files. */
function drawIcon(count: number): void {
  if (typeof document === 'undefined') return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(28, 36, 24, 0, Math.PI * 2);
    ctx.fill();
    if (count > 0) {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(46, 18, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(count > 9 ? '9+' : String(count), 46, 19);
    }
    icon ??= document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? Object.assign(document.head.appendChild(document.createElement('link')), { rel: 'icon' });
    icon.href = canvas.toDataURL('image/png');
  } catch {
    // No canvas (tests, very old browsers): the title still counts.
  }
}

// ------------------------------------------------------------------ concerns

export type Concern = { kind: 'new-chat' | 'message' | 'assigned' | 'job'; conversationId: string; title: string; body: string; link: string };

const SOURCES: Record<string, string> = { chat: 'from the chat', quote: 'from the quote questions', api: 'from the API', callback: 'from a callback' };

/**
 * What from the live connection concerns this person, and how to say it.
 * New chats waiting: everyone available. A visitor's message: in a chat that
 * is theirs, or nobody's yet. A chat given to them by someone else. Never
 * their own doing, never a colleague's chat, never the conversation they are
 * looking at. A new job from outside the team (the chat, the quote questions,
 * the API): everyone.
 */
export function concerns(
  event: { t: string; conversationId?: string; conversation?: Record<string, unknown>; message?: { role?: string; text?: string }; assignedTo?: string | null; who?: string | null; to?: string | null; by?: string | null; name?: string | null; jobId?: string; number?: number; title?: string; source?: string },
  me: string,
  available: boolean,
): Concern | null {
  if (event.t === 'job') {
    if (!event.jobId || !event.source || !SOURCES[event.source] || window.location.hash === `#/jobs/${event.jobId}`) return null;
    return { kind: 'job', conversationId: event.jobId, link: `#/jobs/${event.jobId}`, title: `New request #${event.number ?? ''} ${SOURCES[event.source]}`, body: [event.who, event.title].filter(Boolean).join(': ') };
  }
  const id = event.conversationId;
  if (!id || watching(id)) return null;
  if (event.t === 'handover') {
    if (!available) return null;
    const c = event.conversation ?? {};
    const who = String(c['leadName'] ?? c['leadEmail'] ?? 'A visitor');
    return { kind: 'new-chat', conversationId: id, link: `#/conversations/${id}`, title: `${who} wants to talk to someone`, body: String(c['firstMessage'] ?? 'A new live chat is waiting.') };
  }
  if (event.t === 'message' && event.message?.role === 'user') {
    const mine = event.assignedTo === me;
    if (!mine && !(event.assignedTo == null && available)) return null;
    return { kind: 'message', conversationId: id, link: `#/conversations/${id}`, title: event.who ? `${event.who}` : 'New message', body: event.message.text ?? '' };
  }
  if (event.t === 'assigned' && event.to === me && event.by && event.by !== me) {
    return { kind: 'assigned', conversationId: id, link: `#/conversations/${id}`, title: 'A chat was given to you', body: `${event.by.replace(/^telegram:/, 'Telegram ')} assigned you a live chat.` };
  }
  return null;
}

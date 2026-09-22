import type { ErrorCode, Message, WidgetConfig } from '@murmur/protocol';

/**
 * §8.5's diagram, encoded as three orthogonal fields rather than one enum.
 * `open` is panel visibility, `screen` is what the panel shows, and `status`
 * is the transient in-flight phase. Keeping them apart is what lets a visitor
 * close the panel mid-conversation and reopen it without losing the thread.
 *
 *   closed ──open──▶ home ──start──▶ lead_form ──submit──▶ starting ──ok──▶ chat
 *                     └────────────── start (form disabled / identified) ──┘
 *   chat ⇄ sending                                   session expired ──▶ ended
 */
export type Screen = 'home' | 'lead_form' | 'chat';
export type Status = 'idle' | 'starting' | 'sending' | 'ended';

export type Session = { token: string; id: string; expiresAt: number };

export type WidgetError = {
  code: ErrorCode | 'offline' | 'unknown';
  message: string;
  retryable: boolean;
  retryAfter?: number;
};

/** A user message shown before the server has acknowledged it (§8.5). */
export type Pending = {
  clientId: string;
  message: Message;
  /** Replayed verbatim on retry. */
  input: SendInput;
};

export type SendInput =
  | { kind: 'text'; text: string }
  | { kind: 'action'; actionId: string; value: string; label: string };

export type State = {
  open: boolean;
  screen: Screen;
  status: Status;
  config: WidgetConfig | null;
  session: Session | null;
  lead: Record<string, string> | null;
  messages: Message[];
  pending: Pending[];
  /** Option ids already tapped, so chips stay disabled across a reload. */
  consumedActions: string[];
  error: WidgetError | null;
  /** Kept out of the reducer's message list so a failed send never loses it. */
  draft: string;
  unread: number;
  teaserDismissed: boolean;
  sound: boolean;
};

export const initialState: State = {
  open: false,
  screen: 'home',
  status: 'idle',
  config: null,
  session: null,
  lead: null,
  messages: [],
  pending: [],
  consumedActions: [],
  error: null,
  draft: '',
  unread: 0,
  teaserDismissed: false,
  sound: false,
};

export type Action =
  | { type: 'config/loaded'; config: WidgetConfig }
  | { type: 'restore'; restored: Partial<State> }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'toggle' }
  | { type: 'screen'; screen: Screen }
  | { type: 'draft'; text: string }
  | { type: 'identify'; lead: Record<string, string> }
  | { type: 'teaser/dismiss' }
  | { type: 'sound/toggle' }
  | { type: 'start'; firstMessage?: string }
  | { type: 'lead/submit'; lead: Record<string, string>; firstMessage?: string }
  | { type: 'session/started'; session: Session; messages: Message[] }
  | { type: 'session/failed'; error: WidgetError }
  | { type: 'send'; pending: Pending }
  | { type: 'send/ok'; clientId: string; messages: Message[]; token?: string }
  | { type: 'send/failed'; clientId: string; error: WidgetError }
  | { type: 'action/consumed'; id: string }
  | { type: 'error/dismiss' }
  | { type: 'expired' }
  | { type: 'reset' };

/** Persisted transcripts are capped so localStorage never grows unbounded (§8.6). */
export const MAX_STORED_MESSAGES = 60;

function capMessages(messages: Message[]): Message[] {
  return messages.length > MAX_STORED_MESSAGES ? messages.slice(-MAX_STORED_MESSAGES) : messages;
}

/** Whether the lead form has everything it needs to be skipped (§8.7). */
export function leadIsComplete(config: WidgetConfig | null, lead: Record<string, string> | null): boolean {
  if (!config) return false;
  if (!config.leadForm.enabled) return true;
  if (!lead) return false;
  return config.leadForm.fields.every((field) => !field.required || Boolean(lead[field.name]?.trim()));
}

/** Where `start` should land: straight into the session, or via the form. */
function screenAfterStart(state: State): Screen {
  return leadIsComplete(state.config, state.lead) ? 'chat' : 'lead_form';
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'config/loaded':
      return { ...state, config: action.config, sound: action.config.sound?.enabled ?? state.sound };

    case 'restore': {
      const restored = action.restored;
      return {
        ...state,
        ...restored,
        // A restored session resumes in the thread, never on the home screen.
        screen: restored.session ? 'chat' : state.screen,
        status: 'idle',
        // Never restore a transient failure or an in-flight send.
        error: null,
        pending: [],
      };
    }

    case 'open':
      return { ...state, open: true, unread: 0, error: state.error?.retryable ? state.error : null };

    case 'close':
      return { ...state, open: false };

    case 'toggle':
      return reducer(state, { type: state.open ? 'close' : 'open' });

    case 'screen':
      return { ...state, screen: action.screen, error: null };

    case 'draft':
      return { ...state, draft: action.text };

    case 'identify': {
      const lead = { ...(state.lead ?? {}), ...action.lead };
      return { ...state, lead };
    }

    case 'teaser/dismiss':
      return { ...state, teaserDismissed: true };

    case 'sound/toggle':
      return { ...state, sound: !state.sound };

    case 'start': {
      // A live session means there is nothing to start — just show it.
      if (state.session) return { ...state, screen: 'chat', error: null };
      const screen = screenAfterStart(state);
      return {
        ...state,
        screen,
        // Only the direct path opens a session here; the form path waits for submit.
        status: screen === 'chat' ? 'starting' : 'idle',
        error: null,
      };
    }

    case 'lead/submit':
      return { ...state, lead: action.lead, screen: 'chat', status: 'starting', error: null };

    case 'session/started':
      return {
        ...state,
        session: action.session,
        screen: 'chat',
        status: 'idle',
        messages: capMessages([...state.messages, ...action.messages]),
        error: null,
        unread: state.open ? 0 : state.unread + action.messages.length,
      };

    case 'session/failed':
      // Stay on the screen the visitor is on; the error renders inline (§8.3).
      return { ...state, status: 'idle', error: action.error };

    case 'send':
      return {
        ...state,
        status: 'sending',
        screen: 'chat',
        pending: [...state.pending, action.pending],
        draft: '',
        error: null,
      };

    case 'send/ok': {
      const pending = state.pending.filter((p) => p.clientId !== action.clientId);
      const sent = state.pending.find((p) => p.clientId === action.clientId);
      const messages = capMessages([
        ...state.messages,
        ...(sent ? [sent.message] : []),
        ...action.messages,
      ]);
      return {
        ...state,
        pending,
        messages,
        status: pending.length > 0 ? 'sending' : 'idle',
        session: action.token && state.session ? { ...state.session, token: action.token } : state.session,
        error: null,
        unread: state.open ? 0 : state.unread + action.messages.length,
      };
    }

    case 'send/failed': {
      const failed = state.pending.find((p) => p.clientId === action.clientId);
      const pending = state.pending.filter((p) => p.clientId !== action.clientId);
      return {
        ...state,
        pending,
        status: pending.length > 0 ? 'sending' : 'idle',
        error: action.error,
        // Hand a failed text message back to the composer rather than losing it (§8.3).
        draft: failed?.input.kind === 'text' && !state.draft ? failed.input.text : state.draft,
      };
    }

    case 'action/consumed':
      return state.consumedActions.includes(action.id)
        ? state
        : { ...state, consumedActions: [...state.consumedActions, action.id] };

    case 'error/dismiss':
      return { ...state, error: null };

    case 'expired':
      return {
        ...state,
        status: 'ended',
        session: null,
        pending: [],
        error: {
          code: 'session_expired',
          message: 'This conversation has expired.',
          retryable: false,
        },
      };

    case 'reset':
      return {
        ...initialState,
        // A reset clears the conversation, not what we know about the page.
        config: state.config,
        open: state.open,
        sound: state.sound,
        teaserDismissed: state.teaserDismissed,
        screen: 'home',
      };

    default:
      return state;
  }
}

/** Everything rendered in the thread, optimistic messages included. */
export function visibleMessages(state: State): Message[] {
  return state.pending.length === 0
    ? state.messages
    : [...state.messages, ...state.pending.map((p) => p.message)];
}

export function isBusy(state: State): boolean {
  return state.status === 'starting' || state.status === 'sending';
}

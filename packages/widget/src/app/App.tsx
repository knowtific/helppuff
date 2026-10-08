import { Component, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { Composer } from '../components/Composer.js';
import { ErrorNotice } from '../components/ErrorNotice.js';
import { Header } from '../components/Header.js';
import { Home } from '../components/Home.js';
import { Launcher } from '../components/Launcher.js';
import { LeadForm } from '../components/LeadForm.js';
import { Teaser } from '../components/Teaser.js';
import { ShortcutBar } from '../components/Shortcuts.js';
import { LiveRegion, Thread } from '../components/Thread.js';
import type { MessageHandlers } from '../components/messages/index.js';
import { log } from '../lib/env.js';
import { trapFocus } from '../lib/focus.js';
import { CaptchaError, getCaptchaToken } from '../lib/turnstile.js';
import type { Action, Message, MessageBody, Option, Shortcut, WidgetConfig } from '@helppuff/protocol';
import { cleanText } from '@helppuff/protocol/text';
import { localFormId } from '@helppuff/protocol/forms';
import { HANDOVER_ACTION } from '@helppuff/protocol/live';
import { JOB_FLOW_PREFIX, QUOTE_CONTACT_FIELDS } from '@helppuff/protocol/jobs';
import type { connectLive, LiveConnection } from '../live/index.js';
import { parseMessage } from './validate.js';
import type { Runtime } from '../loader.js';
import { toWidgetError, type Api } from './api.js';
import { clientId, pageContext, pathAllowed, currentPath } from './context.js';
import { clear as clearStorage, load as loadStored, save as saveStored } from './persist.js';
import { makeStrings } from './strings.js';
import { GREETING_PREFIX } from './store.js';

/** The live chunk's file, set at build time (absent in tests: no live connection there). */
declare const __HELPPUFF_LIVE_FILE__: string | undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
/** Ids the widget made itself (greetings, flow steps, local notes) never reach the server's records. */
const isServerMessage = (id: string) => !id.startsWith(GREETING_PREFIX) && !isFlowMessage(id) && !UUID.test(id) && !id.startsWith('c_') && !id.startsWith('wf_');
import {
  findFlow,
  isComplete,
  isFlowMessage,
  renderTemplate,
  stepAt,
  stepMessage,
  validateAnswer,
} from '../flows/runner.js';
import {
  initialState,
  isBusy,
  reducer,
  visibleMessages,
  type Pending,
  type SendInput,
  type State,
} from './store.js';

/**
 * Error boundary. The first uncaught render error resets to a safe
 * state and re-renders once. The second is fatal: the widget hides.
 *
 * Children are suppressed the moment an error is caught, and only restored
 * after `onReset` has had a chance to change what renders. Re-rendering the
 * same failing tree inside the same commit would let the second throw escape
 * Preact's boundary and reach the host page.
 */
export class Boundary extends Component<
  { runtime: Runtime; onReset: () => void; children: ComponentChildren },
  { failures: number; suppressed: boolean }
> {
  override state = { failures: 0, suppressed: false };

  override componentDidCatch(error: unknown): void {
    log('render_error', error);
    const failures = this.state.failures + 1;

    if (failures >= 2) {
      this.setState({ failures, suppressed: true });
      this.props.runtime.hide('render_error_twice');
      return;
    }

    this.setState({ failures, suppressed: true });

    // Recover on a later tick, so this commit finishes with nothing rendered.
    queueMicrotask(() => {
      try {
        this.props.onReset();
      } catch {
        this.props.runtime.hide('reset_threw');
        return;
      }
      this.setState({ suppressed: false });
    });
  }

  override render() {
    return this.state.suppressed ? null : this.props.children;
  }
}

export type AppHandleRef = { current: AppCommands | null };

export type AppCommands = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  send: (text: string) => void;
  identify: (lead: Record<string, string>) => void;
  reset: () => void;
  state: () => unknown;
};

export function App({
  runtime,
  config,
  api,
  handle,
}: {
  runtime: Runtime;
  config: WidgetConfig;
  api: Api;
  handle: AppHandleRef;
}) {
  const { siteId } = runtime;
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    config,
    sound: config.sound?.enabled ?? false,
  });
  const [closing, setClosing] = useState(false);
  const [offline, setOffline] = useState(() => navigator.onLine === false);
  const [showTeaser, setShowTeaser] = useState(false);
  const [shortcutsExpanded, setShortcutsExpanded] = useState(false);
  /** A message typed before the lead form, replayed once it is submitted. */
  const queuedFirstMessage = useRef<string | null>(null);
  /**
   * A synchronous mirror of the lead. `identify()` and `send()` can arrive in
   * the same tick — the loader replays its whole queue at once — and a
   * dispatch is not visible to the next command until the next render.
   */
  const leadRef = useRef<Record<string, string> | null>(null);
  /** Filled in below; lets `handlers` start a flow without a circular dep. */
  const startFlowRef = useRef<(flowId: string) => void>(() => {});
  const [path, setPath] = useState(() => currentPath());
  /** This visitor's ratings, by message id. Kept for the page's life; the server keeps the record. */
  const [ratings, setRatings] = useState<Record<string, 1 | -1 | 0>>({});

  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLDivElement>(null);
  /*
   * Where Turnstile renders. It lives inside the shadow root and takes no
   * space until a visitor actually has to do something — `interaction-only`
   * means most never see it.
   */
  const captchaMount = useRef<HTMLDivElement>(null);
  const stateRef = useRef<State>(state);
  stateRef.current = state;
  if (state.lead) leadRef.current = { ...(leadRef.current ?? {}), ...state.lead };

  const t = useMemo(() => makeStrings(config.strings), [config]);

  /**
   * Live chat: on a site with live chat, an open chat loads the live chunk and
   * stays connected, so a person can take it over at any time. Whether one has
   * it now is the latest handover message.
   */
  const { handover, handedOver } = useMemo(() => {
    let latest: Extract<Message, { type: 'handover' }> | null = null;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i]!;
      if (m.type !== 'handover') continue;
      latest ??= m;
      // `missed` is live only after a `waiting` (nobody took it in time; the visitor may keep
      // waiting). Without one, the chat was never handed over: nobody was free to begin with.
      if (latest.status !== 'missed') return { handover: latest, handedOver: latest.status === 'waiting' || latest.status === 'joined' };
      if (m.status === 'waiting' || m.status === 'joined') return { handover: latest, handedOver: true };
      if (m.status === 'left' || m.status === 'closed') break;
    }
    return { handover: latest, handedOver: false };
  }, [state.messages]);
  // Connected while a chat is open (a person can take it over at any time); polling only while one has it.
  const liveOn = Boolean(runtime.capabilities.live) && Boolean(state.session);
  const handedOverRef = useRef(handedOver);
  handedOverRef.current = handedOver;
  const liveConn = useRef<LiveConnection | null>(null);
  useEffect(() => {
    if (!liveOn || typeof __HELPPUFF_LIVE_FILE__ !== 'string') return;
    let cancelled = false;
    let url: string;
    try {
      url = new URL(/* @vite-ignore */ __HELPPUFF_LIVE_FILE__, import.meta.url).href;
    } catch {
      return;
    }
    import(/* @vite-ignore */ url)
      .then((mod: { connectLive: typeof connectLive }) => {
        if (cancelled) return;
        liveConn.current = mod.connectLive({
          apiBase: runtime.apiBase,
          token: () => stateRef.current.session?.token ?? null,
          // The server's clock: the newest message it stamped.
          lastTs: () => stateRef.current.messages.reduce((max, m) => (m.role !== 'user' && m.ts > max ? m.ts : max), 0),
          active: () => handedOverRef.current,
          hooks: {
            onMessage: (message) => dispatch({ type: 'live/message', message }),
            onStatus: () => {},
            onTyping: (on) => dispatch({ type: 'live/typing', on }),
            parse: parseMessage,
          },
        });
      })
      // No live chunk (offline, CSP): the visitor's next message still reaches the team.
      .catch(() => {});
    return () => {
      cancelled = true;
      liveConn.current?.close();
      liveConn.current = null;
      dispatch({ type: 'live/typing', on: false });
    };
  }, [liveOn, state.session?.id, runtime.apiBase]);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDraft = (text: string) => {
    dispatch({ type: 'draft', text });
    const conn = liveConn.current;
    if (!conn) return;
    if (!typingTimer.current) conn.typing(true);
    else clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      conn.typing(false);
      typingTimer.current = null;
    }, 3000);
  };

  // ---------------------------------------------------------------- effects

  // Restore a stored session once, at mount.
  useEffect(() => {
    const restored = loadStored(siteId);
    if (restored) dispatch({ type: 'restore', restored });
  }, [siteId]);

  /**
   * Persist whenever something worth keeping changes, and clear once a
   * session ends.
   *
   * Clearing is driven by state rather than done imperatively in the reset
   * handler: an effect queued by an earlier render still closes over the old
   * state, so an imperative clear could be immediately undone by a save that
   * had not flushed yet. `hadSession` keeps the first mount from wiping a
   * stored session before `restore` has had a chance to load it.
   */
  const hadSession = useRef(false);
  if (state.session) hadSession.current = true;

  useEffect(() => {
    if (state.session) saveStored(siteId, state);
    else if (hadSession.current) clearStorage(siteId);
  }, [siteId, state.session, state.messages, state.lead, state.consumedActions, state.sound, state.teaserDismissed]);

  // Two tabs stay in sync rather than clobbering each other.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== `hp:${siteId}`) return;
      const restored = loadStored(siteId);
      if (restored) dispatch({ type: 'restore', restored });
      else dispatch({ type: 'reset' });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [siteId]);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // SPA route changes, by polling rather than patching history.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      const next = currentPath();
      setPath((previous) => (previous === next ? previous : next));
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Escape closes, but only while the panel is open, so the host page keeps its own Escape.
  useEffect(() => {
    if (!state.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [state.open]);

  // Focus moves into the panel on open and back to the launcher on close.
  useEffect(() => {
    if (!state.open || !panel.current) return;
    return trapFocus(panel.current);
  }, [state.open, state.screen]);

  // The iOS keyboard shrinks the visual viewport; keep the composer visible.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || !state.open) return;
    const onResize = () => {
      runtime.host.style.setProperty('--hp-viewport-h', `${viewport.height}px`);
    };
    onResize();
    viewport.addEventListener('resize', onResize);
    return () => {
      viewport.removeEventListener('resize', onResize);
      runtime.host.style.removeProperty('--hp-viewport-h');
    };
  }, [state.open, runtime.host]);

  /**
   * Teaser: on matching paths, never once opened or dismissed, and
   * never during a live conversation.
   *
   * Two triggers, whichever comes first — time on the page, and how far down
   * it the visitor has read. Someone who scrolls straight to the pricing
   * table should not have to wait out a timer to be offered help.
   */
  useEffect(() => {
    const teaser = config.teaser;
    if (!teaser || state.teaserDismissed || state.open || state.session) return;
    if (!pathAllowed(teaser.paths, path)) return;

    const show = () => setShowTeaser(true);
    const cleanups: Array<() => void> = [];

    if (teaser.delayMs !== undefined) {
      const id = setTimeout(show, teaser.delayMs);
      cleanups.push(() => clearTimeout(id));
    }

    if (teaser.afterScroll !== undefined) {
      const target = teaser.afterScroll;
      const check = () => {
        const doc = document.documentElement;
        const scrollable = doc.scrollHeight - doc.clientHeight;
        // A page too short to scroll has, in effect, been read to the end.
        const percent = scrollable <= 0 ? 100 : (window.scrollY / scrollable) * 100;
        if (percent >= target) show();
      };
      window.addEventListener('scroll', check, { passive: true });
      cleanups.push(() => window.removeEventListener('scroll', check));
      check();
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [config, state.teaserDismissed, state.open, state.session, path]);

  // ---------------------------------------------------------------- actions

  const open = useCallback(() => {
    setShowTeaser(false);
    dispatch({ type: 'open' });
    runtime.emit('open');
  }, [runtime]);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      dispatch({ type: 'close' });
      runtime.emit('close');
      launcher.current?.querySelector('button')?.focus();
    }, 180);
  }, [runtime]);

  /**
   * Streamed replies are previewed as they are written — only where the site
   * streams, so every other site sends exactly the request it always did.
   */
  const onText = useMemo(
    () => (runtime.capabilities.stream ? (text: string) => dispatch({ type: 'stream/text', text }) : undefined),
    [runtime],
  );

  const startSession = useCallback(
    async (lead: Record<string, string>, firstMessage?: string) => {
      /*
       * Every path into a session comes through here, so this is the one
       * place a captcha token has to be obtained. It is fetched fresh each
       * time: siteverify redeems a token exactly once, so a retry after a
       * failed start needs a new one.
       */
      let captchaToken: string | undefined;
      const captcha = config.captcha;
      if (captcha && captchaMount.current) {
        try {
          captchaToken = await getCaptchaToken(captcha.siteKey, captchaMount.current, {
            theme: config.brand.theme === 'auto' ? 'auto' : config.brand.theme,
          });
        } catch (thrown) {
          // The server fails closed, so there is nothing to fall back to —
          // say so plainly rather than sending a request that cannot succeed.
          log('captcha failed', thrown instanceof CaptchaError ? thrown.reason : thrown);
          dispatch({
            type: 'session/failed',
            error: { code: 'captcha_failed', message: t('captchaFailed'), retryable: true },
          });
          return;
        }
      }

      const result = await api
        .startSession(
          {
            ...(Object.keys(lead).length > 0 ? { lead } : {}),
            context: pageContext(),
            ...(firstMessage ? { firstMessage } : {}),
            ...(captchaToken ? { captchaToken } : {}),
          },
          onText,
        )
        .catch((thrown: unknown) => {
          dispatch({ type: 'session/failed', error: toWidgetError(thrown) });
          return null;
        });

      if (!result) return;
      dispatch({
        type: 'session/started',
        session: result.session,
        messages: result.messages,
        // Show what the visitor asked, not just the answer to it.
        ...(firstMessage
          ? {
              userMessage: {
                id: clientId(),
                ts: Date.now(),
                role: 'user' as const,
                type: 'text' as const,
                text: firstMessage,
              },
            }
          : {}),
      });
      runtime.emit('lead', lead);
    },
    [api, runtime, onText],
  );

  const doSend = useCallback(
    async (input: SendInput) => {
      const session = stateRef.current.session;
      if (!session) return;

      const id = clientId();
      const text = input.kind === 'text' ? input.text : input.label;
      const pending: Pending = {
        clientId: id,
        input,
        message: { id, ts: Date.now(), role: 'user', type: 'text', text },
      };

      dispatch({ type: 'send', pending });

      const result = await api.send(session.token, { ...input, clientId: id }, onText).catch((thrown: unknown) => {
        dispatch({ type: 'send/failed', clientId: id, error: toWidgetError(thrown) });
        return null;
      });

      if (!result) return;
      dispatch({
        type: 'send/ok',
        clientId: id,
        messages: result.messages,
        ...(result.token ? { token: result.token } : {}),
      });
      runtime.emit('message', { role: 'agent', count: result.messages.length });
    },
    [api, runtime, onText],
  );

  const onStart = useCallback(() => {
    const current = stateRef.current;
    const lead = leadRef.current ?? {};
    dispatch({ type: 'start' });
    // The direct path opens a session immediately; the form path waits for submit.
    if (!current.session && (!config.leadForm.enabled || leadReady(config, lead))) {
      void startSession(lead);
    }
  }, [config, startSession]);

  const onSubmitLead = useCallback(
    (lead: Record<string, string>, firstMessage?: string) => {
      const queued = queuedFirstMessage.current;
      queuedFirstMessage.current = null;
      // With a first-message box, the queued message was prefilled into it,
      // so the box is the whole truth: an edit is what they meant, and a
      // cleared box means send nothing. Without one, the queue is all there is.
      // A "message" field in the form is what they want to ask: it opens the
      // conversation (shown in the thread, answered first), and stays on the lead.
      const fromField = lead['message']?.trim() || undefined;
      const message = config.leadForm.askFirstMessage ? (firstMessage ?? fromField) : (queued ?? fromField);
      dispatch({ type: 'lead/submit', lead, ...(message ? { firstMessage: message } : {}) });
      void startSession(lead, message);
    },
    [config, startSession],
  );

  /**
   * A quote flow's answers (`submit.as: 'job'`): one action the server saves as
   * a job. Without a chat yet, it starts one (through the lead form if the site
   * has one) and sends the answers as soon as the chat exists.
   */
  const pendingJob = useRef<SendInput | null>(null);
  const submitJobFlow = useCallback(
    (flowId: string, answers: Record<string, string>, label: string) => {
      const input: SendInput = { kind: 'action', actionId: `${JOB_FLOW_PREFIX}${flowId}`, value: JSON.stringify(answers), label: label.slice(0, 200) || 'Request' };
      if (stateRef.current.session) {
        void doSend(input);
        return;
      }
      pendingJob.current = input;
      // The flow's own contact questions answer the lead form's: it is shown only for what is still missing.
      const lead = { ...(leadRef.current ?? {}) };
      for (const [answer, field] of Object.entries(QUOTE_CONTACT_FIELDS)) if (answers[answer] && !lead[field]) lead[field] = answers[answer];
      leadRef.current = lead;
      if (!config.leadForm.enabled || leadReady(config, lead)) void startSession(lead);
      else dispatch({ type: 'screen', screen: 'lead_form' });
    },
    [config, doSend, startSession],
  );
  useEffect(() => {
    if (!state.session || !pendingJob.current) return;
    const input = pendingJob.current;
    pendingJob.current = null;
    void doSend(input);
  }, [state.session, doSend]);

  /** Append a message the widget produced itself, with no server round trip. */
  const addLocal = useCallback((message: Message) => {
    dispatch({ type: 'message/local', message });
  }, []);

  const localMessage = useCallback(
    (body: MessageBody): Message => ({ id: clientId(), ts: Date.now(), role: 'agent', ...body }) as Message,
    [],
  );

  /**
   * Deliver a message, collecting a lead first if the site requires one.
   *
   * Every producer of a message ends up here — the composer, `HelpPuff.send`,
   * a `reply` shortcut and a finished flow — so none of them can quietly
   * drop the visitor's words for want of a session.
   */
  const sendText = useCallback(
    (text: string) => {
      // The same cleaning the server applies (no control or hidden characters), so what is shown is what is sent.
      const trimmed = cleanText(text, 'input');
      if (!trimmed) return;
      const current = stateRef.current;
      if (current.session) {
        void doSend({ kind: 'text', text: trimmed });
        return;
      }
      if (leadReady(config, leadRef.current ?? {})) {
        void startSession(leadRef.current ?? {}, trimmed);
        return;
      }
      queuedFirstMessage.current = trimmed;
      dispatch({ type: 'screen', screen: 'lead_form' });
    },
    [config, doSend, startSession],
  );

  /**
   * Flows run entirely in the browser: each step is a local message,
   * and nothing reaches the server until the template is rendered from the
   * collected answers.
   */
  const askStep = useCallback(
    (flowId: string, step: number) => {
      const flow = findFlow(config, flowId);
      if (!flow) return;
      const message = stepMessage(flow, step);
      if (message) addLocal(message);
    },
    [config, addLocal],
  );

  const startFlow = useCallback(
    (flowId: string) => {
      const flow = findFlow(config, flowId);
      // A shortcut pointing at a flow that no longer exists does nothing
      // rather than wedging the widget.
      if (!flow) return;
      dispatch({ type: 'flow/start', id: flowId });
      askStep(flowId, 0);
    },
    [config, askStep],
  );

  const cancelFlow = useCallback(() => {
    dispatch({ type: 'flow/end' });
  }, []);

  /** Record one answer and either ask the next step or submit the whole flow. */
  const answerFlow = useCallback(
    (raw: string): boolean => {
      const current = stateRef.current.flow;
      if (!current) return false;

      const flow = findFlow(config, current.id);
      const step = flow ? stepAt(flow, current.step) : null;
      if (!flow || !step) {
        dispatch({ type: 'flow/end' });
        return false;
      }

      const problem = validateAnswer(step, raw);
      if (problem) {
        dispatch({ type: 'session/failed', error: { code: 'bad_request', message: problem, retryable: false } });
        return true;
      }

      const value = raw.trim();
      addLocal({ id: clientId(), ts: Date.now(), role: 'user', type: 'text', text: value });
      dispatch({ type: 'flow/answer', field: step.field, value });

      const nextStep = current.step + 1;
      if (isComplete(flow, nextStep)) {
        dispatch({ type: 'flow/end' });
        const answers = { ...current.answers, [step.field]: value };
        if (flow.submit.as === 'job') submitJobFlow(flow.id, answers, renderTemplate(flow.submit.template, answers));
        else sendText(renderTemplate(flow.submit.template, answers));
      } else {
        askStep(flow.id, nextStep);
      }
      return true;
    },
    [config, addLocal, askStep, sendText, submitJobFlow],
  );

  startFlowRef.current = startFlow;

  /**
   * What a card, chip or inline form does when it is used. `url`,
   * `tel` and `email` are plain anchors, so they never reach here.
   */
  const handlers: MessageHandlers = useMemo(
    () => ({
      onPick: (message: Message, options: Option[]) => {
        if (options.length === 0) return;
        dispatch({ type: 'action/consumed', id: message.id });
        if (isFlowMessage(message.id)) {
          answerFlowRef.current(options.map((option) => option.label).join(', '));
          return;
        }
        void doSend({
          kind: 'action',
          actionId: message.id,
          value: options.map((option) => option.value).join(', '),
          label: options.map((option) => option.label).join(', '),
        });
      },

      onAction: (message: Message, action: Action) => {
        if (action.kind === 'reply') {
          dispatch({ type: 'action/consumed', id: message.id });
          void doSend({ kind: 'action', actionId: action.id, value: action.value, label: action.label });
          return;
        }
        if (action.kind === 'form') {
          const form = config.forms?.[action.formId];
          if (!form) return;
          addLocal({
            ...localMessage({
              type: 'form',
              fields: form.fields,
              ...(form.title ? { title: form.title } : {}),
              ...(form.submitLabel ? { submitLabel: form.submitLabel } : {}),
            }),
            // Named for its form, so the server knows the submission answers a form this site offers.
            id: localFormId(action.formId, Math.random().toString(36).slice(2, 8)),
          });
          return;
        }
        if (action.kind === 'flow') startFlowRef.current(action.flowId);
      },

      onFormSubmit: (message: Message, value: string, label: string) => {
        dispatch({ type: 'action/consumed', id: message.id });
        void doSend({ kind: 'action', actionId: message.id, value, label });
      },

      isConsumed: (message: Message) => state.consumedActions.includes(message.id),

      // Only replies the server recorded can be rated: not the greeting, a flow step, or a local note.
      rating:
        runtime.capabilities.feedback && state.session
          ? {
              get: (message: Message) => (isServerMessage(message.id) ? (ratings[message.id] ?? 0) : NaN),
              set: (message: Message, value: 1 | -1 | 0) => {
                const session = stateRef.current.session;
                if (!session || !isServerMessage(message.id)) return;
                setRatings((current) => ({ ...current, [message.id]: value }));
                api.rate(session.token, message.id, value);
              },
              labels: [t('helpful'), t('notHelpful')] as [string, string],
            }
          : undefined,
    }),
    [config, doSend, addLocal, localMessage, state.consumedActions, state.session, ratings, runtime, api, t],
  );

  const answerFlowRef = useRef<(value: string) => boolean>(() => false);
  answerFlowRef.current = answerFlow;

  /**
   * A shortcut behaves like the action it carries. A `reply` goes through
   * the lead form first if one is required, so the visitor's intent is not
   * lost.
   */
  const onShortcut = useCallback(
    (shortcut: Shortcut) => {
      const action = shortcut.action;
      if (action.kind === 'flow') {
        startFlow(action.flowId);
        return;
      }
      if (action.kind === 'form') {
        handlers.onAction({ id: `shortcut_${shortcut.id}` } as Message, action);
        return;
      }
      if (action.kind !== 'reply') return;

      if (stateRef.current.session) {
        void doSend({ kind: 'action', actionId: action.id, value: action.value, label: action.label });
        return;
      }
      sendText(action.value);
    },
    [doSend, sendText, startFlow, handlers],
  );

  const onComposerSend = useCallback(() => {
    const text = stateRef.current.draft.trim();
    if (!text) return;
    dispatch({ type: 'draft', text: '' });
    // While a flow is running the composer answers it instead.
    if (answerFlowRef.current(text)) return;
    sendText(text);
  }, [sendText]);

  const onRetry = useCallback(() => {
    const current = stateRef.current;
    dispatch({ type: 'error/dismiss' });
    if (!current.session) void startSession(leadRef.current ?? {});
    else if (current.draft.trim()) void doSend({ kind: 'text', text: current.draft.trim() });
  }, [doSend, startSession]);

  const onNewChat = useCallback(() => {
    // The one moment a visitor really ends a conversation: tell the server (conversation.ended).
    const ending = stateRef.current.session;
    if (ending) api.end(ending.token);
    leadRef.current = null;
    queuedFirstMessage.current = null;
    clearStorage(siteId);
    dispatch({ type: 'reset' });
  }, [siteId, api]);

  /**
   * The handle the loader drives `window.HelpPuff` through.
   *
   * Published during render, not in an effect: the loader replays any queued
   * commands the moment `mount()` returns, which is before Preact has flushed
   * effects. Publishing later would silently drop the very first `open()`.
   */
  handle.current = {
    open,
    close,
    toggle: () => (stateRef.current.open ? close() : open()),
    send: (text: string) => {
      // send() opens the panel as well as delivering the message.
      open();
      sendText(text);
    },
    identify: (lead: Record<string, string>) => {
      leadRef.current = { ...(leadRef.current ?? {}), ...lead };
      dispatch({ type: 'identify', lead });
    },
    reset: onNewChat,
    state: () => ({ screen: stateRef.current.screen, status: stateRef.current.status }),
  };

  // ---------------------------------------------------------------- render

  const busy = isBusy(state);
  const messages = visibleMessages(state);
  const pendingIds = useMemo(() => new Set(state.pending.map((p) => p.clientId)), [state.pending]);
  const visibleShortcuts = useCallback(
    (shortcuts: Shortcut[] | undefined) =>
      (shortcuts ?? []).filter((shortcut) => pathAllowed(shortcut.paths, path)),
    [path],
  );
  const homeShortcuts = useMemo(() => visibleShortcuts(config.home.shortcuts), [config, visibleShortcuts]);
  const chatShortcuts = useMemo(() => visibleShortcuts(config.chat.shortcuts), [config, visibleShortcuts]);

  const hideOn = config.launcher.hideOnPaths;
  const launcherHidden = Boolean(hideOn?.length) && pathAllowed(hideOn, path);

  return (
    <>
      {!launcherHidden ? (
        <div ref={launcher}>
          <Launcher
            config={config}
            open={state.open}
            unread={state.unread}
            onClick={() => (state.open ? close() : open())}
          />
        </div>
      ) : null}

      {showTeaser && config.teaser && !state.open ? (
        <Teaser
          text={config.teaser.text}
          position={config.launcher.position}
          onOpen={open}
          onDismiss={() => {
            setShowTeaser(false);
            dispatch({ type: 'teaser/dismiss' });
          }}
        />
      ) : null}

      {state.open ? (
        <div
          class="hp-panel"
          id="hp-panel"
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="hp-title"
          data-position={config.launcher.position}
          {...(closing ? { 'data-closing': '' } : {})}
        >
          <Header
            config={config}
            thinking={busy}
            showBack={state.screen !== 'home' && !state.session}
            {...(handover?.status === 'joined' ? { status: handover.agentName ? `${handover.agentName} · ${t('liveStatus')}` : t('liveStatus') } : {})}
            {...(runtime.capabilities.live && state.session && state.screen === 'chat' && !handedOver
              ? { onPerson: () => void doSend({ kind: 'action', actionId: HANDOVER_ACTION, value: 'person', label: t('talkToPerson') }) }
              : {})}
            t={t}
            onBack={() => dispatch({ type: 'screen', screen: 'home' })}
            onClose={close}
          />

          <div class="hp-captcha" ref={captchaMount} data-active="no" />

          {state.screen === 'home' ? (
            <Home
              config={config}
              shortcuts={homeShortcuts}
              onShortcut={onShortcut}
              hasSession={Boolean(state.session)}
              lastMessage={state.messages[state.messages.length - 1]}
              busy={busy}
              t={t}
              onStart={onStart}
            />
          ) : state.screen === 'lead_form' ? (
            <div class="hp-screen">
              <div class="hp-scroll">
                <LeadForm
                  config={config}
                  initial={leadRef.current}
                  initialMessage={queuedFirstMessage.current}
                  busy={busy}
                  t={t}
                  onSubmit={onSubmitLead}
                />
              </div>
              {state.error ? errorNotice() : null}
            </div>
          ) : (
            <div class="hp-screen">
              <Thread
                messages={messages}
                busy={busy || state.agentTyping}
                preview={state.preview}
                pendingIds={pendingIds}
                handlers={handlers}
                t={t}
              />
              {state.error ? errorNotice() : null}

              {state.flow ? (
                <div class="hp-flow-bar">
                  <span>{t('flowRunning')}</span>
                  <button type="button" class="hp-chip" onClick={cancelFlow}>
                    {t('cancel')}
                  </button>
                </div>
              ) : (
                <ShortcutBar
                  shortcuts={chatShortcuts}
                  collapsed={messages.length > 6}
                  expanded={shortcutsExpanded}
                  onPick={onShortcut}
                  onExpand={() => setShortcutsExpanded(true)}
                />
              )}

              <Composer
                value={state.draft}
                // A flow answers in the composer before any session exists.
                disabled={
                  state.status === 'sending' || state.status === 'ended' || (!state.session && !state.flow)
                }
                offline={offline}
                placeholder={config.chat.placeholder ?? t('placeholder')}
                t={t}
                onInput={onDraft}
                onSend={onComposerSend}
              />
            </div>
          )}

          {config.poweredBy ? <PoweredBy value={config.poweredBy} t={t} /> : null}

          <LiveRegion messages={messages} />
        </div>
      ) : null}
    </>
  );

  function errorNotice() {
    return state.error ? (
      <ErrorNotice
        error={state.error}
        config={config}
        t={t}
        onRetry={onRetry}
        onNewChat={onNewChat}
        onDismiss={() => dispatch({ type: 'error/dismiss' })}
      />
    ) : null;
  }
}

const HELPPUFF_URL = 'https://github.com/helppuff-chat/helppuff';

/**
 * The footer credit. `true` is the HelpPuff credit (its wording still
 * overridable through `strings.poweredBy`); an object whitelabels it, and one
 * without a `url` renders as plain text rather than a link to nowhere.
 */
function PoweredBy({
  value,
  t,
}: {
  value: Exclude<WidgetConfig['poweredBy'], false>;
  t: ReturnType<typeof makeStrings>;
}) {
  const text = value === true ? t('poweredBy') : value.text;
  const url = value === true ? HELPPUFF_URL : value.url;
  return (
    <div class="hp-powered">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {text}
        </a>
      ) : (
        text
      )}
    </div>
  );
}

function leadReady(config: WidgetConfig, lead: Record<string, string>): boolean {
  if (!config.leadForm.enabled) return true;
  return config.leadForm.fields.every((field) => !field.required || Boolean(lead[field.name]?.trim()));
}

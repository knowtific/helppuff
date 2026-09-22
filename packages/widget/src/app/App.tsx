import { Component, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { Composer } from '../components/Composer.js';
import { ErrorNotice } from '../components/ErrorNotice.js';
import { Header } from '../components/Header.js';
import { Home } from '../components/Home.js';
import { Launcher } from '../components/Launcher.js';
import { LeadForm } from '../components/LeadForm.js';
import { Teaser } from '../components/Teaser.js';
import { LiveRegion, Thread } from '../components/Thread.js';
import { log } from '../lib/env.js';
import { trapFocus } from '../lib/focus.js';
import type { WidgetConfig } from '@murmur/protocol';
import type { Runtime } from '../loader.js';
import { toWidgetError, type Api } from './api.js';
import { clientId, pageContext, pathAllowed, currentPath } from './context.js';
import { clear as clearStorage, load as loadStored, save as saveStored } from './persist.js';
import { makeStrings } from './strings.js';
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
 * Error boundary (§8.3). The first uncaught render error resets to a safe
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
  /** A message typed before the lead form, replayed once it is submitted. */
  const queuedFirstMessage = useRef<string | null>(null);
  /**
   * A synchronous mirror of the lead. `identify()` and `send()` can arrive in
   * the same tick — the loader replays its whole queue at once — and a
   * dispatch is not visible to the next command until the next render.
   */
  const leadRef = useRef<Record<string, string> | null>(null);
  const [path, setPath] = useState(() => currentPath());

  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLDivElement>(null);
  const stateRef = useRef<State>(state);
  stateRef.current = state;
  if (state.lead) leadRef.current = { ...(leadRef.current ?? {}), ...state.lead };

  const t = useMemo(() => makeStrings(config.strings), [config]);

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

  // Two tabs stay in sync rather than clobbering each other (§8.6).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== `mm:${siteId}`) return;
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

  // SPA route changes, by polling rather than patching history (§8.2).
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

  // Focus moves into the panel on open and back to the launcher on close (§8.7).
  useEffect(() => {
    if (!state.open || !panel.current) return;
    return trapFocus(panel.current);
  }, [state.open, state.screen]);

  // The iOS keyboard shrinks the visual viewport; keep the composer visible (§8.8).
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || !state.open) return;
    const onResize = () => {
      runtime.host.style.setProperty('--mm-viewport-h', `${viewport.height}px`);
    };
    onResize();
    viewport.addEventListener('resize', onResize);
    return () => {
      viewport.removeEventListener('resize', onResize);
      runtime.host.style.removeProperty('--mm-viewport-h');
    };
  }, [state.open, runtime.host]);

  // Teaser (§8.7): after the delay, on matching paths, never once opened.
  useEffect(() => {
    const teaser = config.teaser;
    if (!teaser || state.teaserDismissed || state.open || state.session) return;
    if (!pathAllowed(teaser.paths, path)) return;
    const id = setTimeout(() => setShowTeaser(true), teaser.delayMs);
    return () => clearTimeout(id);
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

  const startSession = useCallback(
    async (lead: Record<string, string>, firstMessage?: string) => {
      const result = await api
        .startSession({
          ...(Object.keys(lead).length > 0 ? { lead } : {}),
          context: pageContext(),
          ...(firstMessage ? { firstMessage } : {}),
        })
        .catch((thrown: unknown) => {
          dispatch({ type: 'session/failed', error: toWidgetError(thrown) });
          return null;
        });

      if (!result) return;
      dispatch({ type: 'session/started', session: result.session, messages: result.messages });
      runtime.emit('lead', lead);
    },
    [api, runtime],
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

      const result = await api.send(session.token, { ...input, clientId: id }).catch((thrown: unknown) => {
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
    [api, runtime],
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
      const message = firstMessage ?? queued ?? undefined;
      dispatch({ type: 'lead/submit', lead, ...(message ? { firstMessage: message } : {}) });
      void startSession(lead, message);
    },
    [startSession],
  );

  const onComposerSend = useCallback(() => {
    const text = stateRef.current.draft.trim();
    if (text) void doSend({ kind: 'text', text });
  }, [doSend]);

  const onRetry = useCallback(() => {
    const current = stateRef.current;
    dispatch({ type: 'error/dismiss' });
    if (!current.session) void startSession(leadRef.current ?? {});
    else if (current.draft.trim()) void doSend({ kind: 'text', text: current.draft.trim() });
  }, [doSend, startSession]);

  const onNewChat = useCallback(() => {
    leadRef.current = null;
    queuedFirstMessage.current = null;
    clearStorage(siteId);
    dispatch({ type: 'reset' });
  }, [siteId]);

  /**
   * The handle the loader drives `window.Murmur` through.
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
      // §8.1: send() opens the panel as well as delivering the message.
      open();
      const current = stateRef.current;
      if (current.session) {
        void doSend({ kind: 'text', text });
        return;
      }
      if (leadReady(config, leadRef.current ?? {})) {
        void startSession(leadRef.current ?? {}, text);
        return;
      }
      // The form has to come first, but the message is not lost (§8.5).
      queuedFirstMessage.current = text;
      dispatch({ type: 'screen', screen: 'lead_form' });
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
          class="mm-panel"
          id="mm-panel"
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="mm-title"
          data-position={config.launcher.position}
          {...(closing ? { 'data-closing': '' } : {})}
        >
          <Header
            config={config}
            thinking={busy}
            showBack={state.screen !== 'home' && !state.session}
            t={t}
            onBack={() => dispatch({ type: 'screen', screen: 'home' })}
            onClose={close}
          />

          {state.screen === 'home' ? (
            <Home
              config={config}
              hasSession={Boolean(state.session)}
              lastMessage={state.messages[state.messages.length - 1]}
              busy={busy}
              t={t}
              onStart={onStart}
            />
          ) : state.screen === 'lead_form' ? (
            <div class="mm-screen">
              <div class="mm-scroll">
    <LeadForm config={config} initial={leadRef.current} busy={busy} t={t} onSubmit={onSubmitLead} />
              </div>
              {state.error ? errorNotice() : null}
            </div>
          ) : (
            <div class="mm-screen">
              <Thread messages={messages} busy={busy} pendingIds={pendingIds} t={t} />
              {state.error ? errorNotice() : null}
              <Composer
                value={state.draft}
                disabled={state.status === 'sending' || state.status === 'ended' || !state.session}
                offline={offline}
                placeholder={config.chat.placeholder ?? t('placeholder')}
                t={t}
                onInput={(text) => dispatch({ type: 'draft', text })}
                onSend={onComposerSend}
              />
            </div>
          )}

          {config.poweredBy ? (
            <div class="mm-powered">
              <a href="https://github.com/murmur-chat/murmur" target="_blank" rel="noopener noreferrer">
                {t('poweredBy')}
              </a>
            </div>
          ) : null}

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

function leadReady(config: WidgetConfig, lead: Record<string, string>): boolean {
  if (!config.leadForm.enabled) return true;
  return config.leadForm.fields.every((field) => !field.required || Boolean(lead[field.name]?.trim()));
}

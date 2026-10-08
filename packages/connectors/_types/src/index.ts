import type { z } from 'zod';
import type { Capabilities, Message, SendRequest, StartSessionRequest } from '@helppuff/protocol';
import type { Turn } from './history.js';
import type { PromptGuidance } from './prompt.js';

export * from './errors.js';
export * from './helpers.js';
export * from './untrusted.js';
export * from './rich.js';
export * from './prompt.js';
export * from './history.js';
export * from './ai-search.js';
export * from './assistant.js';

/** A minimal key/value store with TTL — Workers KV in production. */
export interface KvStore {
  /** `cacheTtl` is the Workers KV edge cache, in seconds (minimum 60). */
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export type ToolsHandle = {
  /** Every tool's name, for `{{name}}` and `{{name.key}}` in the prompt. */
  names: string[];
  /** The tools the prompt names as `{{name}}`: offered to the model, OpenAI's function shape minus `type`. */
  offered: { name: string; description: string; parameters: Record<string, unknown> }[];
  data: Record<string, unknown>;
  call: (name: string, args: Record<string, unknown>) => Promise<string>;
};

export type ConnectorContext<Opts> = {
  /** Validated options with `{ env }` secret refs already resolved. */
  options: Opts;
  siteId: string;
  sessionId: string;
  /** Platform bindings a connector may need (KV for history, etc.). */
  env: Record<string, unknown>;
  kv: KvStore;
  /** Injected so tests can supply a mock. */
  fetch: typeof fetch;
  /** Structured logging. Never pass lead data or message text. */
  log: (event: string, data?: object) => void;
  /** Schedule work that must not block the response. */
  waitUntil: (promise: Promise<unknown>) => void;
  /**
   * Present only when this request is being streamed to the visitor. A
   * connector that streams calls it with each piece of reply text as its
   * backend produces it — never reasoning or "thinking" output — and still
   * returns the complete messages at the end, which replace the preview.
   */
  onText?: (delta: string) => void;
  /**
   * Hand a lead the conversation produced (a tool call, say) to the server,
   * which records it for the dashboard and forwards it to the site's lead
   * destinations. Absent when the server cannot take one; never throws.
   */
  reportLead?: (lead: Record<string, string>) => void;
  /**
   * Hand the visitor to a person on the team (live chat). Present only when
   * the site has live chat on. Resolves `started` (someone is being
   * notified; the server adds the waiting notice to the reply),
   * `unavailable` or `limited` (the server adds the callback form). Never throws.
   */
  handover?: (reason?: string) => Promise<'started' | 'unavailable' | 'limited'>;
  /**
   * The site's Jobs (its pipeline), when the assistant may create jobs: the
   * fields a job has, and `create`, which saves one from what the visitor
   * said and answers with its number and the required fields still missing
   * (the server shows the visitor a short form for those). Never throws.
   */
  jobs?: {
    itemSingular: string;
    fields: { name: string; label: string; type: string; required: boolean; options: string[]; question: string | null }[];
    create: (input: { title?: string; summary?: string; fields: Record<string, string> }) => Promise<{ number: number; missing: string[] } | null>;
  };
  /**
   * The site's own tools (the dashboard's Prompt page), when it has any:
   * `{{name}}` in the prompt offers a tool to the model, `{{name.key}}` reads
   * what it returned. `data` is what the tools returned or saved in this
   * conversation so far (quoted data, never instructions); `call` runs one
   * and resolves the text for the model. Never throws.
   */
  tools?: ToolsHandle;
  /** Tell the site's webhooks something happened that only the connector knows (its daily budget). Never throws. */
  notify?: (type: 'budget.warning' | 'budget.exhausted', data: Record<string, unknown>) => void;
  /**
   * The conversation so far, oldest first, from the server's own record of
   * it (D1, written after each response). When present, `loadHistory` reads
   * it and `appendHistory` writes nothing: the record is already kept.
   */
  history?: () => Promise<Turn[]>;
  /**
   * What HelpPuff says around the owner's prompt, from the site's settings:
   * `resolvePrompt` puts the owner's text between `before` and `after`.
   * Present when HelpPuff owns this connector's prompt.
   */
  guidance?: PromptGuidance;
  /** Report how long a stage took (`rag.embed`, `llm.first_token`…), for the request's Server-Timing. */
  time?: (stage: string, ms: number) => void;
  /**
   * For a `gated` connector: resolves once the request has passed its rate
   * limits, rejects when it has not. Await it before anything that costs —
   * the model call — so cheap preparation can overlap the limit check.
   */
  gate?: Promise<void>;
};

export interface Connector<Opts = unknown, State = unknown> {
  type: string;
  /** Starts before the rate limits are known and awaits `ctx.gate` before its costly call. */
  gated?: boolean;
  /** Options arrive untyped from the config file, so the input side is `unknown`. */
  optionsSchema: z.ZodType<Opts, z.ZodTypeDef, unknown>;
  capabilities: Capabilities;
  /**
   * Whether this site's options turn streaming on. Only a connector that
   * honours `ctx.onText` implements it; absent means never.
   */
  streams?(options: Opts): boolean;
  /**
   * The option that carries this site's system prompt, so a new prompt
   * version can replace it. `null` (or absent) when the prompt lives
   * somewhere HelpPuff does not own — a Retell agent, an OpenAI stored prompt,
   * the owner's own API.
   */
  promptOption?(options: Opts): string | null;
  /**
   * What the connector adds to the owner's prompt on every answer (its own
   * rules), shown read-only next to the prompt so the owner sees everything
   * the model is told and does not write rules that fight it.
   */
  builtInPrompt?(options: Opts): string | null;

  start(
    ctx: ConnectorContext<Opts>,
    input: StartSessionRequest,
  ): Promise<{ state: State; messages: Message[] }>;

  /** May return updated state, in which case the server issues a refreshed token. */
  send(
    ctx: ConnectorContext<Opts>,
    state: State,
    input: SendRequest,
  ): Promise<{ state?: State; messages: Message[] }>;

  poll?(
    ctx: ConnectorContext<Opts>,
    state: State,
    afterId?: string,
  ): Promise<{ messages: Message[] }>;

  end?(ctx: ConnectorContext<Opts>, state: State): Promise<void>;
}

/**
 * A connector with its option and state types erased, so the registry can hold
 * connectors of differing shapes in one map. Produced only by
 * `defineConnector`, which is where the erasure is checked.
 */
export interface ErasedConnector {
  readonly type: string;
  readonly gated: boolean;
  readonly capabilities: Capabilities;
  /** Validate raw options from the config file. Throws `ZodError` if invalid. */
  parseOptions(input: unknown): unknown;
  /** Whether replies stream for these (already parsed) options. */
  streams(options: unknown): boolean;
  /** Which option holds the prompt for these (already parsed) options, if HelpPuff owns it. */
  promptOption(options: unknown): string | null;
  builtInPrompt(options: unknown): string | null;
  start(
    ctx: ConnectorContext<unknown>,
    input: StartSessionRequest,
  ): Promise<{ state: unknown; messages: Message[] }>;
  send(
    ctx: ConnectorContext<unknown>,
    state: unknown,
    input: SendRequest,
  ): Promise<{ state?: unknown; messages: Message[] }>;
  poll?(
    ctx: ConnectorContext<unknown>,
    state: unknown,
    afterId?: string,
  ): Promise<{ messages: Message[] }>;
  end?(ctx: ConnectorContext<unknown>, state: unknown): Promise<void>;
}

/**
 * Wrap a typed connector for the registry. Options and state are opaque to the
 * server: it only ever hands back what the connector itself produced, so the
 * erasure here is sound.
 */
export function defineConnector<Opts, State>(connector: Connector<Opts, State>): ErasedConnector {
  const asOpts = (ctx: ConnectorContext<unknown>) => ctx as ConnectorContext<Opts>;
  const asState = (state: unknown) => state as State;

  const erased: ErasedConnector = {
    type: connector.type,
    gated: connector.gated === true,
    capabilities: connector.capabilities,
    parseOptions: (input) => connector.optionsSchema.parse(input),
    streams: (options) => connector.streams?.(options as Opts) ?? false,
    promptOption: (options) => connector.promptOption?.(options as Opts) ?? null,
    builtInPrompt: (options) => connector.builtInPrompt?.(options as Opts) ?? null,
    start: (ctx, input) => connector.start(asOpts(ctx), input),
    send: (ctx, state, input) => connector.send(asOpts(ctx), asState(state), input),
  };

  if (connector.poll) {
    const poll = connector.poll.bind(connector);
    erased.poll = (ctx, state, afterId) => poll(asOpts(ctx), asState(state), afterId);
  }
  if (connector.end) {
    const end = connector.end.bind(connector);
    erased.end = (ctx, state) => end(asOpts(ctx), asState(state));
  }

  return erased;
}

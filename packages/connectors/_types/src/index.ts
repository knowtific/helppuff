import type { z } from 'zod';
import type { Capabilities, Message, SendRequest, StartSessionRequest } from '@murmur/protocol';

export * from './errors.js';
export * from './helpers.js';
export * from './rich.js';
export * from './prompt.js';

/** A minimal key/value store with TTL — Workers KV in production (§7.3). */
export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

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
  /** Structured logging. Never pass lead data or message text (§7.2). */
  log: (event: string, data?: object) => void;
  /** Schedule work that must not block the response. */
  waitUntil: (promise: Promise<unknown>) => void;
};

export interface Connector<Opts = unknown, State = unknown> {
  type: string;
  /** Options arrive untyped from the config file, so the input side is `unknown`. */
  optionsSchema: z.ZodType<Opts, z.ZodTypeDef, unknown>;
  capabilities: Capabilities;

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
  readonly capabilities: Capabilities;
  /** Validate raw options from the config file. Throws `ZodError` if invalid. */
  parseOptions(input: unknown): unknown;
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
    capabilities: connector.capabilities,
    parseOptions: (input) => connector.optionsSchema.parse(input),
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

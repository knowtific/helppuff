/**
 * HelpPuff's assistant, split in two pluggable parts: the **model** that
 * writes answers and the **knowledge** it answers from. The assistant itself
 * (prompt, tools, grounding, guardrails, history, budget) stays HelpPuff's.
 *
 * Both are one function each, in the OpenAI chat-completions shape most
 * providers speak. A site's own (`model.provider: "custom"`,
 * `knowledge.retrieval.type: "custom"`) is a default export from a TypeScript
 * file, bundled into the Worker at deploy:
 *
 * ```ts
 * import { defineModel } from '@knowtific/helppuff/sdk';
 * export default defineModel({ id: 'my-llm', async chat(request, ctx) { … } });
 * ```
 */

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/** A call the model asked for: its arguments as the JSON text the model wrote. */
export type ToolCall = { id: string; name: string; arguments: string };

export type Completion = { content: string; toolCalls: ToolCall[]; usage: { input: number; output: number } | null };

/** One call to the model. */
export type ModelRequest = {
  /** The model id the site chose (`model.model`). */
  model: string;
  messages: ChatMessage[];
  /** Offered tools; empty or absent on the last round. */
  tools?: ToolDef[];
  maxTokens: number;
  temperature?: number;
  /** How long to think first, for models that can (`low` | `medium` | `high`; `off` for helper calls). */
  reasoning?: 'off' | 'low' | 'medium' | 'high';
  /**
   * Present when the visitor is watching the reply arrive: call it with each
   * piece of answer text as it is written (never reasoning). The complete
   * text is still returned at the end.
   */
  onText?: (delta: string) => void;
  /** Aborts when the request takes too long. */
  signal?: AbortSignal;
};

/** What every model and retriever gets: the Worker's bindings and secrets, fetch, and a log. */
export type ExtensionContext = {
  siteId: string;
  /** Bindings and secrets (`env.MY_KEY`): what `secrets` in helppuff.json uploads. */
  env: Record<string, unknown>;
  fetch: typeof fetch;
  /** Structured logging: never log message text or contact details. */
  log: (event: string, data?: object) => void;
};

export interface LanguageModel {
  /** Names it in logs and errors. */
  id: string;
  chat(request: ModelRequest, ctx: ExtensionContext): Promise<Completion>;
  /** What the model can do. Without native tool calls, tool calls written in the text are still read. */
  capabilities?: { tools?: boolean; stream?: boolean };
}

/** A passage the answer may use: shown to the model as quoted, numbered context, and cited as a source when it has a URL. */
export type Passage = {
  title: string;
  content: string;
  /** Linked as a source when the answer cites it (http/https only). */
  url?: string;
  /** Where in the page, e.g. "Pricing › Hot water". */
  heading?: string;
  /** Higher is better; passages are used in the order given. */
  score?: number;
};

export type RetrievalRequest = {
  /** The question, rewritten to stand alone when it was a follow-up. */
  query: string;
  /** The visitor's own words. */
  question: string;
  /** How many passages the answer can use. */
  limit: number;
};

export interface Retriever {
  id: string;
  search(request: RetrievalRequest, ctx: ExtensionContext): Promise<Passage[]>;
}

/** A model, typed: `export default defineModel({ id, chat })`. */
export function defineModel(model: LanguageModel): LanguageModel {
  return model;
}

/** A knowledge base, typed: `export default defineRetriever({ id, search })`. */
export function defineRetriever(retriever: Retriever): Retriever {
  return retriever;
}

/** A site's own models and retrievers, by id: given to the Worker by its generated entry. */
export type Extensions = { models?: Record<string, LanguageModel>; retrievers?: Record<string, Retriever> };

let installed: Extensions = {};

/** Called once by the Worker entry (`createWorker(config, extensions)`). */
export function setExtensions(next: Extensions): void {
  installed = { models: { ...(next.models ?? {}) }, retrievers: { ...(next.retrievers ?? {}) } };
}

export function extensions(): Extensions {
  return installed;
}

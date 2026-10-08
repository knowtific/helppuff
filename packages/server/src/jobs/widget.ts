import { JOB_FLOW_PREFIX, QUOTE_CONTACT_FIELDS } from '@helppuff/protocol';
import type { Flow, FlowStep, Shortcut, WidgetConfig } from '@helppuff/protocol';
import type { KvStore } from '@helppuff/connector-types';
import type { D1Like } from '../db/d1.js';
import { quoteFields, readPipeline, type Pipeline } from './store.js';

/**
 * Jobs in the widget and the chat.
 *
 * The quote questions (Settings → Jobs) become a guided flow, "Get a quote",
 * whose answers are saved as a job. It is kept under its own KV key,
 * `quote:<site>`, written when the pipeline is saved, so a deploy (which
 * rewrites the site's config) never drops it, and merged into the widget's
 * config when the widget loads it.
 */

export const QUOTE_FLOW_ID = 'job-quote';
/** Contact questions the quote flow adds at the end (Settings: "Ask for contact details"). */
export const CONTACT_FIELDS = Object.fromEntries(Object.entries(QUOTE_CONTACT_FIELDS).map(([answer, lead]) => [lead, answer])) as { [K in (typeof QUOTE_CONTACT_FIELDS)[keyof typeof QUOTE_CONTACT_FIELDS]]: keyof typeof QUOTE_CONTACT_FIELDS };
const quoteKey = (siteId: string) => `quote:${siteId}`;

export type QuoteWidget = { flow: Flow; shortcut: Shortcut };

/** The flow and its home-screen shortcut, or null when the quote questions are off or empty. */
export function quoteWidget(pipeline: Pipeline): QuoteWidget | null {
  if (!pipeline.quote.enabled) return null;
  const fields = quoteFields(pipeline).slice(0, pipeline.quote.askContact ? 7 : 10);
  if (!fields.length) return null;
  const steps: FlowStep[] = fields.map((f) => ({
    field: f.name,
    ask: f.question || `${f.label}?`,
    input: f.type === 'select' && f.options.length ? 'choice' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'phone' : 'text',
    ...(f.type === 'select' && f.options.length ? { choices: f.options.slice(0, 12) } : {}),
    ...(f.required ? { required: true } : {}),
  }));
  if (pipeline.quote.askContact) {
    steps.push(
      { field: CONTACT_FIELDS.name, ask: 'What’s your name?', input: 'text', required: true },
      { field: CONTACT_FIELDS.email, ask: 'And your email, so we can send it to you?', input: 'email', required: true },
      { field: CONTACT_FIELDS.phone, ask: 'A phone number, if you’d like a call (or skip).', input: 'phone' },
    );
  }
  const label = pipeline.quote.label;
  return {
    flow: { id: QUOTE_FLOW_ID, steps: steps.slice(0, 10), submit: { as: 'job', template: `${label}: ${fields.map((f) => `{{${f.name}}}`).slice(0, 3).join(' · ')}` } },
    shortcut: { id: QUOTE_FLOW_ID, label, description: 'A few quick questions.', icon: 'quote', action: { id: QUOTE_FLOW_ID, kind: 'flow', label, flowId: QUOTE_FLOW_ID } },
  };
}

/** The action id a submitted quote flow arrives with. */
export const quoteActionId = `${JOB_FLOW_PREFIX}${QUOTE_FLOW_ID}`;

export async function publishQuote(kv: KvStore | undefined, siteId: string, pipeline: Pipeline): Promise<void> {
  if (!kv) return;
  const quote = quoteWidget(pipeline);
  if (quote) await kv.put(quoteKey(siteId), JSON.stringify(quote));
  else await kv.delete(quoteKey(siteId));
}

export async function readQuote(kv: Pick<KvStore, 'get'>, siteId: string): Promise<QuoteWidget | null> {
  try {
    const raw = await kv.get(quoteKey(siteId), { cacheTtl: 60 });
    return raw ? (JSON.parse(raw) as QuoteWidget) : null;
  } catch {
    return null;
  }
}

/** The widget config with the quote flow in it, and "Get a quote" first on the home screen. */
export function withQuote(widget: WidgetConfig, quote: QuoteWidget | null): WidgetConfig {
  if (!quote) return widget;
  const flows = [...(widget.flows ?? []).filter((f) => f.id !== QUOTE_FLOW_ID), quote.flow].slice(-20);
  // A shortcut of the site's own with the same label is the same intent: the quote questions replace it.
  const same = (label: string) => label.trim().toLowerCase() === quote.shortcut.label.trim().toLowerCase();
  const shortcuts = [quote.shortcut, ...(widget.home.shortcuts ?? []).filter((s) => s.id !== QUOTE_FLOW_ID && !same(s.label))].slice(0, 8);
  return { ...widget, flows, home: { ...widget.home, shortcuts } };
}

// ------------------------------------------------------------------- cache

/**
 * The pipeline for the chat path, cached a minute per isolate: every turn
 * needs the fields (for the assistant's tool), and three D1 reads a message
 * would be wasteful. Saving the pipeline clears it in that isolate.
 */
const cache = new Map<string, { at: number; pipeline: Pipeline | null }>();
const TTL = 60_000;

export async function cachedPipeline(db: D1Like, siteId: string, now: number): Promise<Pipeline | null> {
  const hit = cache.get(siteId);
  if (hit && now - hit.at < TTL) return hit.pipeline;
  const pipeline = await readPipeline(db, siteId).catch(() => null);
  cache.set(siteId, { at: now, pipeline });
  return pipeline;
}

export function forgetPipeline(siteId?: string): void {
  if (siteId) cache.delete(siteId);
  else cache.clear();
}

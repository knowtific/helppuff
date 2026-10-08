import type { SiteConfig } from '../config/schema.js';

/**
 * HelpPuff's own assistant answers this site: the `assistant` connector
 * (`model` + `knowledge.retrieval` in helppuff.json), or `workers-ai`, its
 * name in configs written before the split. Other connectors are whole
 * backends that run the conversation themselves.
 */
export const isAssistant = (site: Pick<SiteConfig, 'connector'>): boolean => site.connector.type === 'assistant' || site.connector.type === 'workers-ai';

type AssistantOptions = { provider?: { type?: string }; knowledge?: { type?: string }; model?: unknown };
const optionsOf = (site: Pick<SiteConfig, 'connector'>) => (site.connector.options ?? {}) as AssistantOptions;

/** Who writes the assistant's answers (`workers-ai`, `openai-compatible`, `anthropic`, `custom`); null for whole backends. */
export function providerOf(site: Pick<SiteConfig, 'connector'>): string | null {
  return isAssistant(site) ? (optionsOf(site).provider?.type ?? 'workers-ai') : null;
}

/** What the assistant answers from (`helppuff`, `none`, `ai-search`…); null for whole backends. */
export function knowledgeOf(site: Pick<SiteConfig, 'connector'>): string | null {
  return isAssistant(site) ? (optionsOf(site).knowledge?.type ?? 'helppuff') : null;
}

/** The model id the assistant uses, when Workers AI runs it (helper calls reuse it); null otherwise. */
export function workersAiModelOf(site: Pick<SiteConfig, 'connector'>): string | null {
  const model = optionsOf(site).model;
  return providerOf(site) === 'workers-ai' && typeof model === 'string' ? model : null;
}

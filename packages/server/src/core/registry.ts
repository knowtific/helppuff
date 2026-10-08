import type { ErasedConnector } from '@helppuff/connector-types';
import type { ErasedSink } from '@helppuff/sink-types';
import echoConnector from '@helppuff/connector-echo';
import retellConnector from '@helppuff/connector-retell';
import openaiConnector from '@helppuff/connector-openai';
import geminiConnector from '@helppuff/connector-gemini';
import cloudflareConnector from '@helppuff/connector-cloudflare';
import anthropicConnector from '@helppuff/connector-anthropic';
import httpConnector from '@helppuff/connector-http';
import workersAiConnector, { assistantConnector } from '@helppuff/connector-workers-ai';
import webhookSink from '@helppuff/sink-webhook';
import { HelpPuffError } from './errors.js';

/**
 * Registration is explicit: the bundle contains only what is listed
 * here, so tree-shaking works and no connector is loaded by accident.
 */
export const connectors: Readonly<Record<string, ErasedConnector>> = {
  echo: echoConnector,
  retell: retellConnector,
  openai: openaiConnector,
  gemini: geminiConnector,
  cloudflare: cloudflareConnector,
  anthropic: anthropicConnector,
  http: httpConnector,
  'workers-ai': workersAiConnector,
  assistant: assistantConnector,
};

export function getConnector(type: string): ErasedConnector {
  const connector = connectors[type];
  if (!connector) {
    throw new HelpPuffError('internal', { detail: `unknown_connector:${type}` });
  }
  return connector;
}

/** Sinks are registered the same way. */
export const sinks: Readonly<Record<string, ErasedSink>> = {
  webhook: webhookSink,
};

export function getSink(type: string): ErasedSink {
  const sink = sinks[type];
  if (!sink) throw new HelpPuffError('internal', { detail: `unknown_sink:${type}` });
  return sink;
}

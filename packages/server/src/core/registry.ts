import type { ErasedConnector } from '@murmur/connector-types';
import type { ErasedSink } from '@murmur/sink-types';
import echoConnector from '@murmur/connector-echo';
import retellConnector from '@murmur/connector-retell';
import openaiConnector from '@murmur/connector-openai';
import geminiConnector from '@murmur/connector-gemini';
import cloudflareConnector from '@murmur/connector-cloudflare';
import anthropicConnector from '@murmur/connector-anthropic';
import httpConnector from '@murmur/connector-http';
import workersAiConnector from '@murmur/connector-workers-ai';
import webhookSink from '@murmur/sink-webhook';
import { MurmurError } from './errors.js';

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
};

export function getConnector(type: string): ErasedConnector {
  const connector = connectors[type];
  if (!connector) {
    throw new MurmurError('internal', { detail: `unknown_connector:${type}` });
  }
  return connector;
}

/** Sinks are registered the same way. */
export const sinks: Readonly<Record<string, ErasedSink>> = {
  webhook: webhookSink,
};

export function getSink(type: string): ErasedSink {
  const sink = sinks[type];
  if (!sink) throw new MurmurError('internal', { detail: `unknown_sink:${type}` });
  return sink;
}

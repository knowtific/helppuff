import type { ErasedConnector } from '@murmur/connector-types';
import echoConnector from '@murmur/connector-echo';
import { MurmurError } from './errors.js';

/**
 * Registration is explicit (§6.1): the bundle contains only what is listed
 * here, so tree-shaking works and no connector is loaded by accident.
 */
export const connectors: Readonly<Record<string, ErasedConnector>> = {
  echo: echoConnector,
};

export function getConnector(type: string): ErasedConnector {
  const connector = connectors[type];
  if (!connector) {
    throw new MurmurError('internal', { detail: `unknown_connector:${type}` });
  }
  return connector;
}

/** Sinks are registered the same way; none ship in M1. */
export const sinks: Readonly<Record<string, never>> = {};

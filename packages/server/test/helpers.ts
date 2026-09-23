import { defineConfig } from '../src/config/load.js';
import { createApp } from '../src/app.js';
import { memoryKv } from '../src/core/platform.js';
import type { Bindings } from '../src/core/request.js';
import type { MurmurConfigInput } from '../src/config/schema.js';

export const SECRET = 'test-secret-that-is-at-least-32-bytes-long';
export const ORIGIN = 'https://example.com';

export function testConfig(overrides: Partial<MurmurConfigInput['sites'][string]> = {}) {
  return defineConfig({
    sites: {
      demo: {
        origins: [ORIGIN, 'http://localhost:5173'],
        connector: { type: 'echo', options: { greeting: 'Hello from echo' } },
        widget: {
          leadForm: {
            enabled: true,
            fields: [
              { name: 'name', label: 'Name', type: 'text', required: true },
              { name: 'email', label: 'Email', type: 'email' },
            ],
          },
        },
        ...overrides,
      },
    },
  });
}

export function testEnv(overrides: Partial<Bindings> = {}): Bindings {
  return { MURMUR_SECRET: SECRET, MURMUR_KV: memoryKv(), ...overrides };
}

export type Harness = {
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  post: (path: string, body: unknown, init?: RequestInit) => Promise<Response>;
};

export function harness(
  config = testConfig(),
  env: Bindings = testEnv(),
  defaultOrigin: string | null = ORIGIN,
  /** Collect `waitUntil` work, so a test can await the fire-and-forget parts. */
  onWaitUntil: (promise: Promise<unknown>) => void = () => {},
): Harness {
  const app = createApp(config);
  const executionCtx = {
    waitUntil: (promise: Promise<unknown>) => onWaitUntil(promise),
    passThroughOnException: () => {},
  };

  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (defaultOrigin && !headers.has('Origin')) headers.set('Origin', defaultOrigin);
    return app.request(`http://server.test${path}`, { ...init, headers }, env, executionCtx as never);
  };

  return {
    fetch: call,
    post: (path, body, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Content-Type', 'application/json');
      return call(path, { ...init, method: 'POST', headers, body: JSON.stringify(body) });
    },
  };
}

export const startBody = {
  lead: { name: 'Ada', email: 'ada@example.com' },
  context: { pageUrl: 'https://example.com/pricing', pageTitle: 'Pricing' },
};

/** Start a session and return its token plus the first response body. */
export async function startSession(h: Harness, body: unknown = startBody) {
  const response = await h.post('/v1/sites/demo/sessions', body);
  const json = (await response.json()) as { sessionToken: string; sessionId: string; messages: unknown[] };
  return { response, ...json };
}

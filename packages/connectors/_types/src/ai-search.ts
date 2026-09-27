import { z } from 'zod';
import { ConnectorError } from './errors.js';
import { fetchWithTimeout } from './helpers.js';
import type { ConnectorContext } from './index.js';

/**
 * Cloudflare AI Search, reached one of two ways:
 *
 *  - **A Worker binding** (`[[ai_search]]` in wrangler config), for an
 *    instance on the same account. No credentials; the default.
 *  - **A public endpoint** — `https://<id>.search.ai.cloudflare.com`, or a
 *    custom domain attached to it — for an instance that already exists
 *    and was exposed from the dashboard. Same request shapes, over fetch.
 *
 * Both expose the same two calls, so a connector does not care which it
 * got. Shared here because two connectors use it and connectors never
 * import one another.
 */

export const aiSearchSourceSchema = z.object({
  /** The `[[ai_search]]` binding name. Ignored when `endpoint` is set. */
  binding: z.string().min(1).max(64).default('AI_SEARCH'),
  /** A public endpoint base URL, e.g. `https://search.example.com`. */
  endpoint: z.string().url().optional(),
});
export type AiSearchSource = z.infer<typeof aiSearchSourceSchema>;

export type AiSearchMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface AiSearchClient {
  /** Resolves to a JSON body, or to a streamed `Response` / `ReadableStream` when `stream` is set. */
  chatCompletions(input: {
    messages: AiSearchMessage[];
    model?: string;
    stream?: boolean;
    ai_search_options?: Record<string, unknown>;
  }): Promise<unknown>;
  search(input: { messages: AiSearchMessage[]; ai_search_options?: Record<string, unknown> }): Promise<unknown>;
}

export function aiSearchClient(
  ctx: Pick<ConnectorContext<unknown>, 'env' | 'fetch'>,
  source: AiSearchSource,
): AiSearchClient {
  if (source.endpoint) return endpointClient(ctx.fetch, source.endpoint);

  const binding = ctx.env[source.binding] as Partial<AiSearchClient> | undefined;
  if (!binding || typeof binding.chatCompletions !== 'function' || typeof binding.search !== 'function') {
    throw new ConnectorError('The assistant is not configured correctly.', {
      retryable: false,
      detail: `ai_search_binding_missing:${source.binding}`,
    });
  }
  return binding as AiSearchClient;
}

/**
 * The REST and public endpoints wrap some bodies in Cloudflare's
 * `{ success, result }` envelope (search does; chat completions, verified
 * 2026-09-24, does not). The binding never does. Accept both.
 */
function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'success' in body && 'result' in body) {
    return (body as { result: unknown }).result;
  }
  return body;
}

function endpointClient(doFetch: typeof fetch, endpoint: string): AiSearchClient {
  const base = endpoint.replace(/\/+$/, '').replace(/\/(chat\/completions|search|mcp)$/, '');

  const post = async (path: string, body: object, stream: boolean) => {
    const response = await fetchWithTimeout(doFetch, `${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const retryable = response.status >= 500 || response.status === 429;
      throw new ConnectorError(
        retryable ? 'The assistant is busy right now. Please try again.' : 'The assistant is unavailable right now.',
        { retryable, detail: `ai_search_${response.status}:${text.slice(0, 200)}` },
      );
    }
    return response;
  };

  return {
    async chatCompletions(input) {
      const response = await post('/chat/completions', input, Boolean(input.stream));
      return input.stream ? response : unwrap(await response.json());
    },
    async search(input) {
      return unwrap(await (await post('/search', input, false)).json());
    },
  };
}

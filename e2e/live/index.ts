// The live-chat Worker's entry: the real Worker, with the config above.
import { createWorker } from '../../packages/server/src/worker.js';
import config from './config.js';

export { CrawlWorkflow } from '../../packages/server/src/workflows/crawl.js';
export { LiveHub } from '../../packages/server/src/live/object.js';

/**
 * The `models` site's knowledge base: a site's own retriever, handed to the
 * Worker exactly as a deployed site's `custom` module is.
 */
const worker = createWorker(config, {
  retrievers: {
    'e2e-docs': {
      id: 'e2e-docs',
      async search(request) {
        return /callout|price|cost/i.test(request.query)
          ? [{ title: 'Prices', url: 'https://acme.example/prices', content: 'Our callout fee is $99, Monday to Friday.', score: 0.9 }]
          : [];
      },
    },
  },
});

/** What the fake model was last sent: for the test to check the key, the model, the tools and streaming. */
let last: Record<string, unknown> = {};

/**
 * A fake OpenAI-compatible API (`/fake-llm/v1/chat/completions`) for the
 * `models` site's model: it answers from the passage when the prompt has one,
 * streamed when asked, as DeepInfra or OpenRouter would.
 */
async function fakeLlm(request: Request, env: Record<string, unknown>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/fake-llm/last') return Response.json(last);
  if (request.headers.get('authorization') !== `Bearer ${String(env['FAKE_LLM_KEY'])}`) return new Response('{"error":"bad key"}', { status: 401 });
  const body = (await request.json()) as { model: string; stream?: boolean; tools?: { function: { name: string } }[]; messages: { role: string; content: string }[] };
  const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
  last = { model: body.model, stream: Boolean(body.stream), tools: (body.tools ?? []).map((t) => t.function.name), passage: system.includes('Our callout fee is $99') };
  const answer = system.includes('Our callout fee is $99') ? 'The callout fee is $99 on weekdays [1].' : 'I’m not sure about that one.';
  if (!body.stream) return Response.json({ choices: [{ message: { role: 'assistant', content: answer } }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
  const frames = [...answer.match(/.{1,6}/gs)!.map((piece) => ({ choices: [{ delta: { content: piece } }] })), { choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 10 } }];
  return new Response(`${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

export default {
  ...worker,
  fetch(request: Request, env: Record<string, unknown>, ctx: Parameters<typeof worker.fetch>[2]) {
    if (new URL(request.url).pathname.startsWith('/fake-llm/')) return fakeLlm(request, env);
    return worker.fetch(request, env, ctx);
  },
};

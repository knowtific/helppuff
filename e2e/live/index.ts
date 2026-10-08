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

/**
 * The owner's API for the tools e2e (`https://tools.e2e.test/…`): the Worker's
 * outgoing calls there are answered here, so a tool calls a real https URL
 * from the test's point of view without leaving the machine.
 */
const realFetch = globalThis.fetch.bind(globalThis);
let lastToolCall: { url: string; authorization: string | null } | null = null;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname !== 'tools.e2e.test') return realFetch(input, init);
  lastToolCall = { url: request.url, authorization: request.headers.get('authorization') };
  if (request.headers.get('authorization') !== 'Bearer e2e-tool-key') return Response.json({ error: 'bad key' }, { status: 401 });
  if (url.pathname === '/crm' && request.method === 'POST') {
    const { email } = (await request.json()) as { email?: string };
    return Response.json({ tier: email?.startsWith('gold') ? 'gold' : 'standard', id: 7, notes: 'internal' });
  }
  const order = /^\/orders\/([\w-]+)$/.exec(url.pathname);
  if (order) return Response.json({ id: order[1], status: 'shipped', eta: 'Friday', warehouse: 'Botany' });
  return Response.json({ error: 'not found' }, { status: 404 });
}) as typeof fetch;

/** What the fake model was last sent, by model id: for the test to check the key, the model, the tools and streaming. */
const last = new Map<string, Record<string, unknown>>();

/**
 * A fake OpenAI-compatible API (`/fake-llm/v1/chat/completions`) for the
 * `models` site's model: it answers from the passage when the prompt has one,
 * streamed when asked, as DeepInfra or OpenRouter would.
 */
async function fakeLlm(request: Request, env: Record<string, unknown>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/fake-llm/last') return Response.json(last.get(url.searchParams.get('model') ?? 'fake-model') ?? {});
  if (url.pathname === '/fake-llm/tool') return Response.json(lastToolCall);
  if (request.headers.get('authorization') !== `Bearer ${String(env['FAKE_LLM_KEY'])}`) return new Response('{"error":"bad key"}', { status: 401 });
  const body = (await request.json()) as { model: string; stream?: boolean; tools?: { function: { name: string } }[]; messages: { role: string; content: string }[] };
  const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
  const tools = (body.tools ?? []).map((t) => t.function.name);
  last.set(body.model, { model: body.model, stream: Boolean(body.stream), tools, passage: system.includes('Our callout fee is $99'), system });
  // An order number and the order tool offered: call it (streamed as tool-call deltas, as OpenAI does).
  const final = body.messages.at(-1)!;
  const orderNumber = final.role === 'user' ? /\b[A-Z]-\d+\b/.exec(final.content)?.[0] : undefined;
  // The order tool, else the extract tool that saves the number.
  const toolName = tools.includes('order_status') ? 'order_status' : tools.includes('order_number') ? 'order_number' : null;
  if (orderNumber && toolName) {
    const call = { index: 0, id: 'call_1', type: 'function', function: { name: toolName, arguments: JSON.stringify({ order_number: orderNumber }) } };
    if (!body.stream) return Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [call] } }] });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  const result = final.role === 'tool' ? (JSON.parse(final.content) as { status?: string; eta?: string; error?: string; saved?: boolean }) : null;
  const answer = result
    ? result.saved
      ? 'Thanks, I have saved your order number.'
      : result.status
      ? `That order is ${result.status}, arriving ${result.eta}.`
      : 'I could not check that order right now.'
    : system.includes('Our callout fee is $99')
      ? 'The callout fee is $99 on weekdays [1].'
      : 'I’m not sure about that one.';
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

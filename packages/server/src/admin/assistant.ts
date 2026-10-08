import { Hono } from 'hono';
import { isConnectorError, type ConnectorContext } from '@helppuff/connector-types';
import { answerModel, knowledgeSource, searchExternalOrThrow, type WorkersAiOptions } from '@helppuff/connector-workers-ai';
import { retrieve, type AiLike, type D1Like, type VectorIndexLike } from '@helppuff/rag';
import { resolveSite } from '../config/site.js';
import { isAssistant, knowledgeOf, providerOf } from '../core/assistant.js';
import { HelpPuffError } from '../core/errors.js';
import type { HonoEnv } from '../core/request.js';
import { prepareConnector } from '../core/run.js';
import { assertAdmin, assertSameOrigin, currentAdmin, jsonBody, siteParam } from './guard.js';

/**
 * `helppuff model test` and `helppuff rag test`: one question through the
 * deployed Worker's own model or knowledge base, as it is configured — keys,
 * gateway, custom modules and all — with how long it took. For checking a
 * change before visitors see it; nothing is recorded.
 */

export const assistantRoutes = new Hono<HonoEnv>();

/** A missing secret, a refused key, an unreachable API: said plainly, for the person setting it up. */
function explain(thrown: unknown): string {
  const detail = isConnectorError(thrown) ? (thrown.detail ?? '') : thrown instanceof HelpPuffError ? (thrown.detail ?? '') : String((thrown as Error)?.message ?? thrown);
  const secret = /missing_secret:(\w+)/.exec(detail)?.[1];
  if (secret) return `${secret} is not set on the Worker. Run \`helppuff secret set ${secret}\`, then \`helppuff deploy\`.`;
  if (/custom_(model|retriever)_missing/.test(detail)) return 'The custom module is not in the deployed Worker. Run `helppuff deploy`.';
  if (/_(401|403):/.test(detail)) return `The provider refused the key (${detail.slice(0, 160)}).`;
  if (/_404:/.test(detail)) return `The provider does not know that model or address (${detail.slice(0, 160)}).`;
  if (/timeout/.test(detail)) return 'The provider took too long to answer.';
  return detail.slice(0, 300) || 'The call failed.';
}

assistantRoutes.post('/assistant/test', async (c) => {
  assertSameOrigin(c);
  assertAdmin(await currentAdmin(c));
  const ctx = c.get('helppuff');
  const body = await jsonBody(c);
  const siteId = siteParam(c, body['site']);
  const site = await resolveSite(ctx, siteId);
  if (!isAssistant(site)) throw new HelpPuffError('bad_request', { message: `This site's ${site.connector.type} backend runs its own model; there is nothing to test here.`, detail: 'assistant_whole_backend' });
  const part = body['part'] === 'knowledge' ? 'knowledge' : 'model';
  const question = typeof body['question'] === 'string' && body['question'].trim() ? body['question'].trim().slice(0, 500) : 'What do you do, in one sentence?';
  const base = { provider: providerOf(site), knowledge: knowledgeOf(site), part };
  const started = Date.now();
  try {
    const prepared = prepareConnector(ctx, site);
    const options = prepared.options as WorkersAiOptions;
    const cctx = {
      options,
      siteId,
      sessionId: 'assistant-test',
      env: ctx.env,
      kv: ctx.platform.kv,
      fetch: globalThis.fetch.bind(globalThis),
      log: (event: string, data?: object) => ctx.platform.log(`assistant_test.${event}`, data),
      waitUntil: ctx.platform.waitUntil,
    } as ConnectorContext<WorkersAiOptions>;

    if (part === 'model') {
      const ai = ctx.env['AI'] && typeof (ctx.env['AI'] as AiLike).run === 'function' ? (ctx.env['AI'] as AiLike) : null;
      const reply = await answerModel(cctx, ai).chat({
        model: options.model,
        messages: [
          { role: 'system', content: 'This is a connection test from the site owner. Answer the question briefly.' },
          { role: 'user', content: question },
        ],
        maxTokens: 120,
        temperature: 0.3,
        reasoning: 'off',
      });
      return c.json({ ...base, ok: true, model: options.model, reply: reply.content.slice(0, 600), usage: reply.usage, ms: Date.now() - started });
    }

    const source = knowledgeSource(cctx);
    if (source.kind === 'none') return c.json({ ...base, ok: true, passages: [], ms: 0, note: 'No knowledge base: answers come from the prompt and the business details.' });
    let passages: { title: string; url: string | null; content: string; score: number }[];
    if (source.kind === 'helppuff') {
      const db = ctx.env['HELPPUFF_DB'] as D1Like | undefined;
      const ai = ctx.env['AI'] as AiLike | undefined;
      if (!db || !ai) throw new HelpPuffError('bad_request', { message: 'This deployment has no knowledge base yet. Run `helppuff deploy`.', detail: 'assistant_no_kb' });
      const vectors = ctx.env['VECTORS'] as VectorIndexLike | undefined;
      const found = await retrieve({ db, ai, vectors: vectors && typeof vectors.query === 'function' ? vectors : null }, siteId, question, { ...options.retrieval, gateway: options.gateway });
      passages = found.chunks.map((p) => ({ title: p.headingPath || p.title, url: p.url || null, content: p.content.slice(0, 400), score: Math.round(p.score * 1000) / 1000 }));
    } else {
      const chunks = await searchExternalOrThrow(source.retriever, { query: question, question, limit: options.retrieval.finalK }, cctx);
      passages = chunks.map((p) => ({ title: p.headingPath || p.title, url: p.url || null, content: p.content.slice(0, 400), score: p.score }));
    }
    return c.json({ ...base, ok: true, passages, ms: Date.now() - started });
  } catch (thrown) {
    return c.json({ ...base, ok: false, error: explain(thrown), ms: Date.now() - started });
  }
});

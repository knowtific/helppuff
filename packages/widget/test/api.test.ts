import { afterEach, describe, expect, it, vi } from 'vitest';
import { STREAM_MEDIA_TYPE, sseFrame } from '@helppuff/protocol/sse';
import { Api, ApiError } from '../src/app/api.js';

/**
 * The transport's two response shapes. A site that streams answers with an
 * event stream; everything else — and any request that did not ask — gets
 * the JSON it always did. The widget must read either from the same call.
 */

const sse = (frames: string[]) =>
  new Response(frames.join(''), { status: 200, headers: { 'Content-Type': `${STREAM_MEDIA_TYPE}; charset=utf-8` } });

const reply = { id: 'm1', ts: 1, role: 'agent', type: 'text', text: 'Hello there' };

function stubFetch(response: Response) {
  const fetch = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const input = { kind: 'text' as const, text: 'hi', clientId: 'c1' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Api.send, streamed', () => {
  it('asks for a stream only when given a preview callback', async () => {
    const fetch = stubFetch(new Response(JSON.stringify({ messages: [reply] }), { headers: { 'Content-Type': 'application/json' } }));
    await new Api('https://api.test', 'demo').send('tok', input);
    const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['Accept']).toBeUndefined();
  });

  it('previews deltas, then resolves with the messages and token from `done`', async () => {
    const fetch = stubFetch(
      sse([sseFrame('delta', { text: 'Hello ' }), sseFrame('delta', { text: 'there' }), sseFrame('done', { messages: [reply], token: 'tok-2' })]),
    );
    const seen: string[] = [];
    const result = await new Api('https://api.test', 'demo').send('tok', input, (text) => seen.push(text));

    const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['Accept']).toBe(STREAM_MEDIA_TYPE);
    expect(seen).toEqual(['Hello ', 'there']);
    expect(result.token).toBe('tok-2');
    expect(result.messages).toMatchObject([{ type: 'text', text: 'Hello there' }]);
  });

  it('reads plain JSON when the server chose not to stream', async () => {
    stubFetch(new Response(JSON.stringify({ messages: [reply] }), { headers: { 'Content-Type': 'application/json', 'X-HelpPuff-Token': 'tok-3' } }));
    const result = await new Api('https://api.test', 'demo').send('tok', input, () => {});
    expect(result.token).toBe('tok-3');
    expect(result.messages).toHaveLength(1);
  });

  it('turns an `error` event into the same error a status code would give', async () => {
    stubFetch(sse([sseFrame('delta', { text: 'Hal' }), sseFrame('error', { code: 'connector_error', message: 'The assistant is busy.' })]));
    const thrown = await new Api('https://api.test', 'demo').send('tok', input, () => {}).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).widgetError).toMatchObject({ code: 'connector_error', message: 'The assistant is busy.', retryable: true });
  });

  it('treats a stream that ends without `done` as a retryable failure', async () => {
    stubFetch(sse([sseFrame('delta', { text: 'Hal' })]));
    const thrown = await new Api('https://api.test', 'demo').send('tok', input, () => {}).catch((e: unknown) => e);
    expect((thrown as ApiError).widgetError.retryable).toBe(true);
  });
});

describe('Api.startSession, streamed', () => {
  it('resolves with the session from `done`', async () => {
    stubFetch(
      sse([
        sseFrame('delta', { text: 'Hi' }),
        sseFrame('done', { sessionToken: 't', sessionId: 's', expiresAt: 9, messages: [reply], capabilities: { poll: false, end: false, stream: true } }),
      ]),
    );
    const seen: string[] = [];
    const result = await new Api('https://api.test', 'demo').startSession(
      { context: { pageUrl: 'https://a.co' }, firstMessage: 'hi' },
      (text) => seen.push(text),
    );
    expect(seen).toEqual(['Hi']);
    expect(result.session).toEqual({ token: 't', id: 's', expiresAt: 9 });
  });
});

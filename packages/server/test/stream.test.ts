import { describe, expect, it } from 'vitest';
import {
  STREAM_MEDIA_TYPE,
  TOKEN_HEADER,
  readSse,
  startSessionResponseSchema,
  streamedSendDoneSchema,
} from '@helppuff/protocol';
import { harness, startBody, startSession, testConfig, testEnv, type Harness } from './helpers.js';

/**
 * Streamed replies, end to end through the real app with the echo connector,
 * which streams its text a word at a time when `stream` is on.
 */

const streaming = () =>
  harness(testConfig({ connector: { type: 'echo', options: { greeting: 'Hello from echo', stream: true } } }));

const ACCEPT = { Accept: STREAM_MEDIA_TYPE };

type Event = { event: string; data: Record<string, unknown> };

async function events(response: Response): Promise<Event[]> {
  const out: Event[] = [];
  await readSse(response.body!, ({ event, data }) => {
    out.push({ event, data: JSON.parse(data) as Record<string, unknown> });
  });
  return out;
}

const previewOf = (list: Event[]) =>
  list
    .filter((e) => e.event === 'delta')
    .map((e) => e.data['text'])
    .join('');

async function send(h: Harness, token: string, text: string, stream = true) {
  return h.post(
    '/v1/sessions/messages',
    { kind: 'text', text, clientId: `c-${text}` },
    { headers: { Authorization: `Bearer ${token}`, ...(stream ? ACCEPT : {}) } },
  );
}

describe('capabilities', () => {
  it('advertise streaming only when the connector has it turned on', async () => {
    type Config = { capabilities: { stream: boolean } };
    const on = (await (await streaming().fetch('/v1/sites/demo/config')).json()) as Config;
    const off = (await (await harness().fetch('/v1/sites/demo/config')).json()) as Config;
    expect(on.capabilities.stream).toBe(true);
    expect(off.capabilities.stream).toBe(false);
  });
});

describe('a streamed session start', () => {
  it('previews the reply text, then sends the usual body as `done`', async () => {
    const h = streaming();
    const response = await h.post('/v1/sites/demo/sessions', { ...startBody, firstMessage: 'hello there' }, { headers: ACCEPT });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain(STREAM_MEDIA_TYPE);

    const list = await events(response);
    expect(previewOf(list)).toBe('You said: **hello there**');
    expect(list.at(-1)?.event).toBe('done');

    const done = startSessionResponseSchema.safeParse(list.at(-1)?.data);
    expect(done.success).toBe(true);
    if (done.success) {
      expect(done.data.capabilities.stream).toBe(true);
      expect(done.data.messages.map((m) => (m.type === 'text' ? m.text : m.type))).toEqual([
        'Hello from echo',
        'You said: **hello there**',
      ]);
    }
  });
});

describe('a streamed send', () => {
  it('previews the reply, and carries the refreshed token in `done`', async () => {
    const h = streaming();
    const { sessionToken } = await startSession(h);

    const response = await send(h, sessionToken, 'first');
    expect(response.headers.get(TOKEN_HEADER)).toBeNull();

    const list = await events(response);
    expect(previewOf(list)).toBe('You said: **first**');
    const done = streamedSendDoneSchema.parse(list.at(-1)?.data);
    expect(done.token).toBeTruthy();

    // The token from `done` is the one that works next.
    const next = await events(await send(h, done.token!, 'second'));
    expect(next.at(-1)?.event).toBe('done');
    expect(previewOf(next)).toBe('You said: **second**');
  });

  it('sends a card whole, in `done`, with no text preview', async () => {
    const h = streaming();
    const { sessionToken } = await startSession(h);
    const list = await events(await send(h, sessionToken, '/card'));
    expect(list.filter((e) => e.event === 'delta')).toHaveLength(0);
    const done = streamedSendDoneSchema.parse(list.at(-1)?.data);
    expect(done.messages[0]?.type).toBe('card');
  });

  it('turns a connector failure after the headers into an `error` event', async () => {
    const h = streaming();
    const { sessionToken } = await startSession(h);
    const response = await send(h, sessionToken, '/error');
    expect(response.status).toBe(200);
    const list = await events(response);
    expect(list.at(-1)).toEqual({
      event: 'error',
      data: { code: 'connector_error', message: 'The assistant is having a moment. Please try again.' },
    });
  });

  it('still fails a request with a plain status when it fails before streaming', async () => {
    const h = streaming();
    const response = await send(h, 'not-a-token', 'hello');
    expect(response.status).toBe(401);
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});

describe('falling back to JSON', () => {
  it('answers JSON when the client did not ask for a stream', async () => {
    const h = streaming();
    const { sessionToken } = await startSession(h);
    const response = await send(h, sessionToken, 'hello', false);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get(TOKEN_HEADER)).toBeTruthy();
  });

  it('answers JSON when the site has streaming off, even if asked', async () => {
    const h = harness(testConfig(), testEnv());
    const { sessionToken } = await startSession(h);
    const response = await send(h, sessionToken, 'hello');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get(TOKEN_HEADER)).toBeTruthy();
  });
});

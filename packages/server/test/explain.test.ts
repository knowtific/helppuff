import { afterEach, describe, expect, it, vi } from 'vitest';
import { explainDetail } from '../src/core/explain.js';
import { createLog } from '../src/core/log.js';
import { OWNER_HEADER, ownerToken } from '../src/core/request.js';
import { harness, SECRET, startSession, testConfig, testEnv } from './helpers.js';

/**
 * Failures are said plainly to the people who can fix them, and logged on
 * every deployment; visitors still get only the safe message.
 */

describe('explainDetail', () => {
  it('names a missing secret and the command that sets it', () => {
    expect(explainDetail('missing_secret:OPENAI_API_KEY')).toEqual({
      reason: 'OPENAI_API_KEY is not set on the Worker.',
      hint: 'helppuff secret set OPENAI_API_KEY, then helppuff deploy',
    });
    expect(explainDetail('unresolved_secret:apiKey:DEEPINFRA_KEY')?.reason).toBe('DEEPINFRA_KEY is not set on the Worker.');
  });

  it("reads a provider's status and what it said", () => {
    const refused = explainDetail('openai_compatible_401:{"error":"invalid key"}');
    expect(refused?.reason).toContain('The model API refused the key (HTTP 401)');
    expect(refused?.reason).toContain('invalid key');
    expect(explainDetail('gemini_generate_404:model not found')?.reason).toContain('Gemini does not know that model');
    expect(explainDetail('openai_respond_429:')?.reason).toContain('out of credit');
    expect(explainDetail('anthropic_503:overloaded')?.reason).toContain('failing on its side');
  });

  it('names the setting behind a limit', () => {
    expect(explainDetail('messages_per_site_per_day')?.hint).toContain('security.limits.messagesPerSitePerDay');
  });

  it('explains Turnstile codes and origins', () => {
    expect(explainDetail('turnstile:invalid-input-secret')?.reason).toContain('secret key');
    expect(explainDetail('origin_not_allowed')?.hint).toContain('origins');
  });

  it('gives nothing for a detail whose message already says it', () => {
    expect(explainDetail('lead_bad_email')).toBeNull();
    expect(explainDetail(undefined)).toBeNull();
  });
});

describe('createLog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('always logs failures, and the rest only with HELPPUFF_LOG', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLog(false);
    log('session.started', { siteId: 'demo' });
    log('record.failed', { reason: 'D1_ERROR: no such table' });
    log('request.error', { code: 'rate_limited', detail: 'messages_per_ip_per_minute' });
    log('request.error', { code: 'internal', detail: 'helppuff_secret_missing' });
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(error.mock.calls[0]![0]))).toMatchObject({ level: 'error', event: 'record.failed', reason: 'D1_ERROR: no such table' });
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ level: 'warn', event: 'request.error', code: 'rate_limited' });
    createLog(true)('session.started', { siteId: 'demo' });
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe('error responses', () => {
  afterEach(() => vi.restoreAllMocks());

  async function failingSend(headers: Record<string, string> = {}) {
    const h = harness(testConfig(), testEnv());
    const { sessionToken } = await startSession(h);
    const response = await h.post('/v1/sessions/messages', { kind: 'text', text: '/error', clientId: 'c1' }, {
      headers: { Authorization: `Bearer ${sessionToken}`, ...headers },
    });
    return { response, body: (await response.json()) as { error: { code: string; message: string; reason?: string; hint?: string } } };
  }

  it('tells the owner what went wrong, and logs it without HELPPUFF_LOG', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { response, body } = await failingSend({ [OWNER_HEADER]: await ownerToken(SECRET) });
    expect(response.status).toBe(502);
    expect(body.error.reason).toContain('echo backend was asked to fail');
    const logged = error.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(logged).toContainEqual(expect.objectContaining({ event: 'request.error', code: 'connector_error', detail: 'echo_forced_error', status: 502 }));
  });

  it('gives a visitor only the safe message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { body } = await failingSend();
    expect(body.error.code).toBe('connector_error');
    expect(body.error.reason).toBeUndefined();
    expect(body.error.hint).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('echo');
  });
});

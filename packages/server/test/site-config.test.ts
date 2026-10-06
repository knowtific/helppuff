import { describe, expect, it } from 'vitest';
import { memoryKv } from '../src/core/platform.js';
import { resolveSite, siteConfigKey } from '../src/config/site.js';
import { ORIGIN, harness, startSession, testConfig, testEnv } from './helpers.js';

/**
 * The bundled `helppuff.config.ts` is compiled into the Worker, so changing it
 * is a deploy. A `config:<siteId>` key in KV overrides it at runtime.
 *
 * The tests that matter most here are the failure ones: a bad paste into KV
 * must degrade to the bundled config, never take a site offline.
 */

async function withStored(siteId: string, value: unknown) {
  const kv = memoryKv();
  await kv.put(siteConfigKey(siteId), typeof value === 'string' ? value : JSON.stringify(value));
  return testEnv({ HELPPUFF_KV: kv });
}

const widgetOverride = {
  widget: { brand: { name: 'From KV', agentName: 'Kay', accent: '#112233' } },
};

describe('a stored config', () => {
  it('overrides the bundled one', async () => {
    const h = harness(testConfig(), await withStored('demo', widgetOverride), ORIGIN);

    const body = (await (await h.fetch('/v1/sites/demo/config')).json()) as {
      widget: { brand: { name: string } };
    };
    expect(body.widget.brand.name).toBe('From KV');
  });

  it('leaves sections it does not mention at their deployed values', async () => {
    const config = testConfig({ sinks: [] });
    const h = harness(config, await withStored('demo', widgetOverride), ORIGIN);

    // `widget` was replaced, but the connector still answers, so the bundled
    // connector section survived the override.
    //
    // The lead carries name *and* phone because replacement is wholesale: this
    // override has no `leadForm`, so the bundled one is gone and the schema
    // default (name + phone, both required) applies instead. That is the
    // intended trade — a section is either yours or the deploy's, never half
    // of each.
    const { response, messages } = await startSession(h, {
      lead: { name: 'Ada', phone: '0400 000 000' },
      context: { pageUrl: 'https://example.com/' },
      firstMessage: 'hello',
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(messages)).toContain('hello');
  });

  it('can swap the connector without a deploy', async () => {
    const h = harness(
      testConfig(),
      await withStored('demo', {
        connector: { type: 'echo', options: { greeting: 'Swapped by KV' } },
      }),
      ORIGIN,
    );

    const { messages } = await startSession(h, {
      lead: { name: 'Ada' },
      context: { pageUrl: 'https://example.com/' },
    });
    expect(JSON.stringify(messages)).toContain('Swapped by KV');
  });

  it('can tighten limits without a deploy', async () => {
    const h = harness(
      testConfig(),
      await withStored('demo', { security: { limits: { maxMessageLength: 5 } } }),
      ORIGIN,
    );

    const { sessionToken } = await startSession(h, {
      lead: { name: 'Ada' },
      context: { pageUrl: 'https://example.com/' },
    });
    const response = await h.post(
      '/v1/sessions/messages',
      { kind: 'text', text: 'far longer than five', clientId: 'c1' },
      { headers: { Authorization: `Bearer ${sessionToken}` } },
    );
    expect(response.status).toBe(400);
  });
});

describe('origins stay in the deploy', () => {
  /*
   * The CORS allowlist is built once when the Worker starts, so an origin
   * added in KV would pass the route check and still be refused by the
   * browser. Rejecting the whole config is the honest failure.
   */
  it('rejects a stored config carrying origins, keeping the bundled one', async () => {
    const h = harness(
      testConfig(),
      await withStored('demo', { origins: ['https://attacker.example'], ...widgetOverride }),
      ORIGIN,
    );

    const response = await h.fetch('/v1/sites/demo/config');
    expect(response.status).toBe(200);
    // The override is discarded wholesale — not partially applied.
    const body = (await response.json()) as { widget: { brand?: { name?: string } } };
    expect(body.widget.brand?.name).not.toBe('From KV');
  });

  it('still reflects CORS only for a deployed origin', async () => {
    const h = harness(testConfig(), await withStored('demo', widgetOverride), null);

    const allowed = await h.fetch('/v1/sites/demo/config', { headers: { Origin: ORIGIN } });
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    const denied = await h.fetch('/v1/sites/demo/config', {
      headers: { Origin: 'https://attacker.example' },
    });
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('a broken stored config', () => {
  it.each([
    ['unparsable JSON', '{ not json at all'],
    ['valid JSON of the wrong shape', JSON.stringify({ widget: 'not-an-object' })],
    ['a JSON array', '[]'],
    ['a JSON string', '"hello"'],
    ['null', 'null'],
    ['an unknown top-level key', JSON.stringify({ ...widgetOverride, nope: true })],
    ['an unknown connector shape', JSON.stringify({ connector: { nope: true } })],
  ])('falls back to the bundled config rather than failing: %s', async (_label, stored) => {
    const h = harness(testConfig(), await withStored('demo', stored), ORIGIN);

    const response = await h.fetch('/v1/sites/demo/config');
    expect(response.status).toBe(200);
    expect(((await response.json()) as { siteId: string }).siteId).toBe('demo');
  });

  it('still 404s a site the bundle has never heard of', async () => {
    const h = harness(testConfig(), await withStored('ghost', widgetOverride), ORIGIN);
    expect((await h.fetch('/v1/sites/ghost/config')).status).toBe(404);
  });

  it('logs which field was wrong without logging its value', async () => {
    const kv = memoryKv();
    await kv.put(
      siteConfigKey('demo'),
      JSON.stringify({ security: { limits: { maxMessageLength: 'twelve' } } }),
    );

    // Driven directly rather than through the app, so the log is injected
    // instead of captured off the console.
    const events: { event: string; data?: object }[] = [];
    const site = await resolveSite(
      {
        config: testConfig(),
        platform: { kv, log: (event, data) => events.push({ event, ...(data ? { data } : {}) }) },
      },
      'demo',
    );

    // Fell back to the bundle rather than applying a half-valid override.
    expect(site.security.limits.maxMessageLength).not.toBe('twelve');

    const invalid = events.find((e) => e.event === 'config.kv_invalid');
    expect((invalid?.data as { issues: string[] } | undefined)?.issues).toContain(
      'security.limits.maxMessageLength',
    );
    // The offending value is never echoed — it could be anything.
    expect(JSON.stringify(events)).not.toContain('twelve');
  });
});

describe('no stored config', () => {
  it('uses the bundled one', async () => {
    const h = harness(testConfig(), testEnv(), ORIGIN);
    expect((await h.fetch('/v1/sites/demo/config')).status).toBe(200);
  });

  it('works with no KV binding at all', async () => {
    const h = harness(testConfig(), testEnv({ HELPPUFF_KV: undefined }), ORIGIN);
    expect((await h.fetch('/v1/sites/demo/config')).status).toBe(200);
  });
});

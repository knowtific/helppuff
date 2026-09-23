import { describe, expect, it } from 'vitest';
import { ORIGIN, harness, testConfig, testEnv } from './helpers.js';

/**
 * `security.captcha` is the only place a captcha is configured. The widget's
 * copy is derived from it, so the two half-configured states — a server that
 * demands a token the widget never sends, and a widget that challenges with
 * nothing verifying it — cannot be reached.
 */

const SITE_KEY = '0x4AAAAAAABkMYinukE8nzY';

const captcha = {
  provider: 'turnstile' as const,
  siteKey: SITE_KEY,
  secret: { env: 'TURNSTILE_SECRET' },
};

async function widgetConfig(config: ReturnType<typeof testConfig>) {
  const h = harness(config, testEnv(), ORIGIN);
  const response = await h.fetch('/v1/sites/demo/config');
  expect(response.status).toBe(200);
  return ((await response.json()) as { widget: { captcha?: { siteKey: string } } }).widget;
}

describe('captcha in the public config', () => {
  it('is derived from security.captcha, so the site key has one home', async () => {
    const widget = await widgetConfig(testConfig({ security: { captcha } }));
    expect(widget.captcha).toEqual({ provider: 'turnstile', siteKey: SITE_KEY });
  });

  it('is absent when no captcha is configured', async () => {
    const widget = await widgetConfig(testConfig());
    expect(widget.captcha).toBeUndefined();
  });

  it('never ships the secret ref to the browser', async () => {
    const widget = await widgetConfig(testConfig({ security: { captcha } }));
    expect(JSON.stringify(widget)).not.toContain('TURNSTILE_SECRET');
    expect(JSON.stringify(widget)).not.toContain('secret');
  });

  it('drops a widget-only captcha rather than challenging with nothing verifying', async () => {
    const widget = await widgetConfig(
      testConfig({ widget: { captcha: { provider: 'turnstile', siteKey: 'orphaned-key' } } }),
    );
    expect(widget.captcha).toBeUndefined();
  });

  it('lets security.captcha win over a stale widget.captcha', async () => {
    const widget = await widgetConfig(
      testConfig({
        security: { captcha },
        widget: { captcha: { provider: 'turnstile', siteKey: 'stale-key' } },
      }),
    );
    expect(widget.captcha?.siteKey).toBe(SITE_KEY);
  });
});

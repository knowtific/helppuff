import { expect, test, type Page } from '@playwright/test';
import {
  captureConsole,
  composer,
  expectInertApi,
  expectNoWidgetInDom,
  hostFingerprint,
  launcher,
  openWidget,
  panel,
  send,
  startConversation,
} from './helpers.js';

/**
 * The fail-safe is the highest-priority behavioural requirement, so it
 * gets its own suite: every fatal condition forced individually, each leaving
 * the DOM clean, `window.Murmur` callable and inert, the console silent and
 * the host page untouched.
 *
 * And the other half of the rule: a recoverable failure must NOT hide the
 * widget or lose the visitor's typed message.
 */

/** Install a fetch interceptor before the loader runs. */
async function breakConfig(page: Page, mode: 'status' | 'timeout' | 'malformed' | 'notjson' | 'network') {
  await page.addInitScript((kind) => {
    const real = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String((input as Request)?.url ?? input);
      if (url.includes('/config')) {
        if (kind === 'status') return new Response('{"error":{"code":"not_found","message":"no"}}', { status: 404 });
        if (kind === 'malformed') return new Response('{"widget":"not-an-object"}', { status: 200 });
        if (kind === 'notjson') return new Response('<html>502 Bad Gateway</html>', { status: 200 });
        if (kind === 'network') throw new TypeError('Failed to fetch');
        // Never settles — the widget's own 6s AbortController must fire.
        return new Promise<Response>(() => {});
      }
      return real(input, init);
    };
  }, mode);
}

async function expectCleanlyHidden(page: Page, before: Awaited<ReturnType<typeof hostFingerprint>>) {
  await expectNoWidgetInDom(page);
  await expectInertApi(page);

  const after = await hostFingerprint(page);
  expect(after.headStyles).toBe(before.headStyles);
  expect(after.bodyClass).toBe(before.bodyClass);
  expect(after.bodyOverflow).toBe(before.bodyOverflow);
  expect(after.wrapWidth).toBe(before.wrapWidth);
  expect(after.bodyChildTags).toBe(before.bodyChildTags);
}

test.describe('fatal conditions hide the widget silently', () => {
  test('missing data-site', async ({ page }) => {
    const { errors } = captureConsole(page);
    await page.goto('/?fail=site');
    const before = await hostFingerprint(page);
    await page.waitForTimeout(1500);

    await expectCleanlyHidden(page, before);
    expect(errors).toEqual([]);
  });

  test('/config returns 404', async ({ page }) => {
    const { errors } = captureConsole(page);
    await breakConfig(page, 'status');
    await page.goto('/');
    const before = await hostFingerprint(page);
    await page.waitForTimeout(1500);

    await expectCleanlyHidden(page, before);
    expect(errors).toEqual([]);
  });

  test('/config never responds — the 6s timeout fires', async ({ page }) => {
    await breakConfig(page, 'timeout');
    await page.goto('/');
    const before = await hostFingerprint(page);

    // Nothing is shown while it is still pending.
    await page.waitForTimeout(1000);
    await expectNoWidgetInDom(page);

    // After the abort, still nothing — and no retry.
    await page.waitForTimeout(7000);
    await expectCleanlyHidden(page, before);
  });

  test('/config returns a body that fails validation', async ({ page }) => {
    await breakConfig(page, 'malformed');
    await page.goto('/');
    const before = await hostFingerprint(page);
    await page.waitForTimeout(1500);
    await expectCleanlyHidden(page, before);
  });

  test('/config returns HTML instead of JSON', async ({ page }) => {
    await breakConfig(page, 'notjson');
    await page.goto('/');
    const before = await hostFingerprint(page);
    await page.waitForTimeout(1500);
    await expectCleanlyHidden(page, before);
  });

  test('the network is unreachable', async ({ page }) => {
    await breakConfig(page, 'network');
    await page.goto('/');
    const before = await hostFingerprint(page);
    await page.waitForTimeout(1500);
    await expectCleanlyHidden(page, before);
  });

  test('the server is switched off entirely', async ({ page }) => {
    // Point the widget at a port with nothing on it.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        for (const s of document.querySelectorAll('script[data-site]')) {
          s.setAttribute('data-api', 'http://localhost:9');
        }
      });
    });
    const { errors } = captureConsole(page);
    await page.goto('/');
    const before = await hostFingerprint(page);
    await page.waitForTimeout(3000);

    await expectCleanlyHidden(page, before);
    expect(errors).toEqual([]);
  });

  test('the app chunk cannot be imported', async ({ page }) => {
    // Let /config through, block the app module.
    await page.route('**/app/index.tsx*', (route) => route.abort());
    await page.route('**/app-*.js', (route) => route.abort());

    await page.goto('/');
    const before = await hostFingerprint(page);
    await expect(launcher(page)).toBeVisible();

    // Clicking forces the import, which fails — so the widget removes itself.
    await launcher(page).click();
    await page.waitForTimeout(2000);
    await expectCleanlyHidden(page, before);
  });

  test('attachShadow is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-expect-error deliberately removing a required API
      delete Element.prototype.attachShadow;
    });
    const { errors } = captureConsole(page);
    await page.goto('/');
    const before = await hostFingerprint(page);
    await page.waitForTimeout(1500);

    await expectCleanlyHidden(page, before);
    expect(errors).toEqual([]);
  });

  test('a fatal error leaves localStorage untouched, so a later load can restore', async ({ page }) => {
    // Build a real session first.
    await page.goto('/');
    await openWidget(page);
    await startConversation(page);
    await send(page, 'keep this');
    await page.waitForTimeout(500);
    const stored = await page.evaluate(() => localStorage.getItem('mm:demo'));
    expect(stored).toBeTruthy();

    // Now force a fatal condition on the next load.
    await breakConfig(page, 'status');
    await page.reload();
    await page.waitForTimeout(1500);
    await expectNoWidgetInDom(page);

    // The fail-safe: storage is left alone.
    expect(await page.evaluate(() => localStorage.getItem('mm:demo'))).toBe(stored);
  });
});

test.describe('recoverable failures do NOT hide the widget', () => {
  test('a failed send keeps the panel, the thread and the typed message', async ({ page }) => {
    await page.goto('/');
    await openWidget(page);
    await startConversation(page);
    await send(page, 'hello');

    // Break only the message endpoint, after the session exists.
    await page.route('**/v1/sessions/messages', (route) => route.abort());
    await send(page, 'this will fail');

    await expect(page.locator('murmur-widget [role="alert"]')).toBeVisible();
    // The widget is still here.
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('murmur-widget')).toHaveCount(1);
    // And the message is not lost.
    await expect(composer(page)).toHaveValue('this will fail');
  });

  test('a 500 from the server shows a notice, not a disappearance', async ({ page }) => {
    await page.goto('/');
    await openWidget(page);
    await startConversation(page);

    await page.route('**/v1/sessions/messages', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Something went wrong on our end.' } }),
      }),
    );
    await send(page, 'boom');

    await expect(page.locator('murmur-widget [role="alert"]')).toContainText(/went wrong/i);
    await expect(panel(page)).toBeVisible();
  });

  test('a rate limit shows a countdown and recovers', async ({ page }) => {
    await page.goto('/');
    await openWidget(page);
    await startConversation(page);

    let first = true;
    await page.route('**/v1/sessions/messages', (route) => {
      if (first) {
        first = false;
        return route.fulfill({
          status: 429,
          contentType: 'application/json',
          headers: { 'retry-after': '2' },
          body: JSON.stringify({
            error: { code: 'rate_limited', message: 'Too many messages. Try again shortly.', retryAfter: 2 },
          }),
        });
      }
      return route.continue();
    });

    await send(page, 'too fast');
    const alert = page.locator('murmur-widget [role="alert"]');
    await expect(alert).toContainText(/too many/i);
    await expect(alert).toContainText(/\(2s\)/);

    // Once the countdown ends the retry is offered again.
    await expect(page.locator('murmur-widget [role="alert"] button', { hasText: /try again/i })).toBeEnabled({
      timeout: 6000,
    });
  });

  test('going offline is reported without losing the conversation', async ({ page, context }) => {
    await page.goto('/');
    await openWidget(page);
    await startConversation(page);
    await send(page, 'before offline');

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    await expect(page.locator('murmur-widget .mm-offline')).toBeVisible();
    await expect(panel(page)).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('murmur-widget .mm-offline')).toBeHidden();
  });
});

test.describe('diagnostics', () => {
  test('debug() reports state without being enabled by default', async ({ page }) => {
    await page.goto('/');
    await expect(launcher(page)).toBeVisible();

    const info = await page.evaluate(() =>
      (window as never as { Murmur: { debug(): Record<string, unknown> } }).Murmur.debug(),
    );
    expect(info).toHaveProperty('version');
    expect(info).toHaveProperty('siteId', 'demo');
  });

  test('?mmdebug=1 turns on logging for that page view only', async ({ page }) => {
    const quiet = captureConsole(page);
    await page.goto('/');
    await expect(launcher(page)).toBeVisible();
    expect(quiet.messages.filter((m) => m.includes('[murmur]'))).toEqual([]);

    const loud = captureConsole(page);
    await page.goto('/?mmdebug=1&fail=config');
    await page.waitForTimeout(1500);
    expect(loud.messages.some((m) => m.includes('[murmur]'))).toBe(true);
  });
});

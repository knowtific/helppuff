import { expect, test, type Page } from '@playwright/test';
import { agentMessages, launcher, openWidget, panel, startConversation } from './helpers.js';

/**
 * The isolation suite. The widget is embedded in deliberately hostile host
 * pages and must look and behave identically in all of them, while leaving
 * the host page visually and functionally unchanged.
 */

const FIXTURES = [
  ['aggressive CSS', '/fixtures/aggressive-css.html'],
  ['prototype patching', '/fixtures/prototype-patching.html'],
  ['double include', '/fixtures/double-include.html'],
  ['SPA routing', '/fixtures/spa.html'],
] as const;

/** Computed styles the host page tries hardest to corrupt. */
async function widgetStyle(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('murmur-widget')?.shadowRoot;
    const orb = root?.querySelector('.mm-orb') as HTMLElement | null;
    if (!orb) return null;
    const style = getComputedStyle(orb);
    const box = orb.getBoundingClientRect();
    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      borderRadius: style.borderRadius,
      display: style.display,
      direction: style.direction,
      // A host page's font and colour must not reach inside.
      fontFamily: style.fontFamily.split(',')[0]?.trim().replace(/"/g, ''),
    };
  });
}

test.describe('the widget survives hostile host pages', () => {
  for (const [name, url] of FIXTURES) {
    test(`renders and works under ${name}`, async ({ page }) => {
      await page.goto(url);
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      // The orb is visible and correctly sized despite `button { display: none }`
      // and `* { all: unset }`. Its width follows the configured shape, so the
      // height is what is fixed; the cross-fixture comparison below is what
      // proves the host page changed nothing.
      await expect(launcher(page)).toBeVisible();
      const style = await widgetStyle(page);
      expect(style?.height, 'orb height').toBe(56);
      expect(style?.width, 'orb width').toBeGreaterThan(55);
      expect(style?.display).toBe('grid');
      expect(style?.fontFamily).not.toMatch(/comic/i);

      // And a full conversation still works.
      await openWidget(page);
      await startConversation(page);
      await expect(agentMessages(page).first()).toBeVisible();
    });
  }

  test('the orb renders identically across every fixture', async ({ page }) => {
    const seen: Array<Record<string, unknown> | null> = [];
    for (const [, url] of FIXTURES) {
      await page.goto(url);
      await expect(launcher(page)).toBeVisible();
      seen.push(await widgetStyle(page));
    }
    for (const style of seen.slice(1)) {
      expect(style).toEqual(seen[0]);
    }
  });
});

test.describe('the host page is left alone', () => {
  test('a page that hides every button keeps hiding its own', async ({ page }) => {
    await page.goto('/fixtures/aggressive-css.html');
    await expect(launcher(page)).toBeVisible();

    // The host's own rules still apply to the host's own elements.
    const hostProbe = await page.locator('.host-probe').evaluate((el) => ({
      color: getComputedStyle(el).color,
      direction: getComputedStyle(el).direction,
    }));
    expect(hostProbe.color).toBe('rgb(255, 0, 255)');
    expect(hostProbe.direction).toBe('rtl');
  });

  test('no globals are patched and nothing lands in document.head', async ({ page }) => {
    await page.goto('/fixtures/prototype-patching.html');
    await expect(launcher(page)).toBeVisible();
    await openWidget(page);
    await startConversation(page);

    const report = await page.evaluate(() => ({
      // The host's own fetch wrapper must still be the one in place.
      fetchPatchedByHost: String(window.fetch).includes('__fetchCalls'),
      fetchUsed: (window as never as { __fetchCalls?: number }).__fetchCalls ?? 0,
      // The widget must not touch history.
      pushCalls: (window as never as { __pushCalls?: number }).__pushCalls ?? 0,
      headStyles: document.head.querySelectorAll('style,link[rel=stylesheet]').length,
      // Exactly one global. `__MURMUR_*` are Vite's build-time constants,
      // which exist only on the dev server — the shipped bundle inlines them,
      // which `e2e/bundle.spec.ts` asserts against dist/.
      murmurGlobals: Object.keys(window).filter((k) => /murmur/i.test(k) && !k.startsWith('__')),
      // Silent at default verbosity.
      consoleCalls: (window as never as { __consoleCalls?: number }).__consoleCalls ?? 0,
    }));

    expect(report.fetchPatchedByHost, 'widget must not replace window.fetch').toBe(true);
    expect(report.fetchUsed, 'widget should go through the page fetch').toBeGreaterThan(0);
    expect(report.pushCalls, 'widget must not call history.pushState').toBe(0);
    expect(report.headStyles).toBe(0);
    expect(report.murmurGlobals).toEqual(['Murmur']);
    expect(report.consoleCalls).toBe(0);
  });

  test('including the script twice creates exactly one widget', async ({ page }) => {
    await page.goto('/fixtures/double-include.html');
    await expect(launcher(page)).toBeVisible();
    await expect(page.locator('murmur-widget')).toHaveCount(1);

    await openWidget(page);
    await expect(panel(page)).toHaveCount(1);
  });
});

test.describe('SPA navigation', () => {
  test('the widget survives client-side routing', async ({ page }) => {
    await page.goto('/fixtures/spa.html');
    await expect(launcher(page)).toBeVisible();

    await openWidget(page);
    await startConversation(page);
    await expect(agentMessages(page).first()).toBeVisible();

    // Navigate without a page load.
    await page.locator('#nav-pricing').click();
    await expect(page.locator('#route')).toHaveText('/fixtures/pricing');

    // Still there, still the same conversation.
    await expect(panel(page)).toBeVisible();
    await expect(agentMessages(page).first()).toBeVisible();
    await expect(page.locator('murmur-widget')).toHaveCount(1);

    await page.locator('#nav-home').click();
    await expect(page.locator('murmur-widget')).toHaveCount(1);
  });
});

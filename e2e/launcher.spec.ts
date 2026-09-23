import { expect, test, type Page } from '@playwright/test';
import { launcher, openWidget, panel } from './helpers.js';

/** The configurable launcher (icon, label, shape) and the teaser triggers. */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.describe('the launcher', () => {
  test('a pill puts the configured label inside the button', async ({ page }) => {
    const orb = page.locator('murmur-widget .mm-orb');
    await expect(orb).toBeVisible();
    await expect(orb).toHaveAttribute('data-shape', 'pill');
    await expect(orb).toContainText('Chat with us!');
    await expect(orb).toHaveAccessibleName('Chat with us!');

    // Wide enough to be a pill, not a circle.
    expect(await orb.evaluate((el) => (el as HTMLElement).offsetWidth)).toBeGreaterThan(100);
  });

  test('the configured icon is painted by the loader, before the app exists', async ({ page }) => {
    // Block the app chunk entirely: whatever renders is the loader's work.
    await page.route('**/app/index.tsx*', (route) => route.abort());
    await page.goto('/');

    const orb = page.locator('murmur-widget .mm-orb');
    await expect(orb).toContainText('Chat with us!');
    await expect(orb.locator('svg path')).toHaveCount(1);
  });

  test('the pill collapses to a circle once open, so the close glyph stands alone', async ({ page }) => {
    const orb = page.locator('murmur-widget .mm-orb');
    const wide = await orb.evaluate((el) => (el as HTMLElement).offsetWidth);

    await openWidget(page);
    await expect(orb).not.toHaveAttribute('data-shape', 'pill');
    expect(await orb.evaluate((el) => (el as HTMLElement).offsetWidth)).toBeLessThan(wide);
    await expect(panel(page)).toBeVisible();
  });
});

test.describe('the teaser', () => {
  const teaser = (page: Page) => page.locator('murmur-widget .mm-teaser');

  test('appears once the visitor has scrolled far enough', async ({ page }) => {
    await expect(launcher(page)).toBeVisible();
    await expect(teaser(page)).toBeHidden();

    // The demo triggers at 25%, well before its 8s timer.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.4));
    await expect(teaser(page)).toBeVisible({ timeout: 8000 });
    await expect(teaser(page)).toContainText('Questions?');
  });

  test('opens the panel when tapped, and stops offering itself', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5));
    await expect(teaser(page)).toBeVisible({ timeout: 8000 });

    await teaser(page).getByText('Questions?').click();
    await expect(panel(page)).toBeVisible();
    await expect(teaser(page)).toBeHidden();
  });

  test('can be dismissed without opening the widget', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5));
    await expect(teaser(page)).toBeVisible({ timeout: 8000 });

    await teaser(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(teaser(page)).toBeHidden();
    await expect(panel(page)).toBeHidden();

    // And it does not come back on further scrolling.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1000);
    await expect(teaser(page)).toBeHidden();
  });

  test('never appears once a conversation is under way', async ({ page }) => {
    await openWidget(page);
    await page.locator('murmur-widget .mm-btn').first().click();
    await page.locator('murmur-widget #mm-f-name').fill('Ada');
    await page.locator('murmur-widget #mm-f-email').fill('ada@example.com');
    await page.locator('murmur-widget #mm-f-phone').fill('0400 000 000');
    await page.locator('murmur-widget button[type="submit"]').click();
    await expect(page.locator('murmur-widget .mm-agent').first()).toBeVisible();

    await page.evaluate(() => (window as never as { Murmur: { close(): void } }).Murmur.close());
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1500);
    await expect(teaser(page)).toBeHidden();
  });
});

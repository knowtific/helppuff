import { expect, test, type Page } from '@playwright/test';
import { launcher } from './helpers.js';

/**
 * Smoke tests for the demo surfaces themselves.
 *
 * These exist because a broken asset path made the gallery render a blank
 * page while every other test still passed — the suite tested the widget, not
 * the pages that show it. A 404 on any demo asset now fails the build.
 */

/** Collect failed requests and uncaught errors for the whole page load. */
function watch(page: Page) {
  const notFound: string[] = [];
  const errors: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) notFound.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    // Deliberately aborted routes in other specs are not in play here.
    notFound.push(`failed ${request.url()}`);
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return { notFound, errors };
}

test.describe('the playground', () => {
  test('loads with no missing assets and mounts the widget', async ({ page }) => {
    const { notFound, errors } = watch(page);
    await page.goto('/', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Murmur playground' })).toBeVisible();
    await expect(launcher(page)).toBeVisible();
    expect(notFound).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('reports the worker as up', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#server-status')).toHaveAttribute('data-up', 'yes');
  });
});

test.describe('the component gallery', () => {
  test('loads with no missing assets and no uncaught errors', async ({ page }) => {
    const { notFound, errors } = watch(page);
    await page.goto('/gallery.html', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Murmur component gallery' })).toBeVisible();
    expect(notFound).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('renders every specimen into a populated shadow root', async ({ page }) => {
    await page.goto('/gallery.html', { waitUntil: 'networkidle' });

    const specimens = page.locator('figure.spec');
    await expect(specimens).not.toHaveCount(0);

    const empty = await page.evaluate(() =>
      [...document.querySelectorAll('figure.spec')]
        .map((figure) => ({
          title: figure.querySelector('figcaption b')?.textContent ?? '(untitled)',
          host: figure.querySelector('.shadow-host'),
        }))
        // The mobile specimen is an iframe, not a shadow host.
        .filter(({ host }) => host !== null)
        .filter(({ host }) => (host as Element).shadowRoot?.childElementCount !== 1)
        .map(({ title }) => title),
    );
    expect(empty, 'every specimen must mount exactly one root').toEqual([]);
  });

  test('shows the key surfaces, rendered by the real components', async ({ page }) => {
    await page.goto('/gallery.html', { waitUntil: 'networkidle' });

    // A representative sample across the sections.
    for (const text of [
      'Ask us', // launcher label
      'Hi there', // home
      'Before we start', // lead form
      "Hi — I'm Alex. What can I help with today?", // conversation
      'Too many messages. Try again shortly.', // error states
      "You're offline", // composer
    ]) {
      await expect(page.locator('.shadow-host').filter({ hasText: text }).first()).toBeVisible();
    }
  });

  test('the accent picker retints the specimens', async ({ page }) => {
    await page.goto('/gallery.html', { waitUntil: 'networkidle' });

    const accentOf = () =>
      page.evaluate(() => {
        const host = document.querySelector('.shadow-host') as HTMLElement;
        const orb = host.shadowRoot?.querySelector('.mm-orb') as HTMLElement;
        return getComputedStyle(orb).backgroundColor;
      });

    const before = await accentOf();
    await page.locator('.swatches button').nth(1).click();
    await expect.poll(accentOf).not.toBe(before);
  });

  test('the mobile frame loads', async ({ page }) => {
    await page.goto('/gallery.html', { waitUntil: 'networkidle' });
    const frame = page.frameLocator('iframe[title="Mobile"]');
    await expect(frame.locator('.mm-panel')).toBeVisible();
  });
});

test.describe('the hostile fixtures', () => {
  for (const name of ['aggressive-css', 'prototype-patching', 'double-include', 'spa']) {
    test(`${name} loads its embed script`, async ({ page }) => {
      const { notFound } = watch(page);
      await page.goto(`/fixtures/${name}.html`, { waitUntil: 'networkidle' });

      await expect(launcher(page)).toBeVisible();
      expect(notFound).toEqual([]);
    });
  }
});

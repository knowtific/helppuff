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

    await expect(page.getByRole('heading', { name: 'HelpPuff playground' })).toBeVisible();
    await expect(launcher(page)).toBeVisible();
    expect(notFound).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('reports the worker as up', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#server-status')).toHaveAttribute('data-up', 'yes');
    await expect(page.locator('#server-status')).toContainText('worker up');
  });

  test('reports a worker that refuses connections', async ({ page }) => {
    await page.route('**/healthz', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('#server-status')).toHaveAttribute('data-up', 'no');
    await expect(page.locator('#server-status')).toContainText('worker down');
  });

  test('reports a worker that accepts but never answers', async ({ page }) => {
    // Regression: unbounded, the badge sat on "checking…" for ever, which
    // reads as "still working" rather than "broken".
    await page.route('**/healthz', () => {
      /* hang, exactly as a wedged workerd does */
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#server-status')).toHaveAttribute('data-up', 'no', { timeout: 10_000 });
    await expect(page.locator('#server-status')).toContainText('not responding');
  });
});

/**
 * The options playground, which is also the hosted demo on GitHub Pages: the
 * real widget in a frame, answered by an in-page API, so it must work with no
 * Worker at all.
 */
test.describe('the options playground', () => {
  const preview = (page: Page) => page.frameLocator('iframe[title="Widget preview"]');
  /** On a phone the preview sits below the options; bring all of it on screen. */
  const showPreview = (page: Page) =>
    page.locator('iframe[title="Widget preview"]').evaluate((frame) => frame.scrollIntoView({ block: 'end' }));

  test.beforeEach(async ({ page }) => {
    // Prove it: nothing may reach the local Worker.
    await page.route('http://localhost:8787/**', (route) => route.abort());
  });

  test('loads with no missing assets and mounts the widget without a server', async ({ page }) => {
    const { notFound, errors } = watch(page);
    await page.goto('/playground.html', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'HelpPuff playground' })).toBeVisible();
    await expect(preview(page).locator('helppuff-widget .hp-orb')).toBeVisible();
    expect(notFound.filter((line) => !line.includes('localhost:8787'))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('an option change rebuilds the preview', async ({ page }) => {
    await page.goto('/playground.html');
    await page.getByRole('textbox', { name: 'Label', exact: true }).fill('Talk to us');
    await expect(preview(page).locator('helppuff-widget').getByText('Talk to us')).toBeVisible();
  });

  test('chats through the in-page API', async ({ page }) => {
    await page.goto('/playground.html');
    await page.getByLabel('Start from').selectOption('minimal');
    const frame = preview(page);
    // Wait for the preview built from the preset.
    await expect(frame.locator('helppuff-widget .hp-orb')).toHaveAttribute('aria-label', 'Chat with Acme');
    await showPreview(page);
    await frame.locator('helppuff-widget .hp-orb').click();
    await frame.locator('helppuff-widget .hp-btn').first().click();
    await frame.locator('helppuff-widget .hp-composer textarea').fill('hello there');
    await frame.locator('helppuff-widget .hp-send').click();
    await expect(frame.locator('helppuff-widget .hp-agent').last()).toContainText('You said: hello there');
  });

  test('flags an invalid config instead of applying it', async ({ page }) => {
    await page.goto('/playground.html');
    await page.getByRole('tab', { name: 'JSON' }).click();
    await page.getByLabel('Widget config JSON').fill('{ "brand": { "accent": "red" } }');
    await expect(page.getByRole('alert').first()).toContainText('widget.brand.accent');
  });

  test('a shared link restores the setup', async ({ page }) => {
    await page.goto('/playground.html');
    await page.getByLabel('Business name').fill('Northwind');
    await expect(page).toHaveURL(/#c=/);
    const link = page.url();
    await page.goto('about:blank');
    await page.goto(link);
    await expect(page.getByLabel('Business name')).toHaveValue('Northwind');
  });

  test('every option is in the reference', async ({ page }) => {
    await page.goto('/playground.html');
    await page.getByRole('tab', { name: 'Reference' }).click();
    await page.getByLabel('Filter options').fill('teaser.afterScroll');
    await expect(page.locator('.ref-row')).toHaveCount(1);
  });
});

test.describe('the component gallery', () => {
  test('loads with no missing assets and no uncaught errors', async ({ page }) => {
    const { notFound, errors } = watch(page);
    await page.goto('/gallery.html', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'HelpPuff component gallery' })).toBeVisible();
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
        const orb = host.shadowRoot?.querySelector('.hp-orb') as HTMLElement;
        return getComputedStyle(orb).backgroundColor;
      });

    const before = await accentOf();
    await page.locator('.swatches button').nth(1).click();
    await expect.poll(accentOf).not.toBe(before);
  });

  test('the mobile frame loads', async ({ page }) => {
    await page.goto('/gallery.html', { waitUntil: 'networkidle' });
    const frame = page.frameLocator('iframe[title="Mobile"]');
    await expect(frame.locator('.hp-panel')).toBeVisible();
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

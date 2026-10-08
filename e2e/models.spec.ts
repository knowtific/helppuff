import { expect, test } from '@playwright/test';
import { composer, sendButton, thread } from './helpers';

/**
 * Another model and the site's own knowledge base, end to end in a real
 * Worker (:8796, e2e/live): the `models` site's answers are written by an
 * OpenAI-compatible API (a fake one, served by the same Worker) from the
 * passages its custom retriever returns, streamed to the widget and cited.
 */

const WORKER = 'http://localhost:8796';

// Both tests read what the one fake model was last sent: one at a time.
test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'one browser is enough');

test('an OpenAI-compatible model answers from the site’s own retriever, streamed and cited', async ({ page, request }) => {
  await page.goto(`${WORKER}/models.html`);
  await expect(page.locator('helppuff-widget .hp-panel')).toBeVisible();
  await page.locator('helppuff-widget .hp-btn').first().click();
  await expect(composer(page)).toBeVisible();
  await composer(page).fill('How much is a callout?');
  await sendButton(page).click();

  await expect(thread(page)).toContainText('The callout fee is $99 on weekdays.');
  // The cited passage is a source link; the citation marker never shows.
  await expect(page.locator('helppuff-widget a', { hasText: 'Prices' })).toHaveAttribute('href', 'https://acme.example/prices');
  await expect(thread(page)).not.toContainText('[1]');

  // The model was called with its key (else it refuses), the site's model id, the assistant's tools, streaming, and the passage.
  const last = (await (await request.get(`${WORKER}/fake-llm/last`)).json()) as Record<string, unknown>;
  expect(last).toMatchObject({ model: 'fake-model', stream: true, passage: true });
  expect(last['tools']).toContain('request_callback');
});

test('says it is not sure when the knowledge base has nothing', async ({ page }) => {
  await page.goto(`${WORKER}/models.html`);
  await expect(page.locator('helppuff-widget .hp-panel')).toBeVisible();
  await page.locator('helppuff-widget .hp-btn').first().click();
  await composer(page).fill('Do you sell bicycles?');
  await sendButton(page).click();
  await expect(thread(page)).toContainText('I’m not sure about that one.');
});

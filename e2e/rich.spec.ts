import { expect, test } from '@playwright/test';
import { agentMessages, composer, openWidget, panel, send, startConversation, thread, userMessages } from './helpers.js';

/** M4: the rich message types, shortcuts and client-side flows. */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.describe('rich messages', () => {
  test('/options renders chips that send the chosen value', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, '/options');

    const chips = page.locator('helppuff-widget .hp-chips .hp-chip');
    await expect(chips).toHaveCount(3);

    await chips.filter({ hasText: 'Get a quote' }).click();
    await expect(userMessages(page).last()).toHaveText('Get a quote');
    await expect(agentMessages(page).last()).toContainText('Get a quote');

    // Answered chips stay visible but go inert, so the thread reads as a record.
    await expect(chips.first()).toBeDisabled();
  });

  test('/multi collects a set and confirms once', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, '/multi');

    const confirm = page.locator('helppuff-widget .hp-confirm');
    await expect(confirm).toBeDisabled();

    await page.locator('helppuff-widget .hp-chips .hp-chip', { hasText: 'Leaking tap' }).click();
    await page.locator('helppuff-widget .hp-chips .hp-chip', { hasText: 'Hot water' }).click();
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(userMessages(page).last()).toHaveText('Leaking tap, Hot water');
  });

  test('/card renders an image, body and three kinds of action', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, '/card');

    const card = page.locator('helppuff-widget .hp-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Emergency callout' })).toBeVisible();
    await expect(card.locator('img')).toHaveAttribute('alt', 'A service van');
    await expect(card.getByRole('link', { name: /Call now/ })).toHaveAttribute('href', 'tel:+61400000000');
    await expect(card.getByRole('link', { name: /Details/ })).toHaveAttribute('target', '_blank');

    await card.getByRole('button', { name: 'Book it' }).click();
    await expect(userMessages(page).last()).toHaveText('Book it');
  });

  test('/carousel renders three scroll-snapped cards', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, '/carousel');
    await expect(page.locator('helppuff-widget .hp-carousel-item')).toHaveCount(3);
    await expect(page.locator('helppuff-widget .hp-carousel')).toHaveAttribute('role', 'group');
  });

  test('the carousel can be driven by its arrows, which bound at each end', async ({ page }) => {
    test.skip(Boolean(test.info().project.use.isMobile), 'arrows are for pointer devices; touch swipes');

    await openWidget(page);
    await startConversation(page);
    await send(page, '/carousel');

    const track = page.locator('helppuff-widget .hp-carousel');
    const prev = page.locator('helppuff-widget .hp-carousel-nav[data-dir="prev"]');
    const next = page.locator('helppuff-widget .hp-carousel-nav[data-dir="next"]');
    const offset = () => track.evaluate((el) => Math.round(el.scrollLeft));

    // The scrollbar is hidden by design, so the arrows are the only
    // affordance a mouse user has — without them cards 2 and 3 are stranded.
    await expect(track).toHaveCSS('overflow-x', 'auto');
    expect(await track.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();
    expect(await offset()).toBe(0);

    // Scrolling is smooth, so a click mid-animation compounds from a moving
    // position; wait for it to come to rest between presses.
    const settle = async () => {
      let previous = -1;
      await expect
        .poll(async () => {
          const now = await offset();
          const stable = now === previous;
          previous = now;
          return stable;
        })
        .toBe(true);
    };

    await page.locator('helppuff-widget .hp-carousel-wrap').hover();
    await next.click();
    await settle();
    await expect.poll(offset).toBeGreaterThan(0);

    await next.click();
    await settle();
    await expect(next).toBeDisabled();
    await expect(prev).toBeEnabled();

    await prev.click();
    await settle();
    await expect(next).toBeEnabled();
  });

  test('a carousel that fits shows no arrows at all', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, '/card');
    // A single card is not a carousel, so nothing to navigate.
    await expect(page.locator('helppuff-widget .hp-carousel-nav')).toHaveCount(0);
  });

  test('/links renders rows with safe hrefs', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, '/links');

    const rows = page.locator('helppuff-widget .hp-thread .hp-link-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute('rel', /noopener/);
    await expect(rows.last()).toHaveAttribute('href', 'mailto:hello@example.com');
  });

  test('/form submits structured data with a readable label', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, '/form');

    const form = page.locator('helppuff-widget .hp-inline-form');
    await expect(form).toBeVisible();

    // The required field blocks submission.
    await form.getByRole('button', { name: 'Request booking' }).click();
    await expect(form.locator('.hp-error-text').first()).toBeVisible();

    await form.locator('input').first().fill('Richmond');
    await form.locator('select').selectOption('Today');
    await form.getByRole('button', { name: 'Request booking' }).click();

    await expect(userMessages(page).last()).toContainText('Suburb: Richmond');
    await expect(agentMessages(page).last()).toContainText('Suburb: Richmond');
  });
});

test.describe('shortcuts', () => {
  test('home tiles and the help-links section render', async ({ page }) => {
    await openWidget(page);
    await expect(page.locator('helppuff-widget .hp-tile')).toHaveCount(4);
    await expect(page.locator('helppuff-widget .hp-home-links .hp-link-row')).toHaveCount(2);
  });

  test('a url shortcut is a real link, not a message', async ({ page }) => {
    await openWidget(page);
    const tile = page.locator('helppuff-widget .hp-tile', { hasText: 'Read the docs' });
    await expect(tile).toHaveAttribute('href', 'https://example.com/docs');
    await expect(tile).toHaveAttribute('target', '_blank');
  });

  test('a form shortcut opens the configured form in the thread', async ({ page }) => {
    await openWidget(page);
    await page.locator('helppuff-widget .hp-tile', { hasText: 'Book a visit' }).click();
    await expect(page.locator('helppuff-widget .hp-inline-form')).toBeVisible();
    await expect(page.locator('helppuff-widget .hp-inline-form')).toContainText('Book a visit');
  });

  test('the composer shortcut bar sends a reply shortcut', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);

    await page.locator('helppuff-widget .hp-shortcut-bar .hp-chip', { hasText: 'Show a card' }).click();
    await expect(page.locator('helppuff-widget .hp-card')).toBeVisible();
  });

  test('every shortcut is reachable when the row overflows', async ({ page }) => {
    test.skip(Boolean(test.info().project.use.isMobile), 'touch swipes the row instead');

    await openWidget(page);
    await startConversation(page);

    const bar = page.locator('helppuff-widget .hp-shortcut-bar');
    const wrap = page.locator('helppuff-widget .hp-shortcut-wrap');
    const last = page.locator('helppuff-widget .hp-shortcut-bar .hp-chip').last();

    // Four chips do not fit a 400px panel, so the row scrolls.
    expect(await bar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    // Regression: the scrollbar is hidden, so without a fade and a nudge
    // button the clipped chip looked like a rendering fault, not something
    // you could reach.
    await expect(wrap).toHaveAttribute('data-more-end', '');
    const nav = page.locator('helppuff-widget .hp-shortcut-nav');
    await expect(nav).toBeVisible();

    const fullyVisible = async () =>
      bar.evaluate((el) => {
        const chip = el.lastElementChild as HTMLElement;
        return chip.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1;
      });
    expect(await fullyVisible()).toBe(false);

    await nav.click();
    await expect.poll(fullyVisible).toBe(true);
    await expect(wrap).toHaveAttribute('data-more-start', '');
    await expect(nav).toBeHidden();

    // And it is clickable once reached.
    await expect(last).toBeVisible();
  });

  test('a chip that is a link is not underlined like prose', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    const call = page.locator('helppuff-widget .hp-shortcut-bar a.hp-chip').first();
    await expect(call).toHaveCSS('text-decoration-line', 'none');
  });

  test('the thread scrollbar is the quiet one, not the platform default', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, '/long');

    const scroller = page.locator('helppuff-widget .hp-scroll').last();
    await expect(scroller).toHaveCSS('scrollbar-width', 'thin');
  });

  test('the shortcut bar collapses once the thread gets long', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await expect(page.locator('helppuff-widget .hp-shortcut-bar .hp-chip')).toHaveCount(4);

    for (const text of ['one', 'two', 'three']) await send(page, text);

    // Collapsed to a single "⋯" that restores the row.
    const bar = page.locator('helppuff-widget .hp-shortcut-bar .hp-chip');
    await expect(bar).toHaveCount(1);
    await bar.click();
    await expect(page.locator('helppuff-widget .hp-shortcut-bar .hp-chip')).toHaveCount(4);
  });
});

test.describe('client-side flows', () => {
  test('a flow runs with no server call until it completes', async ({ page }) => {
    let sessions = 0;
    await page.route('**/v1/sites/*/sessions', (route) => {
      sessions += 1;
      return route.continue();
    });

    await openWidget(page);
    await page.locator('helppuff-widget .hp-tile', { hasText: 'Get a quote' }).click();

    await expect(thread(page)).toContainText('What do you need done?');
    await expect(page.locator('helppuff-widget .hp-flow-bar')).toBeVisible();
    expect(sessions, 'a flow costs nothing until it finishes').toBe(0);

    await composer(page).fill('a blocked drain');
    await page.locator('helppuff-widget .hp-send').click();
    await expect(thread(page)).toContainText('Which suburb are you in?');

    await composer(page).fill('Richmond');
    await page.locator('helppuff-widget .hp-send').click();
    await expect(thread(page)).toContainText('When suits?');

    await page.locator('helppuff-widget .hp-chips .hp-chip', { hasText: 'Today' }).click();

    // No session yet, so the lead form collects one — the answer is not lost.
    await page.locator('helppuff-widget #hp-f-name').fill('Ada');
    await page.locator('helppuff-widget #hp-f-email').fill('ada@example.com');
    await page.locator('helppuff-widget #hp-f-phone').fill('0400 000 000');
    // The flow's summary is shown in the first-message box, where it can be
    // edited, rather than riding along unseen.
    await expect(page.locator('helppuff-widget #hp-f-first')).toHaveValue(
      "I'd like a quote for a blocked drain in Richmond, Today.",
    );
    await page.locator('helppuff-widget button[type="submit"]').click();

    await expect(agentMessages(page).last()).toContainText(
      "quote for a blocked drain in Richmond, Today.",
      { timeout: 10_000 },
    );
    await expect(page.locator('helppuff-widget .hp-flow-bar')).toBeHidden();
  });

  test('a flow can be cancelled at any step', async ({ page }) => {
    await openWidget(page);
    await page.locator('helppuff-widget .hp-tile', { hasText: 'Get a quote' }).click();
    await expect(thread(page)).toContainText('What do you need done?');

    await page.locator('helppuff-widget .hp-flow-bar .hp-chip').click();
    await expect(page.locator('helppuff-widget .hp-flow-bar')).toBeHidden();
    // The widget stays usable.
    await expect(panel(page)).toBeVisible();
  });

  test('a flow rejects an answer that does not fit the step', async ({ page }) => {
    await openWidget(page);
    await page.locator('helppuff-widget .hp-tile', { hasText: 'Get a quote' }).click();
    await composer(page).fill('   ');
    // Whitespace cannot be sent at all, so the step stands.
    await expect(page.locator('helppuff-widget .hp-send')).toBeDisabled();
    await expect(thread(page)).toContainText('What do you need done?');
  });
});

test.describe('streamed replies', () => {
  test('a reply is shown as it is written, then replaced by the real message', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);

    await composer(page).fill('/long');
    await page.locator('helppuff-widget .hp-send').click();

    // The demo's echo connector streams: the preview appears and grows…
    const preview = page.locator('helppuff-widget [data-streaming] .hp-agent');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Paragraph 1.');
    const early = (await preview.textContent())?.length ?? 0;
    await expect.poll(async () => (await preview.textContent())?.length ?? 0).toBeGreaterThan(early);

    // …and is replaced by the message itself when the reply is complete.
    await expect(page.locator('helppuff-widget [data-streaming]')).toHaveCount(0, { timeout: 10_000 });
    await expect(agentMessages(page).last()).toContainText('Paragraph 12.');
  });
});

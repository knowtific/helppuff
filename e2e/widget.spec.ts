import { expect, test } from '@playwright/test';
import {
  agentMessages,
  captureConsole,
  composer,
  hostFingerprint,
  launcher,
  openWidget,
  panel,
  send,
  sendButton,
  startConversation,
  thread,
  userMessages,
} from './helpers.js';

/**
 * UI tests against the real Worker, the real echo connector and the real
 * widget bundle — the whole stack, in a browser.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Each test starts with no stored session.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.describe('the conversation', () => {
  test('a visitor can open, fill the form and talk to the assistant', async ({ page }) => {
    await openWidget(page);
    await expect(page.locator('murmur-widget .mm-home-title')).toHaveText('Hi there');

    await startConversation(page);
    await expect(agentMessages(page).first()).toContainText('echo connector');

    await send(page, 'Hello there');
    await expect(userMessages(page)).toHaveText(['Hello there']);
    await expect(agentMessages(page).last()).toContainText('You said:');
  });

  test('the composer clears and disables itself while sending', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);

    await composer(page).fill('/slow');
    await sendButton(page).click();

    // The typing indicator is up while echo waits three seconds.
    await expect(page.locator('murmur-widget .mm-typing')).toBeVisible();
    await expect(composer(page)).toHaveValue('');
    await expect(agentMessages(page).last()).toContainText('three seconds', { timeout: 10_000 });
    await expect(page.locator('murmur-widget .mm-typing')).toBeHidden();
  });

  test('the composer shows no scrollbar until it stops growing', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);

    const box = composer(page);
    const state = () =>
      box.evaluate((el) => ({
        overflowY: getComputedStyle(el).overflowY,
        height: (el as HTMLElement).offsetHeight,
      }));

    // Regression: `overflow-y: auto` on a box that exactly fits its content
    // shows a stepper scrollbar on some platforms.
    expect(await state()).toMatchObject({ overflowY: 'hidden' });

    await box.fill('one');
    expect((await state()).overflowY).toBe('hidden');

    // Past five lines it stops growing, and only then may it scroll.
    await box.fill('one\ntwo\nthree\nfour\nfive\nsix\nseven');
    const grown = await state();
    expect(grown.overflowY).toBe('auto');
    expect(grown.height).toBeLessThanOrEqual(120);
  });

  test("the lead form's first message appears in the thread", async ({ page }) => {
    await openWidget(page);
    await page.locator('murmur-widget .mm-btn').first().click();
    await page.locator('murmur-widget #mm-f-name').fill('Ahad');
    await page.locator('murmur-widget #mm-f-phone').fill('0400 000 000');
    await page.locator('murmur-widget #mm-f-first').fill('a question asked up front');
    await page.locator('murmur-widget button[type="submit"]').click();

    await expect(userMessages(page)).toHaveText(['a question asked up front']);
    await expect(agentMessages(page).last()).toContainText('a question asked up front');
  });

  test('markdown renders as formatted text, not as source', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, 'hello');

    const strong = page.locator('murmur-widget .mm-agent strong').last();
    await expect(strong).toHaveText('hello');
  });

  test('a long reply scrolls without breaking the layout', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, '/long');

    await expect(agentMessages(page).last()).toContainText('Paragraph 12');
    const scrolledToBottom = await page.locator('murmur-widget .mm-scroll').last().evaluate((el) => {
      return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    });
    expect(scrolledToBottom).toBe(true);
  });

  test('a connector error degrades in place and keeps the typed message', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, '/error');

    const alert = page.locator('murmur-widget [role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/having a moment|unavailable/i);

    // The widget stays; the message comes back to the composer.
    await expect(panel(page)).toBeVisible();
    await expect(composer(page)).toHaveValue('/error');
    // The fallback contact is offered inside the notice itself — the
    // shortcut bar may carry its own `tel:` chip.
    await expect(alert.locator('a[href^="tel:"]')).toBeVisible();
  });

  test('the conversation survives a page reload', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, 'remember me');
    await expect(agentMessages(page).last()).toContainText('remember me');

    await page.reload();
    await openWidget(page);

    // A live session resumes straight into the thread.
    await expect(composer(page)).toBeVisible();
    await expect(userMessages(page)).toHaveText(['remember me']);
  });

  test('reset() clears the stored conversation', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);
    await send(page, 'forget me');
    await expect(thread(page)).toContainText('forget me');

    await page.evaluate(() => (window as never as { Murmur: { reset(): void } }).Murmur.reset());
    await expect(page.locator('murmur-widget .mm-home-title')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('mm:demo'))).toBeNull();
  });
});

test.describe('the JavaScript API', () => {
  test('open, close and toggle drive the panel', async ({ page }) => {
    type Api = { open(): void; close(): void; toggle(): void };
    const api = () => page.evaluate.bind(page);

    await page.evaluate(() => (window as never as { Murmur: Api }).Murmur.open());
    await expect(panel(page)).toBeVisible();

    await page.evaluate(() => (window as never as { Murmur: Api }).Murmur.close());
    await expect(panel(page)).toBeHidden();

    await page.evaluate(() => (window as never as { Murmur: Api }).Murmur.toggle());
    await expect(panel(page)).toBeVisible();
    void api;
  });

  test('send() opens the widget and keeps the message through the lead form', async ({ page }) => {
    await page.evaluate(() =>
      (window as never as { Murmur: { send(t: string): void } }).Murmur.send('I need a quote'),
    );
    await expect(panel(page)).toBeVisible();

    // The site requires a lead, so the form comes first — but the visitor's
    // intent is not discarded (§8.5).
    await page.locator('murmur-widget #mm-f-name').fill('Ada');
    await page.locator('murmur-widget #mm-f-phone').fill('0400 000 000');
    await page.locator('murmur-widget button[type="submit"]').click();

    await expect(thread(page)).toContainText('quote', { timeout: 10_000 });
  });

  test('send() delivers immediately when no lead is required', async ({ page }) => {
    await page.evaluate(() =>
      (window as never as { Murmur: { identify(l: object): void; send(t: string): void } }).Murmur.identify({
        name: 'Grace',
        phone: '0400 111 222',
      }),
    );
    await page.evaluate(() =>
      (window as never as { Murmur: { send(t: string): void } }).Murmur.send('straight through'),
    );
    await expect(panel(page)).toBeVisible();
    await expect(thread(page)).toContainText('straight through', { timeout: 10_000 });
  });

  test('identify() skips the lead form', async ({ page }) => {
    await page.evaluate(() =>
      (window as never as { Murmur: { identify(l: object): void } }).Murmur.identify({
        name: 'Grace Hopper',
        phone: '0400 111 222',
      }),
    );
    await openWidget(page);
    await page.locator('murmur-widget .mm-btn').first().click();

    // Straight to the thread — no form.
    await expect(composer(page)).toBeVisible();
    await expect(page.locator('murmur-widget #mm-f-name')).toHaveCount(0);
  });

  test('events fire for the host page', async ({ page }) => {
    await page.evaluate(() => {
      (window as never as { __events: string[] }).__events = [];
      const api = (window as never as { Murmur: { on(e: string, h: () => void): void } }).Murmur;
      api.on('open', () => (window as never as { __events: string[] }).__events.push('open'));
      api.on('lead', () => (window as never as { __events: string[] }).__events.push('lead'));
    });

    await openWidget(page);
    await startConversation(page);

    await expect
      .poll(() => page.evaluate(() => (window as never as { __events: string[] }).__events))
      .toEqual(expect.arrayContaining(['open', 'lead']));
  });

  test('destroy() removes the widget and leaves an inert global', async ({ page }) => {
    await openWidget(page);
    await page.evaluate(() => (window as never as { Murmur: { destroy(): void } }).Murmur.destroy());

    await expect(page.locator('murmur-widget')).toHaveCount(0);
    const threw = await page.evaluate(() => {
      try {
        (window as never as { Murmur: { open(): void } }).Murmur.open();
        return null;
      } catch (error) {
        return String(error);
      }
    });
    expect(threw).toBeNull();
  });
});

test.describe('accessibility', () => {
  test('the panel is a labelled, non-blocking dialog', async ({ page }) => {
    await openWidget(page);
    const dialog = page.locator('murmur-widget [role="dialog"]');
    await expect(dialog).toHaveAttribute('aria-modal', 'false');
    await expect(dialog).toHaveAttribute('aria-labelledby', 'mm-title');
  });

  test('Escape closes the panel and returns focus to the launcher', async ({ page }) => {
    await openWidget(page);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();

    const focused = await page.evaluate(() => {
      const host = document.querySelector('murmur-widget');
      return host?.shadowRoot?.activeElement?.className ?? '';
    });
    expect(focused).toContain('mm-orb');
  });

  test('the whole flow is reachable by keyboard alone', async ({ page }) => {
    await launcher(page).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();

    // Focus lands inside the panel on open (§8.7).
    const inside = await page.evaluate(() => {
      const root = document.querySelector('murmur-widget')?.shadowRoot;
      return Boolean(root?.querySelector('.mm-panel')?.contains(root.activeElement));
    });
    expect(inside).toBe(true);
  });

  test('every interactive target is at least 44px (§8.7)', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);

    const small = await page.evaluate(() => {
      const root = document.querySelector('murmur-widget')?.shadowRoot;
      if (!root) return ['no shadow root'];
      const offenders: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>('button, a, input, textarea, select')) {
        // The layout box, not the rendered rect: `getBoundingClientRect`
        // includes transforms, so a control caught mid scale-in reads as tiny
        // even though its target size is correct.
        const { offsetWidth: w, offsetHeight: h } = el;
        if (w === 0 && h === 0) continue; // not rendered
        // Links inside prose and the tiny footer credit are text, not controls.
        if (el.tagName === 'A' && (el.closest('.mm-agent') || el.closest('.mm-powered'))) continue;
        if (h < 44 || w < 44) offenders.push(`${el.tagName}.${el.className} ${w}x${h}`);
      }
      return offenders;
    });
    expect(small).toEqual([]);
  });

  test('agent replies are announced politely, and only once', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);

    const live = page.locator('murmur-widget [aria-live="polite"]');
    await expect(live).toHaveCount(1);
    await expect(live).toHaveAttribute('aria-live', 'polite');
  });
});

test.describe('the host page is unaffected', () => {
  test('nothing is added to document.head and body keeps its own children', async ({ page }) => {
    const before = await hostFingerprint(page);
    await openWidget(page);
    await startConversation(page);
    const after = await hostFingerprint(page);

    expect(after.headStyles).toBe(before.headStyles);
    expect(after.wrapWidth).toBe(before.wrapWidth);
    expect(after.bodyClass).toBe(before.bodyClass);
    // Nothing beyond the widget's own host element was added.
    expect(after.bodyChildTags).toBe(before.bodyChildTags);
  });

  test('the widget writes only mm:-prefixed storage and no cookies', async ({ page }) => {
    await openWidget(page);
    await startConversation(page);

    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.every((k) => k.startsWith('mm:'))).toBe(true);
    expect(await page.evaluate(() => document.cookie)).toBe('');
  });

  test('the widget is silent in the console', async ({ page }) => {
    const { messages, errors } = captureConsole(page);
    await page.goto('/');
    await openWidget(page);
    await startConversation(page);
    await send(page, 'hello');

    expect(errors).toEqual([]);
    expect(messages.filter((m) => m.toLowerCase().includes('murmur'))).toEqual([]);
  });

  test('the launcher causes no layout shift', async ({ page }) => {
    await page.goto('/');
    const shift = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
              if (!entry.hadRecentInput) total += entry.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
          setTimeout(() => resolve(total), 2500);
        }),
    );
    // The launcher is position:fixed, so it contributes nothing.
    expect(shift).toBeLessThan(0.01);
  });
});

test.describe('mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile viewport only');

  test('the panel is full screen and the inputs do not trigger iOS zoom', async ({ page }) => {
    await openWidget(page);

    // offsetWidth, not boundingBox: the open animation scales the panel, so
    // the rendered rect is smaller than the layout box for its first 360ms.
    const width = await panel(page).evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(width).toBe(page.viewportSize()?.width);

    await startConversation(page);
    const fontSize = await composer(page).evaluate((el) => getComputedStyle(el).fontSize);
    // Anything under 16px makes iOS zoom the host page (§8.8).
    expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(16);
  });
});

import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { composer, sendButton, thread } from './helpers';

/**
 * Jobs, end to end, on the live-chat Worker (:8796, e2e/live: D1 and the
 * dashboard): a visitor's quote questions become a job on the board; the team
 * moves it (menu and drag), adds an update; the owner edits the stages; and
 * "let the AI choose" falls back to the basic template without AI.
 */

type Json = Record<string, unknown>;

const WORKER = 'http://localhost:8796';
const ADMIN_KEY = 'e2e-only-admin-key-not-for-any-deployment-012345';
const OWNER = { email: 'jobs-owner@e2e.test', password: 'jobs-owner-password-123' };

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'the board is a desktop page; one browser is enough');

const admin = async (request: APIRequestContext, method: 'GET' | 'PUT' | 'POST', path: string, data?: unknown) => {
  const response = await request.fetch(`${WORKER}/admin/api${path}`, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}` }, ...(data ? { data } : {}) });
  return { status: response.status(), body: (await response.json()) as Json };
};

test.beforeAll(async ({ request }) => {
  const made = await admin(request, 'POST', '/admins', { ...OWNER, name: 'Jo', role: 'admin' });
  expect([201, 409]).toContain(made.status);
  // A known start, each run: the service-quote template, two questions and the contact ones.
  expect((await admin(request, 'POST', '/jobs/pipeline/template', { template: 'service-quote' })).status).toBe(200);
  expect((await admin(request, 'PUT', '/jobs/pipeline', { quote: ['description', 'address'], quoteEnabled: true, quoteContact: true })).status).toBe(200);
});

async function signIn(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: WORKER })).newPage();
  // Never an available agent: live.spec (same Worker, in parallel) needs nobody free.
  await page.addInitScript(() => {
    (window as unknown as { WebSocket: unknown }).WebSocket = class {
      readyState = 0;
      send() {}
      close() {}
    };
  });
  await page.goto('/admin/');
  await page.getByLabel(/email/i).fill(OWNER.email);
  await page.getByLabel(/password/i).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
  return page;
}

const column = (page: Page, name: string) => page.locator(`section[aria-label="${name}"]`);

test('the quote questions save a job the team sees on the board', async ({ browser }) => {
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${WORKER}/`);
  // The preview page opens the widget itself (`data-open`).
  await expect(visitor.locator('helppuff-widget .hp-panel')).toBeVisible();
  // One "Get a quote": the quote questions replace the site's own shortcut of that name.
  await expect(visitor.locator('helppuff-widget .hp-tile', { hasText: 'Get a quote' })).toHaveCount(1);
  await visitor.locator('helppuff-widget .hp-tile', { hasText: 'Get a quote' }).click();
  for (const [ask, answer] of [
    ['What do you need?', 'Leaking hot water tank in the garage'],
    ['Where is the job?', 'Glebe'],
    ['What’s your name?', 'Quinn Quote'],
    ['And your email', 'quinn@example.com'],
    ['A phone number', '0400 123 456'],
  ] as const) {
    await expect(thread(visitor)).toContainText(ask);
    await composer(visitor).fill(answer);
    await sendButton(visitor).click();
  }
  // Straight to the request: the contact questions answered the site's lead form.
  await expect(thread(visitor)).toContainText(/Thanks Quinn! Your request is #\d+/);
  const number = /#(\d+)/.exec(await thread(visitor).innerText())![1]!;
  await visitor.context().close();

  const page = await signIn(browser);
  await page.goto('/admin/#/jobs');
  const card = column(page, 'New request').locator('a', { hasText: `#${number}` });
  await expect(card).toContainText('Quinn Quote');
  await card.click();
  await expect(page.getByText(/Created from the quote questions, in New request/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Quinn Quote' })).toBeVisible();
  await page.context().close();
});

test('the team moves a job by menu and by drag, and adds an update to its history', async ({ browser, request }) => {
  const title = `Boiler service ${Date.now()}`;
  const made = await admin(request, 'POST', '/jobs', { title, contact: { name: 'Bo Iler', email: `bo-${Date.now()}@example.com` } });
  expect(made.status).toBe(201);
  const page = await signIn(browser);
  await page.goto('/admin/#/jobs');
  await expect(column(page, 'New request')).toContainText(title);

  await page.getByRole('combobox', { name: `Move ${title} to` }).selectOption({ label: 'Site visit' });
  await expect(column(page, 'Site visit')).toContainText(title);

  await column(page, 'Site visit').locator('[draggable="true"]', { hasText: title }).dragTo(column(page, 'Quote sent'));
  await expect(column(page, 'Quote sent')).toContainText(title);
  await expect.poll(async () => ((await admin(request, 'GET', `/jobs/${String(made.body['id'])}`)).body['stage'] as { name: string } | null)?.name).toBe('Quote sent');

  await column(page, 'Quote sent').getByRole('link', { name: new RegExp(title) }).click();
  await page.getByLabel('Update').fill('Quote emailed, follow up Friday.');
  await page.getByRole('button', { name: 'Add to history' }).click();
  await expect(page.getByText('Quote emailed, follow up Friday.')).toBeVisible();
  await expect(page.getByText('Moved from Site visit to Quote sent')).toBeVisible();
  await page.context().close();
});

test('the owner renames a stage in Settings → Jobs, and the board follows', async ({ browser }) => {
  const page = await signIn(browser);
  await page.goto('/admin/#/settings/jobs');
  const stages = page.getByRole('region', { name: 'Stages' });
  await stages.getByRole('textbox', { name: 'Stage name' }).nth(1).fill('Inspection');
  await stages.getByRole('button', { name: 'Save' }).click();
  await expect(stages.getByText('Saved.')).toBeVisible();
  await page.goto('/admin/#/jobs');
  await expect(column(page, 'Inspection')).toBeVisible();
  await expect(column(page, 'Site visit')).toHaveCount(0);
  await page.context().close();
});

test('“let the AI choose” without AI falls back to the basic template, and no job is lost', async ({ request }) => {
  const count = async () => ((await admin(request, 'GET', '/jobs?status=all')).body['items'] as unknown as { stage: unknown }[]).filter((j) => j.stage).length;
  const before = await count();
  const setup = await admin(request, 'POST', '/jobs/setup', { force: true });
  expect(setup.status).toBe(200);
  expect(setup.body['pipeline']).toMatchObject({ template: 'basic' });
  expect(await count()).toBe(before);
});

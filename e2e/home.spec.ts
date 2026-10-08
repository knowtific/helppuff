import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Settings → Home screen, end to end on the live-chat Worker (:8796, with
 * D1 and the dashboard): the owner changes the heading, adds a call button
 * and a useful page, and a visitor's widget shows them.
 */

const WORKER = 'http://localhost:8796';
const ADMIN_KEY = 'e2e-only-admin-key-not-for-any-deployment-012345';
const OWNER = { email: 'home-owner@e2e.test', password: 'home-owner-password-123' };

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'a settings page; one browser is enough');

const admin = (request: APIRequestContext, method: 'POST' | 'PUT', path: string, data: unknown) =>
  request.fetch(`${WORKER}/admin/api${path}`, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}` }, data });

// The Worker's home screen as it was: put back afterwards, since other specs share this Worker.
let original: unknown = null;

test.beforeAll(async ({ request }) => {
  expect([201, 409]).toContain((await admin(request, 'POST', '/admins', { ...OWNER, name: 'Hana', role: 'admin' })).status());
  const read = await request.fetch(`${WORKER}/admin/api/settings`, { headers: { Authorization: `Bearer ${ADMIN_KEY}` } });
  original = ((await read.json()) as { settings: { home: unknown } }).settings.home;
});
test.afterAll(async ({ request }) => {
  if (original) expect((await admin(request, 'PUT', '/settings', { settings: { home: original } })).status()).toBe(200);
});

test('the owner sets the home screen up and the widget shows it', async ({ browser }) => {
  const team = await (await browser.newContext({ baseURL: WORKER })).newPage();
  // Never an available agent: live.spec (same Worker, in parallel) needs nobody free.
  await team.addInitScript(() => {
    (window as unknown as { WebSocket: unknown }).WebSocket = class {
      readyState = 0;
      send() {}
      close() {}
    };
  });
  await team.goto('/admin/');
  await team.getByLabel(/email/i).fill(OWNER.email);
  await team.getByLabel(/password/i).fill(OWNER.password);
  await team.getByRole('button', { name: /sign in/i }).click();
  await expect(team.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();

  await team.goto('/admin/#/settings/home');
  const heading = team.getByRole('region', { name: 'Heading' });
  await heading.getByLabel('Title').fill('G’day from the e2e');
  const buttons = team.getByRole('region', { name: 'Buttons' });
  await buttons.getByRole('button', { name: 'Add a button' }).click();
  await buttons.getByLabel('Button label').last().fill('Call the office');
  await buttons.getByRole('combobox', { name: 'What Call the office does' }).selectOption({ label: 'Call' });
  await buttons.getByLabel('Number Call the office calls').fill('02 9000 0000');
  const pages = team.getByRole('region', { name: 'Useful pages' });
  await pages.getByRole('checkbox').check();
  await pages.getByRole('button', { name: 'Add a link' }).click();
  await pages.getByLabel('Link text').last().fill('Our prices');
  await pages.getByLabel('Address of Our prices').fill('https://example.com/prices');
  await team.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(team.getByText('Saved. Live on the widget within a minute.')).toBeVisible();
  await team.context().close();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${WORKER}/`);
  await expect(visitor.locator('helppuff-widget .hp-panel')).toBeVisible();
  await expect(visitor.locator('helppuff-widget .hp-home-title')).toHaveText('G’day from the e2e');
  await expect(visitor.locator('helppuff-widget .hp-tile', { hasText: 'Call the office' })).toBeVisible();
  const link = visitor.locator('helppuff-widget a.hp-link-row', { hasText: 'Our prices' });
  await expect(link).toHaveAttribute('href', 'https://example.com/prices');
  await visitor.context().close();
});

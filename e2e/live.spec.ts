import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { agentMessages, composer, openWidget, send, startConversation, thread } from './helpers';

/**
 * Live chat end to end: a visitor's widget (on the fixture page) and the
 * team's dashboard (served by the live-chat Worker on :8788, e2e/live), two
 * real browsers, one real Worker with D1 and the live hub.
 */

const WORKER = 'http://localhost:8788';
const ADMIN_KEY = 'e2e-only-admin-key-not-for-any-deployment-012345';
const OWNER = { email: 'owner@e2e.test', password: 'owner-password-123' };
const MEMBER = { email: 'mo@e2e.test', password: 'member-password-123' };

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'one browser is enough for two-party flows');

const admin = (request: APIRequestContext, method: 'PUT' | 'POST', path: string, data: unknown) =>
  request.fetch(`${WORKER}/admin/api${path}`, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}` }, data });

test.beforeAll(async ({ request }) => {
  // The first account is the owner (no ADMIN_EMAIL here); a second, a member. Re-runs find them made.
  for (const [who, role] of [
    [OWNER, 'admin'],
    [MEMBER, 'member'],
  ] as const) {
    const made = await admin(request, 'POST', '/admins', { ...who, name: who === OWNER ? 'Olivia' : 'Mo', role });
    expect([201, 409]).toContain(made.status());
  }
  const saved = await admin(request, 'PUT', '/settings', { settings: { live: { enabled: true, waitSeconds: 15, showAgentName: true } } });
  expect(saved.status()).toBe(200);
});

async function signIn(browser: Browser, who: { email: string; password: string }): Promise<Page> {
  const context = await browser.newContext({ baseURL: WORKER });
  await context.grantPermissions(['notifications'], { origin: WORKER });
  const page = await context.newPage();
  await page.goto('/admin/');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
  return page;
}

async function visitor(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('http://localhost:5173/fixtures/live.html');
  await openWidget(page);
  await startConversation(page);
  return page;
}

const personButton = (page: Page) => page.locator('helppuff-widget button[aria-label="Talk to a person"]');

test('nobody available: the visitor gets the callback form', async ({ browser }) => {
  const page = await visitor(browser);
  await personButton(page).click();
  await expect(thread(page)).toContainText('Nobody from the team is free right now');
  await expect(page.locator('helppuff-widget button', { hasText: 'Request callback' })).toBeVisible();
  await page.context().close();
});

test('a visitor is handed to the team, answered, and handed back to the assistant', async ({ browser }) => {
  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  // Connected and available (the switch at the bottom of the menu).
  await expect(team.getByRole('switch', { name: 'Available for live chats' })).toHaveAttribute('aria-checked', 'true');
  await expect(team.getByText('You get new live chats')).toBeVisible();

  const page = await visitor(browser);
  await personButton(page).click();
  await expect(thread(page)).toContainText('Connecting you with someone from the team');
  await expect(personButton(page)).toHaveCount(0);

  // The team sees it waiting, on the menu and in the list, without reloading.
  await expect(team.getByLabel(/live chats waiting/)).toBeVisible();
  const waiting = team.locator('a', { hasText: /Waiting/ }).first();
  await expect(waiting).toBeVisible();
  await waiting.click();
  await team.getByRole('button', { name: 'Take chat' }).click();
  await expect(thread(page)).toContainText('Olivia joined the chat');
  await expect(page.locator('helppuff-widget .hp-header-status')).toContainText('Olivia');

  const reply = team.getByLabel('Reply to the visitor');
  await reply.fill('Hi, Olivia here. How can I help?');
  await reply.press('Enter');
  await expect(thread(page)).toContainText('Hi, Olivia here. How can I help?');
  await expect(page.locator('helppuff-widget .hp-agent-name').last()).toHaveText('Olivia');

  // The visitor answers: no reply from the assistant; the team sees it live.
  const before = await agentMessages(page).count();
  await send(page, 'My tap is leaking');
  await expect(team.getByText('My tap is leaking')).toBeVisible();
  expect(await agentMessages(page).count()).toBe(before);

  // Back to the assistant: it answers the next message.
  await team.getByRole('button', { name: 'Back to assistant' }).click();
  await expect(thread(page)).toContainText('back with the assistant');
  await send(page, 'thanks');
  await expect(thread(page)).toContainText('You said');
  await expect(personButton(page)).toBeVisible();

  await page.context().close();
  await team.context().close();
});

test('nobody takes it in time: the visitor is offered the callback form and can leave details', async ({ browser }) => {
  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  await expect(team.getByText('You get new live chats')).toBeVisible();
  const page = await visitor(browser);
  await personButton(page).click();
  await expect(thread(page)).toContainText('Connecting you');
  // waitSeconds is 15 here.
  await expect(thread(page)).toContainText('nobody is free just now', { timeout: 30_000 });
  const form = page.locator('helppuff-widget form', { has: page.locator('button', { hasText: 'Request callback' }) }).last();
  await form.locator('input').first().fill('Ada');
  await form.locator('input[type="tel"]').fill('0400 111 222');
  await form.getByRole('button', { name: 'Request callback' }).click();
  await expect(thread(page)).toContainText('the team will get back to you');
  await team.goto('/admin/#/callbacks');
  await expect(team.getByText('0400 111 222').first()).toBeVisible();
  await page.context().close();
  await team.context().close();
});

test('a member sees the inbox, not the settings', async ({ browser }) => {
  const page = await signIn(browser, MEMBER);
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  await expect(nav.getByRole('link', { name: 'Conversations' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Contacts' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Analytics' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Knowledge' })).toHaveCount(0);
  // An admin page sends them to the inbox.
  await page.goto('/admin/#/analytics');
  await expect(page).toHaveURL(/#\/conversations/);
  await page.goto('/admin/#/settings');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  // And the API refuses them the settings themselves.
  const settings = await page.request.get(`${WORKER}/admin/api/settings`);
  expect(settings.status()).toBe(403);
  await page.context().close();
});

test("the team labels a conversation, notes it, and keeps a contact's details", async ({ browser }) => {
  const created = await admin((await browser.newContext()).request, 'POST', '/labels', { name: 'Urgent', color: '#ef4444' });
  expect([201, 409]).toContain(created.status());
  const page = await visitor(browser);
  await send(page, 'Hello there');
  await expect(agentMessages(page).last()).toContainText('You said');
  await page.context().close();

  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  await team.locator('a[href^="#/conversations/"]').first().click();
  await team.getByRole('button', { name: 'Add label' }).click();
  await team.getByRole('menuitemcheckbox', { name: 'Urgent' }).click();
  await team.getByRole('button', { name: 'Add attribute' }).click();
  await team.getByLabel('Attribute key').fill('order_id');
  await team.getByLabel('Attribute value').fill('A-1042');
  await team.getByRole('button', { name: 'Add', exact: true }).click();
  await team.getByLabel('New note').fill('Called back, booked Tuesday');
  await team.getByRole('button', { name: 'Add note' }).click();
  await team.reload();
  await expect(team.getByText('A-1042')).toBeVisible();
  await expect(team.getByText('Called back, booked Tuesday')).toBeVisible();

  // The label filter finds it, and is remembered across a reload.
  await team.getByLabel('Label', { exact: true }).selectOption('Urgent');
  await expect(team.locator('a[href^="#/conversations/"]').first()).toContainText('Urgent');
  await team.reload();
  await expect(team.getByLabel('Label', { exact: true })).toHaveValue('Urgent');

  // The contact's page: details and attributes saved.
  await team.goto('/admin/#/leads');
  await team.locator('tbody a[href^="#/contact/"]').first().click();
  await team.getByRole('button', { name: 'Edit details' }).click();
  await team.getByLabel('Company').fill('Analytical Engines');
  await team.getByRole('button', { name: 'Save' }).click();
  await team.reload();
  await expect(team.getByText('Analytical Engines').first()).toBeVisible();
  await team.context().close();
});

test('the composer is only there while a person has the chat', async ({ browser }) => {
  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  await team.getByRole('radio', { name: 'AI bot' }).click();
  await team.locator('a[href^="#/conversations/"]').first().click();
  await expect(team.getByLabel('Reply to the visitor')).toHaveCount(0);
  await expect(composer(team)).toHaveCount(0);
  await team.context().close();
});

import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Booking in the chat, end to end, on the live-chat Worker (:8796, e2e/live,
 * the `booking` site): the visitor opens the calendar from the home screen,
 * picks a time and books it; the time is gone for the next visitor; the
 * appointment is on a job and on the dashboard's calendar; the visitor
 * cancels it from the chat.
 */

type Json = Record<string, any>;
const WORKER = 'http://localhost:8796';
const ADMIN_KEY = 'e2e-only-admin-key-not-for-any-deployment-012345';

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'one browser is enough: the picker is the same on a phone');

const admin = async (request: APIRequestContext, path: string) => {
  const response = await request.fetch(`${WORKER}/admin/api${path}${path.includes('?') ? '&' : '?'}site=booking`, { headers: { Authorization: `Bearer ${ADMIN_KEY}` } });
  return (await response.json()) as Json;
};

test('a visitor books a time in the chat, it is held for them, and they can cancel it', async ({ browser, request }) => {
  const visitor = await (await browser.newContext({ timezoneId: 'Australia/Perth' })).newPage();
  await visitor.goto(`${WORKER}/booking.html`);
  const w = (selector: string) => visitor.locator(`helppuff-widget ${selector}`);
  await expect(w('.hp-panel')).toBeVisible();
  await w('.hp-tile', { hasText: 'Book a time' }).click();

  // The calendar: days, then times, in the visitor's own time zone.
  await expect(w('.hpb-days .hp-chip').first()).toBeVisible();
  await expect(w('.hpb-sub', { hasText: 'Perth time' })).toBeVisible();
  await w('.hpb-days .hp-chip').nth(1).click();
  const time = w('.hpb-times .hp-chip').nth(3);
  const label = (await time.textContent())!.trim();
  await time.click();
  await w('input[name="name"]').fill('Ada Lovelace');
  await w('input[name="email"]').fill('ada@example.com');
  await w('form.hpb button[type="submit"]').click();

  const card = w('.hpb-card');
  await expect(card).toContainText('Booked');
  await expect(card).toContainText('Consultation');
  await expect(card).toContainText('12 Wharf St, Balmain');
  await expect(card).toContainText(label);

  // Saved on a job, with its contact.
  const { items } = await admin(request, '/appointments');
  const booked = items.find((a: Json) => a.attendee?.email === 'ada@example.com');
  expect(booked).toMatchObject({ status: 'confirmed', source: 'chat', title: 'Consultation', job: { title: 'Consultation: Ada Lovelace' }, contact: { name: 'Ada Lovelace' } });

  // The next visitor is not offered that time.
  const next = await (await browser.newContext({ timezoneId: 'Australia/Perth' })).newPage();
  await next.goto(`${WORKER}/booking.html`);
  await next.locator('helppuff-widget .hp-tile', { hasText: 'Book a time' }).click();
  await next.locator('helppuff-widget .hpb-days .hp-chip').nth(1).click();
  await expect(next.locator('helppuff-widget .hpb-times .hp-chip').first()).toBeVisible();
  await expect(next.locator('helppuff-widget .hpb-times .hp-chip', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })).toHaveCount(0);

  // Cancelled from the chat, after asking.
  await card.getByRole('button', { name: 'Cancel booking' }).click();
  await card.getByRole('button', { name: 'Yes, cancel' }).click();
  await expect(w('.hpb-card.off')).toContainText('Cancelled');
  expect((await admin(request, `/appointments/${booked.id}`)).status).toBe('cancelled');
});

test('the dashboard shows the calendar with the date picker on', async ({ request }) => {
  const me = await admin(request, '/me');
  expect(me.sites.find((s: Json) => s.id === 'booking').bookings).toBe('picker');
  const status = await admin(request, '/bookings');
  expect(status).toMatchObject({ effective: { mode: 'picker', chosen: true }, calendar: { sync: 'none' } });
});

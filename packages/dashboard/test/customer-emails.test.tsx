import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerEmails } from '../src/components/CustomerEmails';
import type { CustomerEmailsStatus } from '../src/lib/api';
import { button, byText, click, fakeApi, mount, unmount } from './helpers';

/** Settings → Customer emails: three switches, each telling what it still needs before it can be turned on. */

const status = (over: Partial<CustomerEmailsStatus> = {}): CustomerEmailsStatus => ({
  site: 'acme',
  origin: 'https://acme.com',
  settings: { copy: { enabled: false }, replies: { enabled: false }, inbound: { enabled: false } },
  delaySeconds: 120,
  service: { kind: 'request', name: 'Resend', from: null, enabled: true, sendsReplyTo: false, canAddReplyTo: true, lastStatus: 'ok', lastError: null },
  live: true,
  inbound: { domain: null, ruleId: null, verifiedAt: null, address: null },
  ready: { copy: true, replies: true, inbound: false },
  ...over,
});

const switchFor = (view: HTMLElement, title: string) => view.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${title}"]`)!;

afterEach(() => vi.unstubAllGlobals());

describe('customer emails', () => {
  it('shows the replies, answers and copy in that order; a switch that cannot work yet is off with its checklist', async () => {
    fakeApi({ 'GET /customer-emails/status': status(), 'GET /customer-emails/log?limit=20': { emails: [] } });
    const view = await mount(<CustomerEmails />);
    const titles = [...view.querySelectorAll('[role="switch"]')].map((s) => s.getAttribute('aria-label'));
    expect(titles).toEqual(['Email the team’s replies when the customer has left', 'Customers can answer by email', 'Send a copy of the conversation']);
    expect(switchFor(view, 'Customers can answer by email').disabled).toBe(true);
    expect(switchFor(view, 'Email the team’s replies when the customer has left').disabled).toBe(false);
    // C's checklist: the request's reply-to (the dashboard can add it), and the CLI command for the address.
    expect(byText(view, /^Its request sends a reply-to address/)).toBeTruthy();
    expect(button(view, 'Add it for me')).toBeTruthy();
    expect(view.textContent).toContain('npx @knowtific/helppuff email replies on chat.acme.com');
    expect(byText(view, 'None yet.')).toBeTruthy();
    await unmount();
  });

  it('turns the team’s replies on as a setting, and adds the reply-to field for the owner', async () => {
    let current = status();
    const calls = fakeApi({
      'GET /customer-emails/status': () => current,
      'GET /customer-emails/log?limit=20': { emails: [] },
      'PUT /settings': () => {
        current = status({ settings: { ...current.settings, replies: { enabled: true } } });
        return {};
      },
      'POST /customer-emails/reply-to': () => {
        current = status({ service: { ...current.service!, sendsReplyTo: true, canAddReplyTo: false } });
        return { body: '{}' };
      },
    });
    const view = await mount(<CustomerEmails />);
    await click(switchFor(view, 'Email the team’s replies when the customer has left'));
    expect(calls).toContainEqual({ method: 'PUT', path: '/settings', body: { settings: { customerEmails: { replies: { enabled: true } } } } });
    expect(switchFor(view, 'Email the team’s replies when the customer has left').getAttribute('aria-checked')).toBe('true');
    await click(button(view, 'Add it for me'));
    expect(calls).toContainEqual({ method: 'POST', path: '/customer-emails/reply-to', body: {} });
    expect(button(view, 'Add it for me')).toBeUndefined();
    await unmount();
  });

  it('asks once before copies go out, saying the risk', async () => {
    const calls = fakeApi({ 'GET /customer-emails/status': status(), 'GET /customer-emails/log?limit=20': { emails: [] }, 'PUT /settings': {} });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const view = await mount(<CustomerEmails />);
    expect(view.textContent).toContain('Anyone can type someone else’s email address');
    await click(switchFor(view, 'Send a copy of the conversation'));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await click(switchFor(view, 'Send a copy of the conversation'));
    expect(confirm.mock.calls[0]![0]).toContain('sending reputation');
    expect(calls).toContainEqual({ method: 'PUT', path: '/settings', body: { settings: { customerEmails: { copy: { enabled: true } } } } });
    await unmount();
  });

  it('lists what was sent', async () => {
    fakeApi({
      'GET /customer-emails/status': status({ ready: { copy: true, replies: true, inbound: true } }),
      'GET /customer-emails/log?limit=20': { emails: [{ id: 'ce_1', conversationId: 'c_1', kind: 'reply', to: 'sarah@example.com', status: 'failed', error: 'HTTP 422', at: Date.now() }] },
    });
    const view = await mount(<CustomerEmails />);
    expect(byText(view, 'sarah@example.com')).toBeTruthy();
    expect(byText(view, 'failed: HTTP 422')).toBeTruthy();
    await unmount();
  });
});

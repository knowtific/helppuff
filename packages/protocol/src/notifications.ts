/**
 * Email notifications (wiki/Email-Notifications.md): the owner connects an
 * email service once, as a request HelpPuff sends (any service with a send
 * API), and each person on the team picks the emails they want.
 *
 * HelpPuff writes each email and fills the request with it:
 *
 *   {{email.to}}       one recipient's address (one request per person)
 *   {{email.subject}}  the subject
 *   {{email.text}}     the plain-text body
 *   {{email.html}}     the same as HTML, everything escaped
 *
 * No provider's format is built in: the presets below only fill the form in.
 */

import type { ToolHeader, ToolMethod } from './tools.js';

/** The emails a person can choose (Settings → Notifications). `admin`: admins and the owner only. */
export const EMAIL_NOTIFICATIONS = {
  'lead.captured': { label: 'New contact', description: 'Someone left their name, email or phone in the chat.' },
  'lead.hot': { label: 'Hot lead', description: 'A chat ended and the AI rated the lead hot, with its summary (five minutes after the chat went quiet).' },
  'callback.requested': { label: 'Callback request', description: 'A visitor asked to be called back.' },
  'handover.requested': { label: 'A visitor wants a person', description: 'Someone asked to talk to the team in live chat.' },
  'handover.missed': { label: 'A live chat nobody took', description: 'Nobody took a live chat in time; the visitor got the callback form.' },
  'conversation.assigned': { label: 'A chat given to me', description: 'Someone on the team gave you a conversation.' },
  'job.created': { label: 'New job', description: 'A job was created: from the chat, the quote questions, the API or the dashboard.' },
  'appointment.created': { label: 'New booking', description: 'An appointment was booked.' },
  'appointment.cancelled': { label: 'Booking cancelled', description: 'An appointment was cancelled.' },
  'budget.exhausted': { label: 'AI budget used up', description: 'Today’s AI budget ran out: visitors get your contact details until midnight UTC.', admin: true },
} as const satisfies Record<string, { label: string; description: string; admin?: boolean }>;

export type EmailNotification = keyof typeof EMAIL_NOTIFICATIONS;

export const isEmailNotification = (value: unknown): value is EmailNotification => typeof value === 'string' && value in EMAIL_NOTIFICATIONS;

/** Whether a role may choose an email. */
export const emailAllowed = (type: EmailNotification, role: 'owner' | 'admin' | 'member') => role !== 'member' || !('admin' in EMAIL_NOTIFICATIONS[type]);

export type OutboundRequest = { method: ToolMethod; url: string; headers: ToolHeader[]; body: string };

/**
 * Starting points for well-known services, checked against their docs. They
 * fill the form in; the owner can change anything, so a service changing its
 * API never needs a HelpPuff release.
 */
export const EMAIL_PRESETS: {
  id: string;
  name: string;
  docs: string;
  /** Where the key goes, and what it is called in the service. */
  key: { header: string; prefix: string; label: string };
  /** The sender: an address on a domain verified in the service. */
  request: (from: string, key: string) => OutboundRequest;
}[] = [
  {
    id: 'resend',
    name: 'Resend',
    docs: 'https://resend.com/docs/api-reference/emails/send-email',
    key: { header: 'Authorization', prefix: 'Bearer ', label: 'API key' },
    request: (from, key) => ({
      method: 'POST',
      url: 'https://api.resend.com/emails',
      headers: [
        { name: 'Content-Type', value: 'application/json', secret: false },
        { name: 'Authorization', value: `Bearer ${key}`, secret: true },
      ],
      body: JSON.stringify({ from, to: ['{{email.to}}'], subject: '{{email.subject}}', text: '{{email.text}}', html: '{{email.html}}' }, null, 2),
    }),
  },
  {
    id: 'postmark',
    name: 'Postmark',
    docs: 'https://postmarkapp.com/developer/user-guide/send-email-with-api',
    key: { header: 'X-Postmark-Server-Token', prefix: '', label: 'Server API token' },
    request: (from, key) => ({
      method: 'POST',
      url: 'https://api.postmarkapp.com/email',
      headers: [
        { name: 'Content-Type', value: 'application/json', secret: false },
        { name: 'Accept', value: 'application/json', secret: false },
        { name: 'X-Postmark-Server-Token', value: key, secret: true },
      ],
      body: JSON.stringify({ From: from, To: '{{email.to}}', Subject: '{{email.subject}}', TextBody: '{{email.text}}', HtmlBody: '{{email.html}}', MessageStream: 'outbound' }, null, 2),
    }),
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    docs: 'https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send',
    key: { header: 'Authorization', prefix: 'Bearer ', label: 'API key' },
    request: (from, key) => ({
      method: 'POST',
      url: 'https://api.sendgrid.com/v3/mail/send',
      headers: [
        { name: 'Content-Type', value: 'application/json', secret: false },
        { name: 'Authorization', value: `Bearer ${key}`, secret: true },
      ],
      body: JSON.stringify(
        {
          personalizations: [{ to: [{ email: '{{email.to}}' }] }],
          from: { email: from },
          subject: '{{email.subject}}',
          content: [
            { type: 'text/plain', value: '{{email.text}}' },
            { type: 'text/html', value: '{{email.html}}' },
          ],
        },
        null,
        2,
      ),
    }),
  },
  {
    id: 'brevo',
    name: 'Brevo',
    docs: 'https://developers.brevo.com/reference/sendtransacemail',
    key: { header: 'api-key', prefix: '', label: 'API key' },
    request: (from, key) => ({
      method: 'POST',
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: [
        { name: 'Content-Type', value: 'application/json', secret: false },
        { name: 'Accept', value: 'application/json', secret: false },
        { name: 'api-key', value: key, secret: true },
      ],
      body: JSON.stringify({ sender: { email: from, name: 'HelpPuff' }, to: [{ email: '{{email.to}}' }], subject: '{{email.subject}}', textContent: '{{email.text}}', htmlContent: '{{email.html}}' }, null, 2),
    }),
  },
];

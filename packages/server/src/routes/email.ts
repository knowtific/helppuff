import { Hono, type Context } from 'hono';
import { resolveSite } from '../config/site.js';
import { HelpPuffError } from '../core/errors.js';
import { requireSecret, type HonoEnv } from '../core/request.js';
import { dbFrom } from '../db/d1.js';
import { readUnsubscribe, setEmailsOff } from '../notifications/customer.js';

/**
 * Unsubscribing from customer emails (the link in each one, and the
 * `List-Unsubscribe-Post` one-click that mail apps send). Opening the link
 * shows a button (link scanners open links too); the POST stops the emails.
 * The token is signed for one site and one address, and never expires.
 */
export const emailRoutes = new Hono<HonoEnv>();

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#faf8f5;color:#16163a;margin:0;padding:48px 16px}main{max-width:440px;margin:0 auto;background:#fff;border:1px solid #e7e2da;border-radius:10px;padding:24px}h1{font-size:18px;margin:0 0 8px}p{line-height:1.5;margin:0 0 16px}button{font:inherit;background:#3b0d24;color:#fff;border:0;border-radius:6px;padding:9px 16px;cursor:pointer}</style></head>
<body><main>${body}</main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

async function readToken(c: Context<HonoEnv>) {
  const ctx = c.get('helppuff');
  const token = c.req.query('t') ?? '';
  const found = token ? await readUnsubscribe(requireSecret(ctx), token) : null;
  if (!found || !ctx.config.sites[found.siteId]) throw new HelpPuffError('not_found', { message: 'This link is not valid.', detail: 'unsubscribe_invalid' });
  const site = await resolveSite(ctx, found.siteId);
  return { ...found, token, brand: site.widget.brand.name };
}

emailRoutes.get('/v1/email/unsubscribe', async (c) => {
  const { token, brand, email } = await readToken(c);
  return page(
    'Unsubscribe',
    `<h1>Stop emails from ${escapeHtml(brand)}?</h1><p>${escapeHtml(email)} will get no more copies of conversations or replies by email. You can still chat on the website.</p>
<form method="post" action="?t=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>`,
  );
});

emailRoutes.post('/v1/email/unsubscribe', async (c) => {
  const { siteId, brand, email } = await readToken(c);
  const ctx = c.get('helppuff');
  const db = dbFrom(ctx.env);
  if (db) await setEmailsOff(db, siteId, email, true, ctx.platform.now());
  ctx.platform.log('email.unsubscribed', { siteId, via: 'link' });
  return page('Unsubscribed', `<h1>You’re unsubscribed</h1><p>${escapeHtml(brand)} will not email ${escapeHtml(email)} again. Changed your mind? Ask them in the chat.</p>`);
});

/**
 * Cal.com's webhooks are signed with a secret the owner pastes into Cal.com
 * (Settings → Developer → Webhooks): `x-cal-signature-256` is the hex
 * HMAC-SHA256 of the raw body. The secret is derived per site from
 * HELPPUFF_SECRET, so there is nothing more to store.
 */

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, encoder.encode(data)));
}

export async function calcomWebhookSecret(helppuffSecret: string, siteId: string): Promise<string> {
  return `whcal_${(await hmac(helppuffSecret, `helppuff-calcom-webhook:${siteId}`)).slice(0, 40)}`;
}

export async function verifyCalcomSignature(secret: string, body: string, signature: string): Promise<boolean> {
  const expected = await hmac(secret, body);
  const given = signature.trim().toLowerCase().replace(/^sha256=/, '');
  let diff = expected.length ^ given.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  return diff === 0;
}

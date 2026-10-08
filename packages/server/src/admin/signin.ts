import { Hono, type Context } from 'hono';
import { resolveSecrets } from '../config/load.js';
import { signInSchema, type SignInLimits } from '../config/schema.js';
import { resolveSite } from '../config/site.js';
import { hitWindow, rateLimited } from '../core/ratelimit.js';
import type { HonoEnv } from '../core/request.js';
import { assertTurnstile } from '../core/turnstile.js';

/**
 * How hard the dashboard's sign-in is to guess at (`security.signIn`):
 *
 *  - every attempt counts against the IP (`attemptsPerIp`), and the
 *    one-time links' checks share that count;
 *  - failed passwords count against the email too (`attemptsPerAccount`),
 *    from any IP, so spreading guesses over many addresses does not help;
 *  - Turnstile on the form when the site has `security.captcha`.
 *
 * Sign-in is not per site. With several sites (repo development), the
 * strictest limits apply, and the first site with a captcha provides it.
 * A one-time link from `helppuff dashboard` still works while an account is
 * locked, and the owner's CLI (`X-HelpPuff-Owner`) is never limited.
 */

const SIGN_IN_WAIT = 'Too many sign-in attempts. Wait a few minutes and try again.';

export type SignInPolicy = Omit<SignInLimits, 'captcha'> & { captcha: { siteKey: string; secret: string } | null };

export async function signInPolicy(c: Context<HonoEnv>): Promise<SignInPolicy> {
  const ctx = c.get('helppuff');
  const sites = await Promise.all(Object.keys(ctx.config.sites).map((id) => resolveSite(ctx, id).catch(() => null)));
  const live = sites.filter((site) => site !== null);
  if (!live.length) return { ...signInSchema.parse({}), captcha: null };
  const limits = live.map((site) => site.security.signIn);
  let captcha: SignInPolicy['captcha'] = null;
  for (const site of live) {
    if (!site.security.signIn.captcha || !site.security.captcha) continue;
    const secret = String(resolveSecrets(site.security.captcha.secret, ctx.env) ?? '');
    if (secret) {
      captcha = { siteKey: site.security.captcha.siteKey, secret };
      break;
    }
  }
  return {
    attemptsPerIp: Math.min(...limits.map((l) => l.attemptsPerIp)),
    attemptsPerAccount: Math.min(...limits.map((l) => l.attemptsPerAccount)),
    windowMinutes: Math.max(...limits.map((l) => l.windowMinutes)),
    captcha,
  };
}

/** One attempt from this IP: sign-in, a setup or a login link. Throws when over. */
export async function throttleIp(c: Context<HonoEnv>, policy: SignInPolicy, scope: 'login' | 'admin-link'): Promise<void> {
  const ctx = c.get('helppuff');
  if (await ctx.isOwner()) return;
  const verdict = await hitWindow(ctx.platform.kv, scope, await ctx.ipKey(), policy.attemptsPerIp, policy.windowMinutes * 60);
  if (!verdict.allowed) throw rateLimited(verdict, scope === 'login' ? 'admin_login' : 'admin_link', SIGN_IN_WAIT);
}

async function accountKey(c: Context<HonoEnv>, email: string): Promise<string> {
  // Hashed with the secret, so KV never holds an email address.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${c.get('helppuff').secret}:signin:${email}`));
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const failKey = (account: string, windowSeconds: number, now: number) => `rl:login-fail:${account}:${Math.floor(now / 1000 / windowSeconds)}`;

/** Refuse before checking the password when this email has failed too often in the window. */
export async function assertAccountOpen(c: Context<HonoEnv>, policy: SignInPolicy, email: string): Promise<void> {
  const ctx = c.get('helppuff');
  if (await ctx.isOwner()) return;
  const windowSeconds = policy.windowMinutes * 60;
  const now = ctx.platform.now();
  const failures = Number.parseInt((await ctx.platform.kv.get(failKey(await accountKey(c, email), windowSeconds, now))) ?? '0', 10) || 0;
  if (failures >= policy.attemptsPerAccount) {
    const elapsed = Math.floor(now / 1000) % windowSeconds;
    throw rateLimited(
      { allowed: false, count: failures, retryAfter: Math.max(1, windowSeconds - elapsed) },
      'admin_login_account',
      SIGN_IN_WAIT,
    );
  }
}

/** Count a failed password against the email. After the response: the refusal waits for nothing. */
export async function recordFailure(c: Context<HonoEnv>, policy: SignInPolicy, email: string): Promise<void> {
  const ctx = c.get('helppuff');
  const windowSeconds = policy.windowMinutes * 60;
  const key = failKey(await accountKey(c, email), windowSeconds, ctx.platform.now());
  const write = (async () => {
    const count = Number.parseInt((await ctx.platform.kv.get(key)) ?? '0', 10) || 0;
    await ctx.platform.kv.put(key, String(count + 1), { expirationTtl: Math.max(60, windowSeconds * 2) });
  })();
  ctx.platform.waitUntil(write);
}

/** Turnstile on the sign-in form, when the policy has one. The owner's CLI is exempt. */
export async function assertSignInCaptcha(c: Context<HonoEnv>, policy: SignInPolicy, token: unknown): Promise<void> {
  const ctx = c.get('helppuff');
  if (!policy.captcha || (await ctx.isOwner())) return;
  await assertTurnstile(policy.captcha.secret, typeof token === 'string' ? token : undefined, ctx.platform);
}

export const signInRoutes = new Hono<HonoEnv>();

/** What the sign-in page needs before anyone is signed in: the Turnstile site key, if any. */
signInRoutes.get('/login/options', async (c) => {
  const policy = await signInPolicy(c);
  return c.json({ captcha: policy.captcha ? { provider: 'turnstile', siteKey: policy.captcha.siteKey } : null });
});

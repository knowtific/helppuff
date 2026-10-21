import { CliError, EXIT } from '../errors.js';
import type { CloudflareApi, EmailRoutingRule } from './cloudflare.js';

/**
 * Answers by email (Customer emails, C), Cloudflare's side: Email Routing on
 * a subdomain of a zone in the Worker's account, and one literal rule
 * handing `reply@<subdomain>` to the Worker. Never the zone's apex, and
 * never a name whose mail goes elsewhere: that would take over the owner's
 * own inbox. Sub-addressing (`reply+…@`) is a zone setting with no
 * documented API: when it is off, the owner turns it on (one click).
 */

export const SUBADDRESSING_PATH = 'Cloudflare dashboard → your domain → Email → Email Routing → Settings → Subaddressing: on';

const CLOUDFLARE_MX = /\.mx\.cloudflare\.net\.?$/i;

export function normalizeSubdomain(value: string): string {
  const host = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    throw new CliError('usage', `${value} is not a domain name like chat.acme.com.`, { exitCode: EXIT.usage });
  }
  return host;
}

/** `chat.<the website's domain>`, the suggestion when none is given. */
export function suggestSubdomain(website: string | undefined): string | null {
  try {
    const host = new URL(website ?? '').hostname.replace(/^www\./, '');
    return host.includes('.') ? `chat.${host}` : null;
  } catch {
    return null;
  }
}

export const replyRuleAddress = (subdomain: string) => `reply@${subdomain}`;

const isOurRule = (rule: EmailRoutingRule, subdomain: string) => rule.matchers.some((m) => m.type === 'literal' && m.value?.toLowerCase() === replyRuleAddress(subdomain));

export type RepliesState = {
  subdomain: string;
  zone: { id: string; name: string };
  /** Cloudflare's MX records are on the subdomain. */
  receiving: boolean;
  subaddressing: boolean | null;
  rule: { id: string; worker: string | null; enabled: boolean } | null;
};

async function zoneFor(api: CloudflareApi, subdomain: string): Promise<{ id: string; name: string }> {
  const zone = await api.findZone(subdomain);
  if (!zone) {
    throw new CliError('email_domain_not_on_cloudflare', `${subdomain}'s domain is not on Cloudflare in this account; answers by email need it there.`, {
      hint: 'Move the domain\'s DNS to Cloudflare (same account as the Worker), or leave answers by email off. Copies and replies by email work without it.',
      exitCode: EXIT.usage,
    });
  }
  if (zone.name === subdomain) {
    throw new CliError('email_apex', `Use a subdomain, not ${subdomain} itself.`, {
      hint: `Email Routing on ${subdomain} would take over its mail (your inbox). Pick one like chat.${subdomain}.`,
      exitCode: EXIT.usage,
    });
  }
  return zone;
}

export async function repliesState(api: CloudflareApi, subdomain: string): Promise<RepliesState> {
  const zone = await zoneFor(api, subdomain);
  const [mx, settings, rules] = await Promise.all([api.mxRecords(zone.id, subdomain), api.emailRouting(zone.id), api.emailRoutingRules(zone.id).catch(() => [] as EmailRoutingRule[])]);
  const rule = rules.find((r) => isOurRule(r, subdomain));
  return {
    subdomain,
    zone,
    receiving: mx.length > 0 && mx.every((r) => CLOUDFLARE_MX.test(r.content)),
    subaddressing: settings?.support_subaddress ?? null,
    rule: rule ? { id: rule.id, worker: rule.actions.find((a) => a.type === 'worker')?.value?.[0] ?? null, enabled: rule.enabled !== false } : null,
  };
}

/**
 * Receive at `subdomain` and hand `reply@subdomain` to `worker`. Safe to run
 * again: an existing rule is pointed at the Worker, Email Routing already on
 * is left as it is.
 */
export async function setUpReplies(api: CloudflareApi, subdomain: string, worker: string, progress?: (message: string) => void, waitMs = 30_000): Promise<RepliesState> {
  const zone = await zoneFor(api, subdomain);
  const mx = await api.mxRecords(zone.id, subdomain);
  const foreign = mx.filter((r) => !CLOUDFLARE_MX.test(r.content));
  if (foreign.length) {
    throw new CliError('email_mx_in_use', `${subdomain} already receives mail elsewhere (${foreign.map((r) => r.content).join(', ')}).`, {
      hint: 'Pick a subdomain nothing receives mail at, like chat.' + zone.name + ': Email Routing would replace those MX records.',
      details: { mx: foreign },
      exitCode: EXIT.usage,
    });
  }
  if (!mx.length) {
    progress?.(`Turning Email Routing on for ${subdomain}…`);
    try {
      await api.enableEmailRouting(zone.id, subdomain);
    } catch (thrown) {
      // Already on (a second run): the records below say so.
      if (!(thrown instanceof CliError) || !/already|exists/i.test(thrown.message)) throw thrown;
    }
    for (const until = Date.now() + waitMs; Date.now() < until; ) {
      if ((await api.mxRecords(zone.id, subdomain)).some((r) => CLOUDFLARE_MX.test(r.content))) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  const existing = (await api.emailRoutingRules(zone.id)).find((r) => isOurRule(r, subdomain));
  progress?.(`${existing ? 'Pointing' : 'Adding'} the rule ${replyRuleAddress(subdomain)} → ${worker}…`);
  await api.putEmailWorkerRule(zone.id, replyRuleAddress(subdomain), worker, existing?.id);
  return repliesState(api, subdomain);
}

/** Remove the rule (Email Routing stays on the subdomain). */
export async function removeReplies(api: CloudflareApi, subdomain: string, ruleId: string | undefined): Promise<boolean> {
  const zone = await api.findZone(subdomain);
  if (!zone) return false;
  const id = ruleId ?? (await api.emailRoutingRules(zone.id)).find((r) => isOurRule(r, subdomain))?.id;
  if (!id) return false;
  try {
    await api.deleteEmailRoutingRule(zone.id, id);
    return true;
  } catch (thrown) {
    if (thrown instanceof CliError && thrown.details?.['status'] === 404) return false;
    throw thrown;
  }
}

import { CliError, EXIT } from '../errors.js';
import type { CloudflareApi, WorkerDomain } from './cloudflare.js';
import type { Project } from './project.js';

/**
 * A custom domain for the Worker (`helppuff domain`): `chat.acme.com` instead
 * of `knowtific-helppuff-acme.you.workers.dev`. Attached with Workers Custom
 * Domains, so Cloudflare makes the DNS record and the certificate; the
 * domain must be a zone on the same Cloudflare account. workers.dev keeps
 * working, and the CLI keeps using it, so nothing breaks while the domain's
 * certificate is issued or if the domain is removed.
 */

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** `https://Chat.Acme.com/` → `chat.acme.com`; anything that is not a hostname is refused. */
export function normalizeHostname(input: string): string {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
  if (!HOSTNAME.test(host) || host.endsWith('.workers.dev')) {
    throw new CliError('invalid_domain', `"${input}" is not a domain name.`, { hint: 'Use a hostname on your own domain, like chat.acme.com', exitCode: EXIT.usage });
  }
  return host;
}

/** Where visitors and the team reach the Worker: the custom domain when there is one, else workers.dev. */
export function publicUrl(project: Pick<Project, 'cloudflare'>): string | null {
  const domain = project.cloudflare.domain;
  if (domain) return `https://${domain}`;
  return project.cloudflare.url?.replace(/\/$/, '') ?? null;
}

/** The same link on the public address (a setup link minted through workers.dev). */
export function onPublicUrl(link: string, project: Pick<Project, 'cloudflare'>): string {
  const base = publicUrl(project);
  if (!base || !project.cloudflare.domain) return link;
  const url = new URL(link);
  return `${base}${url.pathname}${url.search}${url.hash}`;
}

/** Attach `hostname` to the Worker (again, if it already is: the call is idempotent). */
export async function attachDomain(api: CloudflareApi, accountId: string, worker: string, hostname: string): Promise<WorkerDomain> {
  const zone = await api.findZone(hostname);
  try {
    return await api.attachWorkerDomain(accountId, hostname, worker, zone);
  } catch (thrown) {
    if (!(thrown instanceof CliError) || thrown.code === 'cloudflare_permission' || thrown.code === 'network') throw thrown;
    const said = thrown.message;
    if (/dns record|cname|externally managed|already exists|conflict/i.test(said)) {
      throw new CliError('domain_dns_conflict', `${hostname} already has a DNS record, so Cloudflare cannot point it at the Worker.`, {
        hint: `Delete the existing record for ${hostname} in the Cloudflare dashboard (your domain → DNS → Records), then run \`helppuff domain add ${hostname}\` again.`,
        details: { cloudflare: said },
      });
    }
    if (!zone) {
      throw new CliError('domain_not_on_cloudflare', `${hostname} is not on this Cloudflare account.`, {
        hint: 'Add the domain to Cloudflare (dash.cloudflare.com → Add a domain, then change its nameservers at your registrar) on the account this assistant is deployed to, wait until it is Active, then run this again.',
        details: { cloudflare: said },
      });
    }
    throw thrown;
  }
}

/** Whether the domain already answers for the Worker (its certificate can take a few minutes). */
export async function domainAnswers(hostname: string, doFetch: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await doFetch(`https://${hostname}/healthz`, { signal: AbortSignal.timeout(8000) });
    return response.ok;
  } catch {
    return false;
  }
}

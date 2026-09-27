import { CliError } from '../errors.js';
import { CloudflareApi, TOKEN_HELP, type Account } from './cloudflare.js';
import { wranglerOAuthToken } from './wrangler-auth.js';

export type CloudflareSession = {
  api: CloudflareApi;
  accountId: string;
  accountName: string | null;
  token: string;
  /** `login` = wrangler's OAuth token, which wrangler itself refreshes. */
  source: 'api-token' | 'login';
};

export const LOGIN_HINT = 'Run `npx wrangler login` (opens a browser; no token needed), or create an API token:';

/**
 * A working Cloudflare session from, in order: explicit values, the
 * environment / .env, and the one account the token can see. Fails with a
 * specific, actionable error for each way this goes wrong.
 */
export async function cloudflareSession(
  env: Record<string, string>,
  explicit: { token?: string | undefined; accountId?: string | undefined } = {},
  doFetch: typeof fetch = fetch,
): Promise<CloudflareSession> {
  const apiToken = explicit.token || env['CLOUDFLARE_API_TOKEN'];
  const token = apiToken || (await wranglerOAuthToken());
  const source = apiToken ? 'api-token' : 'login';
  if (!token) {
    throw new CliError('needs_cloudflare_token', 'Not connected to Cloudflare.', {
      hint: `${LOGIN_HINT}\n${TOKEN_HELP}\nthen: murmur secret set CLOUDFLARE_API_TOKEN`,
    });
  }
  const api = new CloudflareApi(token, doFetch);
  const accountId = explicit.accountId || env['CLOUDFLARE_ACCOUNT_ID'];

  let accounts: Account[] = [];
  try {
    accounts = await api.accounts();
  } catch (thrown) {
    // A token scoped without Account Settings › Read cannot list accounts,
    // which is fine when the account id is already known.
    if (!accountId) throw thrown;
  }

  if (accountId) {
    const match = accounts.find((a) => a.id === accountId);
    if (accounts.length > 0 && !match) {
      throw new CliError('cloudflare_account_mismatch', `The token cannot access account ${accountId}.`, {
        hint: `Accounts this token can use: ${accounts.map((a) => `${a.name} (${a.id})`).join(', ')}`,
      });
    }
    return { api, accountId, accountName: match?.name ?? null, token, source };
  }
  if (accounts.length === 0) {
    throw new CliError('cloudflare_no_account', 'The Cloudflare token cannot see any account.', {
      hint: 'Give the token "Account Settings › Read" and include your account under Account Resources, or set CLOUDFLARE_ACCOUNT_ID.',
    });
  }
  if (accounts.length > 1) {
    throw new CliError('needs_cloudflare_account', 'The token can access several Cloudflare accounts; pick one.', {
      hint: 'Pass --cf-account <id> or set CLOUDFLARE_ACCOUNT_ID.',
      details: { accounts },
    });
  }
  return { api, accountId: accounts[0]!.id, accountName: accounts[0]!.name, token, source };
}

/** Validate a token and list its accounts without choosing one. */
export async function listAccounts(token: string, doFetch: typeof fetch = fetch): Promise<Account[]> {
  return new CloudflareApi(token, doFetch).accounts();
}

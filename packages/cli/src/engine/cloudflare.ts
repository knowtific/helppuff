import { CliError, EXIT } from '../errors.js';

/**
 * The slice of the Cloudflare REST API setup needs, over plain fetch.
 *
 * Wrangler does the one thing it is uniquely good at — bundling and
 * uploading the Worker with its static assets. Everything else (accounts,
 * the workers.dev subdomain, KV, secrets, AI Search) goes through here,
 * because the REST API returns JSON and structured errors where wrangler
 * returns prose meant for a terminal.
 *
 * AI Search endpoints verified against developers.cloudflare.com on
 * 2026-09-24: /accounts/{id}/ai-search/namespaces/default/instances[/{id}
 * [/items|/stats]].
 */

const API = 'https://api.cloudflare.com/client/v4';

/** The permissions `helppuff` asks for, as named in the dashboard's token editor. */
export const TOKEN_PERMISSIONS = [
  'Account › Workers Scripts › Edit',
  'Account › Workers KV Storage › Edit',
  'Account › D1 › Edit',
  'Account › Vectorize › Edit',
  'Account › Account Settings › Read',
  'Account › AI Search › Edit (only for the Cloudflare AI Search backend)',
  'Account › AI Search › Run (only for the Cloudflare AI Search backend)',
];

export const TOKEN_HELP = [
  'Create one at https://dash.cloudflare.com/profile/api-tokens → Create Token → Create Custom Token, with:',
  ...TOKEN_PERMISSIONS.map((p) => `  • ${p}`),
  'Account Resources: Include → your account. Then paste the token.',
].join('\n');

export type Account = { id: string; name: string };
export type AiSearchInstance = {
  id: string;
  type?: string;
  source?: string;
  ai_search_model?: string;
  status?: string;
  public_endpoint_id?: string;
  [key: string]: unknown;
};
export type AiSearchItem = { id: string; key: string; status?: string; checksum?: string };
export type CrawlerSource = { host: string; parseType: 'sitemap' | 'discover'; limit: number; rendered?: boolean };

type Envelope<T> = {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
  result_info?: { page?: number; per_page?: number; total_count?: number; count?: number };
};

export class CloudflareApi {
  constructor(
    private readonly token: string,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  private async call<T>(
    method: string,
    path: string,
    body?: { json?: unknown; form?: FormData },
  ): Promise<Envelope<T>> {
    let response: Response;
    try {
      response = await this.doFetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body?.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body?.form ?? (body?.json !== undefined ? JSON.stringify(body.json) : undefined),
      });
    } catch (thrown) {
      throw new CliError('network', `Could not reach the Cloudflare API: ${(thrown as Error).message}`, {
        hint: 'Check your internet connection and try again.',
      });
    }

    const text = await response.text();
    let parsed: Envelope<T> | null = null;
    try {
      parsed = JSON.parse(text) as Envelope<T>;
    } catch {
      // Handled below.
    }
    if (response.ok && parsed?.success !== false) {
      return parsed ?? ({ success: true, result: undefined } as Envelope<T>);
    }
    throw cloudflareError(response.status, method, path, parsed?.errors ?? [], text);
  }

  async accounts(): Promise<Account[]> {
    const out = await this.call<Account[]>('GET', '/accounts?per_page=50');
    return (out.result ?? []).map((a) => ({ id: a.id, name: a.name }));
  }

  async subdomain(accountId: string): Promise<string | null> {
    try {
      const out = await this.call<{ subdomain?: string }>('GET', `/accounts/${accountId}/workers/subdomain`);
      return out.result?.subdomain || null;
    } catch (thrown) {
      if (thrown instanceof CliError && thrown.details?.['status'] === 404) return null;
      throw thrown;
    }
  }

  async createSubdomain(accountId: string, subdomain: string): Promise<string> {
    const out = await this.call<{ subdomain: string }>('PUT', `/accounts/${accountId}/workers/subdomain`, {
      json: { subdomain },
    });
    return out.result.subdomain;
  }

  async workerExists(accountId: string, name: string): Promise<boolean> {
    try {
      await this.call('GET', `/accounts/${accountId}/workers/scripts/${name}/settings`);
      return true;
    } catch (thrown) {
      if (thrown instanceof CliError && thrown.details?.['status'] === 404) return false;
      throw thrown;
    }
  }

  async kvNamespaces(accountId: string): Promise<{ id: string; title: string }[]> {
    const out = await this.call<{ id: string; title: string }[]>(
      'GET',
      `/accounts/${accountId}/storage/kv/namespaces?per_page=100`,
    );
    return out.result ?? [];
  }

  async ensureKvNamespace(accountId: string, title: string): Promise<string> {
    const existing = (await this.kvNamespaces(accountId)).find((ns) => ns.title === title);
    if (existing) return existing.id;
    const out = await this.call<{ id: string }>('POST', `/accounts/${accountId}/storage/kv/namespaces`, {
      json: { title },
    });
    return out.result.id;
  }

  async kvPut(accountId: string, namespaceId: string, key: string, value: string): Promise<void> {
    const form = new FormData();
    form.set('value', value);
    form.set('metadata', '{}');
    await this.call('PUT', `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`, {
      form,
    });
  }

  /** The raw value, or null when the key does not exist. This endpoint answers with the value itself, not an envelope. */
  async kvGet(accountId: string, namespaceId: string, key: string): Promise<string | null> {
    const path = `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
    let response: Response;
    try {
      response = await this.doFetch(`${API}${path}`, { headers: { Authorization: `Bearer ${this.token}` } });
    } catch (thrown) {
      throw new CliError('network', `Could not reach the Cloudflare API: ${(thrown as Error).message}`, {
        hint: 'Check your internet connection and try again.',
      });
    }
    if (response.status === 404) return null;
    const text = await response.text();
    if (response.ok) return text;
    let errors: { code: number; message: string }[] = [];
    try {
      errors = (JSON.parse(text) as { errors?: typeof errors }).errors ?? [];
    } catch {
      // Not JSON; the status says enough.
    }
    throw cloudflareError(response.status, 'GET', path, errors, text);
  }

  async secretNames(accountId: string, script: string): Promise<string[]> {
    const out = await this.call<{ name: string }[]>('GET', `/accounts/${accountId}/workers/scripts/${script}/secrets`);
    return (out.result ?? []).map((s) => s.name);
  }

  async putSecret(accountId: string, script: string, name: string, text: string): Promise<void> {
    await this.call('PUT', `/accounts/${accountId}/workers/scripts/${script}/secrets`, {
      json: { name, text, type: 'secret_text' },
    });
  }

  // ------------------------------------------------------------ D1

  async ensureD1Database(accountId: string, name: string): Promise<string> {
    const found = await this.call<{ uuid: string; name: string }[]>(
      'GET',
      `/accounts/${accountId}/d1/database?name=${encodeURIComponent(name)}&per_page=50`,
    );
    const match = (found.result ?? []).find((db) => db.name === name);
    if (match) return match.uuid;
    const created = await this.call<{ uuid: string }>('POST', `/accounts/${accountId}/d1/database`, { json: { name } });
    return created.result.uuid;
  }

  async d1Query<T = Record<string, unknown>>(accountId: string, databaseId: string, sql: string, params: unknown[] = []): Promise<T[]> {
    const out = await this.call<{ results?: T[]; success?: boolean }[]>(
      'POST',
      `/accounts/${accountId}/d1/database/${databaseId}/query`,
      { json: { sql, params } },
    );
    return out.result?.[0]?.results ?? [];
  }

  async deleteD1Database(accountId: string, databaseId: string): Promise<void> {
    await this.call('DELETE', `/accounts/${accountId}/d1/database/${databaseId}`);
  }

  // ------------------------------------------------------------ Vectorize
  // developers.cloudflare.com/api/resources/vectorize (checked 2026-10-04):
  //   POST   /vectorize/v2/indexes                       { name, config: { dimensions, metric } }
  //   GET    /vectorize/v2/indexes/{name}
  //   DELETE /vectorize/v2/indexes/{name}
  //   POST   /vectorize/v2/indexes/{name}/metadata_index/create   { propertyName, indexType }
  //   GET    /vectorize/v2/indexes/{name}/metadata_index/list

  async vectorizeIndex(accountId: string, name: string): Promise<{ name: string; dimensions: number; metric: string } | null> {
    try {
      const out = await this.call<{ name: string; config?: { dimensions?: number; metric?: string } }>(
        'GET',
        `/accounts/${accountId}/vectorize/v2/indexes/${encodeURIComponent(name)}`,
      );
      return { name: out.result.name, dimensions: out.result.config?.dimensions ?? 0, metric: out.result.config?.metric ?? '' };
    } catch (thrown) {
      if (thrown instanceof CliError && (thrown.details?.['status'] === 404 || thrown.details?.['status'] === 410)) return null;
      throw thrown;
    }
  }

  /** Find or create the index, and the metadata index on `category`. Refuses an index with the wrong vector size. */
  async ensureVectorizeIndex(accountId: string, name: string, dimensions: number): Promise<{ created: boolean }> {
    const existing = await this.vectorizeIndex(accountId, name);
    if (existing && existing.dimensions && existing.dimensions !== dimensions) {
      throw new CliError('vectorize_dimensions', `The Vectorize index ${name} stores ${existing.dimensions}-dimension vectors; the embedding model makes ${dimensions}.`, {
        hint: `Use the embedding model the index was made for, or delete the index (\`npx wrangler vectorize delete ${name}\`) and deploy again — the next crawl refills it.`,
      });
    }
    if (!existing) {
      await this.call('POST', `/accounts/${accountId}/vectorize/v2/indexes`, {
        json: { name, description: 'HelpPuff knowledge base', config: { dimensions, metric: 'cosine' } },
      });
    }
    const listed = await this.call<{ metadataIndexes?: { propertyName?: string }[] }>(
      'GET',
      `/accounts/${accountId}/vectorize/v2/indexes/${encodeURIComponent(name)}/metadata_index/list`,
    ).catch(() => null);
    if (!listed?.result?.metadataIndexes?.some((m) => m.propertyName === 'category')) {
      await this.call('POST', `/accounts/${accountId}/vectorize/v2/indexes/${encodeURIComponent(name)}/metadata_index/create`, {
        json: { propertyName: 'category', indexType: 'string' },
      });
    }
    return { created: !existing };
  }

  async deleteVectorizeIndex(accountId: string, name: string): Promise<void> {
    await this.call('DELETE', `/accounts/${accountId}/vectorize/v2/indexes/${encodeURIComponent(name)}`);
  }

  // ------------------------------------------------------------ teardown

  async deleteWorker(accountId: string, name: string): Promise<void> {
    await this.call('DELETE', `/accounts/${accountId}/workers/scripts/${name}?force=true`);
  }

  async deleteWorkflow(accountId: string, name: string): Promise<void> {
    await this.call('DELETE', `/accounts/${accountId}/workflows/${encodeURIComponent(name)}`);
  }

  async deleteKvNamespace(accountId: string, namespaceId: string): Promise<void> {
    await this.call('DELETE', `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`);
  }

  async deleteAiSearchInstance(accountId: string, id: string): Promise<void> {
    await this.call('DELETE', this.aiSearch(accountId, `/${id}`));
  }

  // ------------------------------------------------------------ AI Search

  private aiSearch(accountId: string, suffix = ''): string {
    return `/accounts/${accountId}/ai-search/namespaces/default/instances${suffix}`;
  }

  async aiSearchInstances(accountId: string): Promise<AiSearchInstance[]> {
    const out = await this.call<AiSearchInstance[]>('GET', `${this.aiSearch(accountId)}?per_page=50`);
    return out.result ?? [];
  }

  async aiSearchInstance(accountId: string, id: string): Promise<AiSearchInstance | null> {
    try {
      return (await this.call<AiSearchInstance>('GET', this.aiSearch(accountId, `/${id}`))).result;
    } catch (thrown) {
      if (thrown instanceof CliError && thrown.details?.['status'] === 404) return null;
      throw thrown;
    }
  }

  /**
   * Create an instance. With `crawler`, AI Search crawls the site itself —
   * only allowed for a domain that is a zone on the same account — and keeps
   * it in sync on a schedule; otherwise files are uploaded to built-in
   * storage.
   */
  async createAiSearchInstance(
    accountId: string,
    id: string,
    options: { model?: string | undefined; crawler?: CrawlerSource | undefined } = {},
  ): Promise<AiSearchInstance> {
    const crawler = options.crawler;
    const out = await this.call<AiSearchInstance>('POST', this.aiSearch(accountId), {
      json: {
        id,
        ...(options.model ? { ai_search_model: options.model } : {}),
        ...(crawler
          ? {
              type: 'web-crawler',
              source: crawler.host,
              source_params: {
                web_crawler: {
                  parse_type: crawler.parseType,
                  ...(crawler.parseType === 'discover'
                    ? { discover_options: { limit: crawler.limit, depth: 4, source: 'all', include_subdomains: false } }
                    : {}),
                  ...(crawler.rendered ? { parse_options: { use_browser_rendering: true } } : {}),
                },
              },
            }
          : {}),
      },
    });
    return out.result;
  }

  /** The zone that serves `host` on this account, trying parent domains too. */
  async findZone(host: string): Promise<{ id: string; name: string } | null> {
    const labels = host.toLowerCase().replace(/\.$/, '').split('.');
    for (let i = 0; i <= labels.length - 2; i++) {
      const name = labels.slice(i).join('.');
      try {
        const out = await this.call<{ id: string; name: string }[]>('GET', `/zones?name=${encodeURIComponent(name)}&per_page=5`);
        const zone = (out.result ?? []).find((z) => z.name === name);
        if (zone) return { id: zone.id, name: zone.name };
      } catch {
        // No zone read permission: behave as if the domain is not on this account.
        return null;
      }
    }
    return null;
  }

  async aiSearchItems(accountId: string, id: string): Promise<AiSearchItem[]> {
    const items: AiSearchItem[] = [];
    // The API caps per_page at 50 (verified 2026-09-25).
    for (let page = 1; page <= 400; page++) {
      const out = await this.call<AiSearchItem[]>('GET', this.aiSearch(accountId, `/${id}/items?page=${page}&per_page=50`));
      const batch = out.result ?? [];
      items.push(...batch);
      const total = out.result_info?.total_count;
      if (batch.length < 50 || (total !== undefined && items.length >= total)) break;
    }
    return items;
  }

  async uploadAiSearchItem(accountId: string, id: string, name: string, content: Blob): Promise<AiSearchItem> {
    const form = new FormData();
    form.set('file', content, name);
    const out = await this.call<AiSearchItem>('POST', this.aiSearch(accountId, `/${id}/items`), { form });
    return out.result;
  }

  async deleteAiSearchItem(accountId: string, id: string, itemId: string): Promise<void> {
    await this.call('DELETE', this.aiSearch(accountId, `/${id}/items/${itemId}`));
  }

  async aiSearchJobs(accountId: string, id: string): Promise<{ id: string; source?: string; started_at?: string; ended_at?: string | null }[]> {
    const out = await this.call<{ id: string; source?: string; started_at?: string; ended_at?: string | null }[]>(
      'GET',
      this.aiSearch(accountId, `/${id}/jobs?per_page=5`),
    );
    return out.result ?? [];
  }

  async aiSearchStats(accountId: string, id: string): Promise<Record<string, unknown>> {
    return (await this.call<Record<string, unknown>>('GET', this.aiSearch(accountId, `/${id}/stats`))).result ?? {};
  }
}

/**
 * Turn Cloudflare's error codes into something a person can act on. The
 * common failure is a token missing one permission, and Cloudflare's own
 * message for that ("Authentication error") names none of them.
 */
function cloudflareError(
  status: number,
  method: string,
  path: string,
  errors: { code: number; message: string }[],
  raw: string,
): CliError {
  const first = errors[0];
  const message = first?.message ?? (raw.slice(0, 200) || `HTTP ${status}`);
  const details = { status, method, path: path.replace(/\/accounts\/[0-9a-f]{32}/, '/accounts/…'), errors };
  const area = /\/d1\//.test(path)
    ? 'D1 › Edit'
    : /vectorize/.test(path)
    ? 'Vectorize › Edit'
    : /ai-search/.test(path)
    ? 'AI Search › Edit and AI Search › Run'
    : /storage\/kv/.test(path)
      ? 'Workers KV Storage › Edit'
      : /workers/.test(path)
        ? 'Workers Scripts › Edit'
        : 'Account Settings › Read';

  if (status === 401 || status === 403 || first?.code === 10000 || first?.code === 9109) {
    return new CliError('cloudflare_permission', `Cloudflare refused ${method} ${details.path}: ${message}`, {
      hint: `The API token needs the "${area}" permission. Edit it at https://dash.cloudflare.com/profile/api-tokens`,
      details,
      exitCode: EXIT.auth,
    });
  }
  if (/\b(limit|quota|exceeded|maximum number)\b/i.test(message) && status !== 404) {
    return new CliError('cloudflare_limit', `Cloudflare ${method} ${details.path}: ${message}`, {
      hint: 'A plan limit was reached. Remove unused resources, or check your plan at https://dash.cloudflare.com.',
      details,
      exitCode: EXIT.quota,
    });
  }
  if (status === 404) {
    return new CliError('cloudflare_not_found', `Not found on Cloudflare: ${details.path}`, { details });
  }
  return new CliError('cloudflare_error', `Cloudflare ${method} ${details.path} failed: ${message}`, {
    ...(status === 429 ? { hint: 'Cloudflare is rate limiting; wait a minute and retry.' } : {}),
    details,
  });
}

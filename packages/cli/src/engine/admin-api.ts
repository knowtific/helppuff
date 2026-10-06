import { CliError, EXIT } from '../errors.js';
import { loadEnv } from './env.js';
import type { LoadedProject } from './project.js';

/**
 * The deployed Worker's admin API (`/admin/api/*`), as the CLI calls it:
 * with `Authorization: Bearer <ADMIN_API_KEY>`, the key `helppuff deploy`
 * generated into `.env`. The dashboard calls the very same endpoints with a
 * session cookie, so the terminal can do everything the browser can.
 */

export const ADMIN_KEY_ENV = 'ADMIN_API_KEY';
/** The plan's `<PKG>_ADMIN_API_KEY`, for agents that pass it in the environment. */
export const ADMIN_KEY_ALIAS = 'HELPPUFF_ADMIN_API_KEY';

export type AdminApi = {
  url: string;
  site: string;
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<T>;
  /** POST raw bytes (a file upload); `query` goes in the URL with the site. */
  upload<T>(path: string, query: Record<string, string>, bytes: Uint8Array, contentType: string): Promise<T>;
};

export function adminApi(loaded: LoadedProject, options: { url?: string; fetch?: typeof fetch; env?: Record<string, string> } = {}): AdminApi {
  const url = (options.url ?? loaded.project.cloudflare.url)?.replace(/\/$/, '');
  if (!url) throw new CliError('not_deployed', 'This assistant has not been deployed yet.', { hint: 'helppuff deploy' });
  const env = options.env ?? loadEnv(loaded.dir);
  const key = env[ADMIN_KEY_ENV] || env[ADMIN_KEY_ALIAS];
  if (!key) {
    throw new CliError('no_admin_key', `No ${ADMIN_KEY_ENV} in .env.`, {
      hint: '`helppuff deploy` generates it and sets it on the Worker. Or set HELPPUFF_ADMIN_API_KEY in the environment.',
      exitCode: EXIT.auth,
    });
  }
  const doFetch = options.fetch ?? fetch;
  const site = loaded.project.site;

  const request = async <T>(method: string, path: string, body?: Record<string, unknown> | { raw: Uint8Array; type: string }): Promise<T> => {
    let response: Response;
    const raw = body && 'raw' in body && body.raw instanceof Uint8Array ? (body as { raw: Uint8Array; type: string }) : null;
    try {
      response = await doFetch(`${url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, ...(raw ? { 'Content-Type': raw.type } : body ? { 'Content-Type': 'application/json' } : {}) },
        ...(raw ? { body: raw.raw as Uint8Array<ArrayBuffer> } : body ? { body: JSON.stringify({ site, ...body }) } : {}),
      });
    } catch (thrown) {
      throw new CliError('network', `Could not reach ${url}: ${(thrown as Error).message}`, { hint: 'Check the address, or run `helppuff doctor`.' });
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Handled below.
    }
    if (response.ok) return json as T;
    const error = (json as { error?: { code?: string; message?: string } } | null)?.error;
    const message = error?.message ?? `HTTP ${response.status}`;
    if (response.status === 401) {
      throw new CliError('admin_unauthorized', `The Worker refused the admin API key: ${message}`, {
        hint: `${ADMIN_KEY_ENV} in .env does not match the Worker's. Run \`helppuff deploy\` to set it again.`,
        exitCode: EXIT.auth,
      });
    }
    if (response.status === 429) {
      throw new CliError('rate_limited', message, { hint: 'Wait a minute and try again.', exitCode: EXIT.quota });
    }
    throw new CliError(error?.code === 'not_found' ? 'not_found' : 'admin_error', message, {
      details: { status: response.status, path },
      ...(response.status === 404 && /knowledge/.test(path) ? { hint: 'Deploy with the workers-ai backend: `helppuff config set backend.type workers-ai && helppuff deploy`.' } : {}),
    });
  };

  return {
    url,
    site,
    get: (path, query = {}) => {
      const params = new URLSearchParams({ site });
      for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
      return request('GET', `${path}?${params}`);
    },
    send: (method, path, body = {}) => (method === 'DELETE' ? request(method, `${path}?site=${encodeURIComponent(site)}`) : request(method, path, body)),
    upload: (path, query, bytes, contentType) => request('POST', `${path}?${new URLSearchParams({ site, ...query })}`, { raw: bytes, type: contentType }),
  };
}

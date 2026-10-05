import { MurmurError } from '../core/errors.js';
import {
  isSecretRef,
  murmurConfigSchema,
  type MurmurConfig,
  type MurmurConfigInput,
  type SiteConfig,
} from './schema.js';

/**
 * Validate a user's config at build time. Type errors surface in the editor;
 * shape errors surface the first time the Worker is bundled and run.
 */
export function defineConfig(input: MurmurConfigInput): MurmurConfig {
  const result = murmurConfigSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`murmur.config is invalid:\n${formatIssues(result.error.issues)}`);
  }
  if (Object.keys(result.data.sites).length === 0) {
    throw new Error('murmur.config must define at least one site.');
  }
  return result.data;
}

function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
}

export function getSite(config: MurmurConfig, siteId: string): SiteConfig {
  const site = config.sites[siteId];
  if (!site) throw new MurmurError('not_found', { detail: 'unknown_site' });
  return site;
}

/**
 * Replace every `{ env: 'NAME' }` reference with the value from the runtime
 * environment. Runs per request because Worker secrets only exist there.
 */
export function resolveSecrets(value: unknown, env: Record<string, unknown>, path = 'options'): unknown {
  if (isSecretRef(value)) {
    const name = value.env;
    const resolved = env[name];
    if (typeof resolved !== 'string' || resolved.length === 0) {
      throw new MurmurError('internal', { detail: `missing_secret:${name}` });
    }
    return resolved;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => resolveSecrets(item, env, `${path}[${index}]`));
  }

  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = resolveSecrets(item, env, `${path}.${key}`);
    }
    return out;
  }

  return value;
}

/** Collect every env var name a config references: the Worker secrets a deploy must set. */
export function collectSecretNames(value: unknown, into = new Set<string>()): Set<string> {
  if (isSecretRef(value)) {
    into.add(value.env);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSecretNames(item, into);
    return into;
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectSecretNames(item, into);
  }
  return into;
}

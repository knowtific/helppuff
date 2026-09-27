import { compile, embedSnippet } from './compile.js';
import { cloudflareSession, type CloudflareSession } from './credentials.js';
import { loadEnv } from './env.js';
import { checkKey } from './providers.js';
import { aiSearchInstanceFor, hasKnowledge, loadProject, workerNameFor, type LoadedProject } from './project.js';
import { PROVIDER_KEYS } from './questions.js';
import { healthCheck } from './deploy.js';

/**
 * Every check that explains "why isn't it working", each with the fix.
 * Checks never throw: a failing check is a result, and later checks still
 * run where they can.
 */

export type Check = { name: string; status: 'pass' | 'fail' | 'warn' | 'skip'; detail: string; fix?: string };

async function attempt(name: string, run: () => Promise<Omit<Check, 'name'>>): Promise<Check> {
  try {
    return { name, ...(await run()) };
  } catch (thrown) {
    const error = thrown as { message?: string; hint?: string };
    return { name, status: 'fail', detail: error.message ?? String(thrown), ...(error.hint ? { fix: error.hint } : {}) };
  }
}

export async function doctor(cwd: string, doFetch: typeof fetch = fetch): Promise<{ checks: Check[]; ok: boolean }> {
  const checks: Check[] = [];
  let loaded: LoadedProject | null = null;

  checks.push(
    await attempt('murmur.json', async () => {
      loaded = loadProject(cwd);
      return { status: 'pass', detail: `${loaded.file} is valid (site "${loaded.project.site}", backend ${loaded.project.backend.type})` };
    }),
  );
  if (!loaded) return { checks, ok: false };
  const project = (loaded as LoadedProject).project;
  const env = loadEnv((loaded as LoadedProject).dir);

  let secrets: string[] = [];
  checks.push(
    await attempt('config', async () => {
      const compiled = compile(loaded!);
      secrets = compiled.secrets;
      return { status: 'pass', detail: 'prompt, backend options and widget compile cleanly' };
    }),
  );

  const missing = secrets.filter((name) => name !== 'MURMUR_SECRET' && !env[name]);
  checks.push({
    name: 'local secrets',
    status: missing.length ? 'fail' : 'pass',
    detail: missing.length ? `missing: ${missing.join(', ')}` : `all set (${secrets.filter((s) => s !== 'MURMUR_SECRET').join(', ') || 'none needed'})`,
    ...(missing.length ? { fix: missing.map((name) => `murmur secret set ${name}`).join('\n') } : {}),
  });

  const keyName = PROVIDER_KEYS[project.backend.type];
  if (keyName && env[keyName]) {
    const provider = project.backend.type as 'openai' | 'gemini' | 'anthropic' | 'retell';
    const agentId = project.backend.type === 'retell' ? project.backend.agentId : undefined;
    const result = await checkKey(provider, env[keyName]!, agentId ? { agentId } : {}, doFetch);
    checks.push({
      name: `${provider} key`,
      status: result.ok === true ? 'pass' : result.ok === false ? 'fail' : 'warn',
      detail: result.ok === true ? `${keyName} works` : result.reason,
      ...(result.ok === false ? { fix: `murmur secret set ${keyName}` } : {}),
    });
  }

  let cf: CloudflareSession | null = null;
  checks.push(
    await attempt('cloudflare', async () => {
      cf = await cloudflareSession(env, {}, doFetch);
      return { status: 'pass', detail: `token works; account ${cf.accountName ?? ''} (${cf.accountId})` };
    }),
  );
  const session = cf as CloudflareSession | null;
  const workerName = workerNameFor(project);

  const instance = aiSearchInstanceFor(project);
  if (instance && session) {
    checks.push(
      await attempt('ai search', async () => {
        const found = await session.api.aiSearchInstance(session.accountId, instance);
        if (!found) {
          return { status: 'fail', detail: `instance "${instance}" does not exist`, fix: 'murmur deploy (creates it) or murmur knowledge sync' };
        }
        const stats = await session.api.aiSearchStats(session.accountId, instance).catch(() => ({}) as Record<string, unknown>);
        const indexed = Number(stats['completed'] ?? 0);
        const queued = Number(stats['queued'] ?? 0) + Number(stats['running'] ?? 0);
        const errors = Number(stats['error'] ?? 0);
        if (hasKnowledge(project) && indexed === 0 && queued === 0 && found.type !== 'web-crawler') {
          return { status: 'warn', detail: `instance "${instance}" is empty`, fix: 'murmur knowledge sync' };
        }
        return {
          status: errors ? 'warn' : 'pass',
          detail: `instance "${instance}": ${indexed} indexed, ${queued} in progress${errors ? `, ${errors} failed` : ''}`,
        };
      }),
    );
  }

  if (session) {
    checks.push(
      await attempt('worker', async () => {
        const exists = await session.api.workerExists(session.accountId, workerName);
        if (!exists) return { status: 'fail', detail: `Worker "${workerName}" is not deployed`, fix: 'murmur deploy' };
        const onWorker = new Set(await session.api.secretNames(session.accountId, workerName));
        const absent = secrets.filter((name) => !onWorker.has(name));
        if (absent.length) {
          return { status: 'fail', detail: `deployed, but missing secrets: ${absent.join(', ')}`, fix: 'murmur deploy' };
        }
        return { status: 'pass', detail: `"${workerName}" deployed with all ${secrets.length} secret(s)` };
      }),
    );
  }

  const url = project.cloudflare.url;
  if (url) {
    checks.push(
      await attempt('live', async () => {
        const ok = await healthCheck(url, project.site, project.origins[0] ?? url, doFetch, undefined, 2);
        return ok
          ? { status: 'pass', detail: `${url} answers; embed: ${embedSnippet(url, project.site)}` }
          : { status: 'fail', detail: `${url} does not answer the config route`, fix: 'murmur deploy --force' };
      }),
    );
  } else {
    checks.push({ name: 'live', status: 'skip', detail: 'not deployed yet', fix: 'murmur deploy' });
  }

  return { checks, ok: checks.every((c) => c.status !== 'fail') };
}

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from './env.js';
import { PRESETS, modelOf, retrievalOf, type LoadedProject, type Preset } from './project.js';

/**
 * What HelpPuff's assistant needs from the project folder: the secrets its
 * model and knowledge read (missing from .env, or not), and the site's own
 * module files. Shared by `helppuff model` / `rag` and `doctor`.
 */

export /** The secrets the model and knowledge read, and which are missing from .env. */
function secretsOf(loaded: LoadedProject): { needed: string[]; missing: string[] } {
  const project = loaded.project;
  const model = modelOf(project) as Record<string, unknown> | null;
  const retrieval = retrievalOf(project) as Record<string, unknown> | null;
  const needed = new Set<string>();
  const ref = (value: unknown) => {
    if (value && typeof value === 'object' && typeof (value as { env?: unknown }).env === 'string') needed.add((value as { env: string }).env);
  };
  if (model) {
    ref(model['apiKey']);
    ref(model['gatewayToken']);
    for (const v of Object.values((model['headers'] as Record<string, unknown>) ?? {})) ref(v);
    if (model['provider'] === 'openai-compatible' && !model['apiKey'] && model['preset']) needed.add(PRESETS[model['preset'] as Preset].key);
    for (const name of (model['secrets'] as string[] | undefined) ?? []) needed.add(name);
  }
  if (retrieval) {
    ref(retrieval['apiKey']);
    ref(retrieval['token']);
    for (const name of (retrieval['secrets'] as string[] | undefined) ?? []) needed.add(name);
  }
  const env = loadEnv(loaded.dir);
  return { needed: [...needed], missing: [...needed].filter((name) => !env[name] && !process.env[name]) };
}


/** The custom module files named in helppuff.json that do not exist. */
export function missingModules(loaded: LoadedProject): string[] {
  const model = modelOf(loaded.project);
  const retrieval = retrievalOf(loaded.project);
  const files = [model?.provider === 'custom' ? model.module : null, retrieval?.type === 'custom' ? retrieval.module : null].filter((f): f is string => Boolean(f));
  return files.filter((file) => !existsSync(resolve(loaded.dir, file)));
}

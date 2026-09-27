import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { GENERATED_DIR, projectSchema } from './project.js';

/**
 * The JSON Schema for murmur.json, generated from the same Zod schema the
 * CLI validates with. Written into `.murmur/` so editors (and agents that
 * read `$schema`) get completion and docs without a network fetch.
 */
export function projectJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(projectSchema, { $refStrategy: 'none', effectStrategy: 'input' }) as Record<
    string,
    unknown
  >;
  return { ...schema, title: 'murmur.json', description: 'An AI chat assistant, deployed to Cloudflare by the murmur CLI.' };
}

export function writeSchemaFile(dir: string): string {
  const out = join(dir, GENERATED_DIR, 'murmur.schema.json');
  mkdirSync(join(dir, GENERATED_DIR), { recursive: true });
  writeFileSync(out, `${JSON.stringify(projectJsonSchema(), null, 2)}\n`);
  return out;
}

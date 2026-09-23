/**
 * Print a site's widget config from murmur.config.ts as the JSON that goes
 * into KV under `config:<siteId>`:
 *
 *   node scripts/kv-config.mjs knowtific > site.knowtific.json
 *   wrangler kv key put --binding=MURMUR_KV "config:knowtific" --path ./site.knowtific.json
 *
 * Generated rather than hand-written so the KV copy cannot drift from the
 * file it came from. Only `widget` is exported: `connector`, `sinks` and
 * `security` carry `{ env }` refs and limits that belong in the deploy, and a
 * KV section replaces its deployed counterpart whole (docs/deployment.md).
 *
 * The output is checked against the same schema the Worker parses KV with,
 * so a blob this prints is one the Worker will accept.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const siteId = process.argv[2];
if (!siteId) {
  console.error('usage: node scripts/kv-config.mjs <siteId>');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'murmur-kv-'));
const outfile = join(dir, 'kv.mjs');
let module;
try {
  await build({
    stdin: {
      contents: `
        export { default as config } from './murmur.config.ts';
        export { storedSiteConfigSchema } from './packages/server/src/config/schema.ts';
      `,
      resolveDir: root,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    absWorkingDir: root,
  });
  module = await import(pathToFileURL(outfile).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const site = module.config.sites[siteId];
if (!site) {
  console.error(`No site "${siteId}" in murmur.config.ts. Sites: ${Object.keys(module.config.sites).join(', ')}`);
  process.exit(1);
}

const stored = { widget: site.widget };
const result = module.storedSiteConfigSchema.safeParse(stored);
if (!result.success) {
  console.error('The Worker would reject this config:');
  for (const issue of result.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

console.log(JSON.stringify(stored, null, 2));

/**
 * `murmur.config.ts` is gitignored, so a fresh clone does not have one. Copy
 * the committed demo into place, once, before anything tries to import it.
 *
 * This is what lets the repository hold no site configuration at all while
 * `pnpm dev` still works on a clone with no setup step.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'murmur.config.ts');
const source = resolve(root, 'murmur.config.demo.ts');

if (existsSync(target)) process.exit(0);

if (!existsSync(source)) {
  console.error('murmur.config.demo.ts is missing — cannot create murmur.config.ts.');
  process.exit(1);
}

copyFileSync(source, target);
console.log('Created murmur.config.ts from murmur.config.demo.ts (gitignored — yours to edit).');

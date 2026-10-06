/**
 * Two gitignored files a fresh clone does not have, created once before
 * anything needs them:
 *
 *   helppuff.config.ts          copied from the committed demo
 *   packages/server/.dev.vars   copied from .dev.vars.example, with a random
 *                               HELPPUFF_SECRET (without one the Worker
 *                               refuses to start sessions, so no chat works)
 *
 * This is what lets the repository hold no site configuration or secrets at
 * all while `pnpm dev`, the tests and CI still work on a clone with no setup
 * step. Existing files are never touched.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function missing(source, label) {
  if (existsSync(source)) return false;
  console.error(`${label} is missing — cannot create the local copy.`);
  process.exit(1);
}

const config = resolve(root, 'helppuff.config.ts');
const demo = resolve(root, 'helppuff.config.demo.ts');
if (!existsSync(config) && !missing(demo, 'helppuff.config.demo.ts')) {
  copyFileSync(demo, config);
  console.log('Created helppuff.config.ts from helppuff.config.demo.ts (gitignored — yours to edit).');
}

const devVars = resolve(root, 'packages/server/.dev.vars');
const example = resolve(root, 'packages/server/.dev.vars.example');
if (!existsSync(devVars) && !missing(example, 'packages/server/.dev.vars.example')) {
  const secret = randomBytes(32).toString('base64');
  writeFileSync(devVars, readFileSync(example, 'utf8').replace(/^HELPPUFF_SECRET=.*$/m, `HELPPUFF_SECRET=${secret}`));
  console.log('Created packages/server/.dev.vars with a random HELPPUFF_SECRET (gitignored — add provider keys there).');
}

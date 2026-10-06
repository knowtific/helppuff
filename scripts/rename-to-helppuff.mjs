#!/usr/bin/env node

import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const scriptPath = fileURLToPath(import.meta.url);
const dryRun = process.argv.includes('--dry-run');
const sourceLower = ['mur', 'mur'].join('');
const targetLower = 'helppuff';
const sourcePrefix = ['m', 'm'].join('');
const targetPrefix = 'hp';
const protectedHashPackage = `i${sourceLower}hash`;
const protectedHashToken = ['__PROTECTED', 'HASH', 'PACKAGE__'].join('_');

const replacements = [
  [sourceLower.toUpperCase(), targetLower.toUpperCase()],
  [`${sourceLower[0].toUpperCase()}${sourceLower.slice(1)}`, 'HelpPuff'],
  [sourceLower, targetLower],
  [`${sourcePrefix}: RequestCtx`, `${targetLower}: RequestCtx`],
  [`--${sourcePrefix}-`, `--${targetPrefix}-`],
  [`${sourcePrefix}debug`, `${targetPrefix}debug`],
  [`${sourcePrefix}:`, `${targetPrefix}:`],
  [`${sourcePrefix}-`, `${targetPrefix}-`],
  [`${sourcePrefix}_`, `${targetPrefix}_`],
  [`'${sourcePrefix}'`, `'${targetLower}'`],
  [`"${sourcePrefix}"`, `"${targetLower}"`],
];

const skippedDirectories = new Set([
  '.git',
  '.next',
  '.turbo',
  '.wrangler',
  'coverage',
  'dist',
  'dist-demo',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const decoder = new TextDecoder('utf-8', { fatal: true });
let changedFiles = 0;
let renamedPaths = 0;

function replaceName(value) {
  const protectedValue = value.replaceAll(
    protectedHashPackage,
    protectedHashToken,
  );
  const replacedValue = replacements.reduce(
    (result, [from, to]) => result.replaceAll(from, to),
    protectedValue,
  );
  return replacedValue.replaceAll(protectedHashToken, protectedHashPackage);
}

async function rewriteTextFile(path) {
  if (path === scriptPath) return;

  const contents = await readFile(path);
  let text;

  try {
    text = decoder.decode(contents);
  } catch {
    return;
  }

  const rewritten = replaceName(text);
  if (rewritten === text) return;

  changedFiles += 1;
  process.stdout.write(`${dryRun ? 'would rewrite' : 'rewrote'} ${path}\n`);
  if (!dryRun) await writeFile(path, rewritten);
}

async function processPath(path) {
  const entries = await readdir(path, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;

    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      await processPath(entryPath);
    } else if (entry.isFile()) {
      await rewriteTextFile(entryPath);
    }

    const renamedBase = replaceName(entry.name);
    if (renamedBase === entry.name) continue;

    renamedPaths += 1;
    const renamedPath = join(dirname(entryPath), renamedBase);
    process.stdout.write(
      `${dryRun ? 'would rename' : 'renamed'} ${entryPath} -> ${renamedPath}\n`,
    );
    if (!dryRun) await rename(entryPath, renamedPath);
  }

  if (path === root) return;

  const currentBase = basename(path);
  const renamedBase = replaceName(currentBase);
  if (renamedBase === currentBase) return;

  renamedPaths += 1;
  const renamedPath = join(dirname(path), renamedBase);
  process.stdout.write(
    `${dryRun ? 'would rename' : 'renamed'} ${path} -> ${renamedPath}\n`,
  );
  if (!dryRun) await rename(path, renamedPath);
}

await processPath(root);

process.stdout.write(
  `${dryRun ? 'Would rewrite' : 'Rewrote'} ${changedFiles} files and ` +
    `${dryRun ? 'would rename' : 'renamed'} ${renamedPaths} paths.\n`,
);

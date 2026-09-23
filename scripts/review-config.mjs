/**
 * Read murmur.config.ts and report, per site, whether it is fit to go public.
 *
 * It bundles and imports the real config rather than grepping the file, which
 * matters as soon as there is more than one site: a `demo` site on localhost
 * with deliberately loose development limits sits in the same file as the
 * production one, and a textual check cannot tell them apart. It flagged the
 * dev site's values and never looked at the real site at all.
 *
 * Importing also means the config is validated by `defineConfig` on the way
 * in, so a config that would fail at deploy fails here instead.
 *
 * Exit code is 0 even with warnings — this informs, it does not gate.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const YELLOW = '\u001b[33m';
const GREEN = '\u001b[32m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

const warn = (line) => console.log(`${YELLOW}! ${line}${RESET}`);
const ok = (line) => console.log(`${GREEN}✓ ${line}${RESET}`);
const note = (line) => console.log(`${DIM}  ${line}${RESET}`);

/** A site nobody outside your machine can reach is a development site. */
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const isLocal = (origin) => LOCAL.test(origin.trim());

/*
 * Ceilings a public site should stay under. Deliberately generous: these are
 * "something is clearly wrong" thresholds, not recommendations.
 */
const PUBLIC_MAX = {
  messagesPerIpPerMinute: 60,
  sessionsPerIpPerHour: 60,
  messagesPerSitePerDay: 20_000,
};

async function loadConfig() {
  const dir = mkdtempSync(join(tmpdir(), 'murmur-config-'));
  const outfile = join(dir, 'config.mjs');
  try {
    await build({
      entryPoints: [resolve(root, 'murmur.config.ts')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
      // Workspace packages resolve through node_modules symlinks.
      absWorkingDir: root,
    });
    const module = await import(pathToFileURL(outfile).href);
    return module.default;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/*
 * `--public-site` prints just the id of the first site with a real origin and
 * nothing else, so a shell can build the embed snippet from it. Any failure
 * prints nothing and exits non-zero, leaving the caller to use its fallback.
 */
const quiet = process.argv.includes('--public-site');

let config;
try {
  config = await loadConfig();
} catch (error) {
  if (quiet) process.exit(1);
  warn('Could not load murmur.config.ts, so it was not reviewed.');
  note(String(error?.message ?? error).split('\n')[0]);
  process.exit(0);
}

if (quiet) {
  const site = Object.entries(config.sites ?? {}).find(
    ([, value]) => (value.origins ?? []).some((origin) => !isLocal(origin)),
  );
  if (!site) process.exit(1);
  process.stdout.write(site[0]);
  process.exit(0);
}

const entries = Object.entries(config.sites ?? {});
if (entries.length === 0) {
  warn('No sites configured.');
  process.exit(0);
}

let publicSites = 0;

for (const [siteId, site] of entries) {
  const origins = site.origins ?? [];
  const local = origins.every(isLocal);
  const mixed = !local && origins.some(isLocal);

  if (local) {
    /*
     * A localhost-only site still ships: one config deploys every site, and
     * an Origin header is trivially forged outside a browser. So its limits
     * matter whenever its connector costs money — `echo` is free, everything
     * else is not.
     */
    const free = site.connector?.type === 'echo';
    const loose = Object.entries(PUBLIC_MAX).filter(([key, max]) => {
      const value = site.security?.limits?.[key];
      return typeof value === 'number' && value > max;
    });

    if (!free && loose.length > 0) {
      warn(`${siteId} — localhost only, but it deploys with everything else`);
      for (const [key, max] of loose) {
        console.log(`${YELLOW}  · ${key} is ${site.security.limits[key].toLocaleString()}${RESET}`);
        note(`    Above ${max.toLocaleString()}, on a site using the '${site.connector.type}' connector, which costs money per message.`);
      }
      continue;
    }

    ok(`${siteId} — development only (${origins.length} localhost origin${origins.length === 1 ? '' : 's'})`);
    continue;
  }

  publicSites += 1;
  const problems = [];
  // Deliberate choices, not mistakes: worth stating once, not alarming about.
  const notes = [];

  if (mixed) {
    problems.push([
      'mixes localhost into a public origin list',
      'Anything served from a local dev server can call this site. Split it into its own development site instead.',
    ]);
  }

  const limits = site.security?.limits ?? {};
  for (const [key, max] of Object.entries(PUBLIC_MAX)) {
    const value = limits[key];
    if (typeof value === 'number' && value > max) {
      problems.push([
        `${key} is ${value.toLocaleString()}`,
        `Above ${max.toLocaleString()}, which reads like a development value in front of a paid connector.`,
      ]);
    }
  }

  if (!site.security?.captcha) {
    notes.push([
      'Turnstile is off',
      'Rate limits bound spend, but do not tell a browser from a script. Turn it on by adding `security.captcha` — see docs/security.md.',
    ]);
  }

  if (!site.widget?.chat?.fallbackContact) {
    problems.push([
      'no fallbackContact',
      'A visitor has no way to reach you when the assistant cannot answer.',
    ]);
  }

  const label = origins.filter((origin) => !isLocal(origin)).join(', ');
  if (problems.length === 0) ok(`${siteId} — ${label}`);
  else warn(`${siteId} — ${label}`);

  for (const [headline, detail] of problems) {
    console.log(`${YELLOW}  · ${headline}${RESET}`);
    note(`    ${detail}`);
  }
  for (const [headline, detail] of notes) {
    note(`  · ${headline}`);
    note(`    ${detail}`);
  }
}

if (publicSites === 0) {
  warn('No site has a public origin, so the widget cannot load on a real site yet.');
  note('  Add your domain to a site\'s `origins` — including www, which is a separate origin.');
}

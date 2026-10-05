import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertKnown, str } from '../args.js';
import { CliError, EXIT } from '../errors.js';
import { c } from '../output.js';
import { adminApi } from '../engine/admin-api.js';
import { chat } from '../engine/chat.js';
import { loadEnv } from '../engine/env.js';
import { loadProject } from '../engine/project.js';
import type { Ctx } from './context.js';

/**
 * `murmur eval golden.json` — the retrieval check: ask a
 * set of real visitor questions of the deployed assistant and score each.
 *
 *   [
 *     { "question": "What's your phone number?", "source": "/contact", "contains": ["9876 5432"] },
 *     { "question": "Do you service Lilydale?", "source": "/areas" },
 *     { "question": "Can you fix my car?", "refuse": true }
 *   ]
 *
 * A question passes when retrieval found the expected page (`source`, a URL
 * substring), the reply mentions every `contains`, and — for `refuse` — the
 * reply says it is not sure instead of answering. Exit code 1 below
 * `--min` (default 0.8).
 */

type Golden = { question: string; source?: string; contains?: string[]; refuse?: boolean };
type Scored = Golden & { pass: boolean; reply: string; sources: string[]; reasons: string[] };

const REFUSAL = /\b(not sure|don't know|do not know|couldn't find|could not find|can't find|cannot find|no information|not (?:something|able to)|unable to|don't have|do not have|reach (?:out|us)|get in touch|contact (?:us|the team))\b/i;

export function score(golden: Golden, reply: string, sources: string[]): Scored {
  const reasons: string[] = [];
  if (golden.source && !sources.some((url) => url.includes(golden.source!))) reasons.push(`expected a source containing "${golden.source}"`);
  for (const term of golden.contains ?? []) if (!reply.toLowerCase().includes(term.toLowerCase())) reasons.push(`reply does not mention "${term}"`);
  if (golden.refuse && !REFUSAL.test(reply)) reasons.push('should have said it is not sure');
  return { ...golden, pass: reasons.length === 0, reply, sources, reasons };
}

function readGolden(path: string): Golden[] {
  if (!existsSync(path)) throw new CliError('usage', `No such file: ${path}`, { exitCode: EXIT.usage });
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (thrown) {
    throw new CliError('usage', `${path} is not valid JSON: ${(thrown as Error).message}`, { exitCode: EXIT.usage });
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { questions?: unknown })?.questions;
  if (!Array.isArray(list) || !list.every((q) => q && typeof (q as Golden).question === 'string')) {
    throw new CliError('usage', 'The file must be a JSON array of { "question", "source"?, "contains"?, "refuse"? }.', { exitCode: EXIT.usage });
  }
  return list as Golden[];
}

export async function evalCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['min', 'url'], 'eval');
  const file = ctx.positionals[0];
  if (!file) throw new CliError('usage', 'Usage: murmur eval <golden.json> [--min 0.8]', { exitCode: EXIT.usage });
  const loaded = loadProject(ctx.cwd);
  const golden = readGolden(resolve(ctx.cwd, file));
  const url = str(ctx.flags, 'url') ?? loaded.project.cloudflare.url;
  if (!url) throw new CliError('not_deployed', 'Deploy first.', { hint: 'murmur deploy' });
  const min = Number(str(ctx.flags, 'min') ?? 0.8);
  const api = loaded.project.backend.type === 'workers-ai' ? adminApi(loaded, { url }) : null;
  const secret = loadEnv(loaded.dir)['MURMUR_SECRET'];

  const results: Scored[] = [];
  for (const [i, q] of golden.entries()) {
    ctx.out.progress(`${i + 1}/${golden.length} ${q.question}`);
    // Each question in a fresh conversation, as a new visitor would ask it.
    const [turn, search] = await Promise.all([
      chat({ url, site: loaded.project.site, origin: new URL(url).origin, message: q.question, secret }),
      api ? api.send<{ chunks: { url: string }[] }>('POST', '/admin/api/knowledge/search', { query: q.question }).catch(() => null) : Promise.resolve(null),
    ]);
    const linked = turn.messages.flatMap((m) => (m.type === 'links' ? m.links.map((l) => l.url) : []));
    results.push(score(q, turn.reply, [...new Set([...(search?.chunks.map((ch) => ch.url) ?? []), ...linked])]));
  }

  const passed = results.filter((r) => r.pass).length;
  const accuracy = results.length ? passed / results.length : 0;
  const ok = accuracy >= min;
  ctx.out.result({ accuracy, passed, total: results.length, min, ok, results }, () => {
    for (const r of results) {
      process.stdout.write(`${r.pass ? c.green('✔') : c.red('✖')} ${r.question}\n`);
      for (const reason of r.reasons) process.stdout.write(c.dim(`    ${reason}\n`));
    }
    process.stdout.write(`\n${ok ? c.green('Pass') : c.red('Below target')}: ${passed}/${results.length} (${Math.round(accuracy * 100)}%, target ${Math.round(min * 100)}%)\n`);
  });
  return ok ? 0 : 1;
}

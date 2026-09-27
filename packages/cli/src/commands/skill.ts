import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertKnown } from '../args.js';
import { CliError } from '../errors.js';
import { AGENTS_MARKER, AGENTS_SECTION, SKILL_MD, SKILL_NAME } from '../skill.js';
import type { Ctx } from './context.js';

/**
 * `murmur skill install` — teach this machine's coding agents about murmur
 * before any project exists, so "add a chatbot to my website" works in a
 * fresh session.
 *
 *   (default)   ~/.claude/skills/website-chatbot/SKILL.md   every Claude Code session
 *   --project   ./.claude/skills/website-chatbot/SKILL.md   this repository only
 *   --codex     also appends a section to ~/.codex/AGENTS.md
 *
 * `murmur skill print` writes the skill to stdout.
 */
export async function skillCommand(ctx: Ctx): Promise<number> {
  assertKnown(ctx.flags, ['project', 'codex'], 'skill');
  const sub = ctx.positionals[0];
  if (sub === 'print') {
    process.stdout.write(SKILL_MD);
    return 0;
  }
  if (sub !== 'install') {
    throw new CliError('usage', 'Usage: murmur skill install [--project] [--codex] | murmur skill print', { exitCode: 2 });
  }

  const written: string[] = [];
  const base = ctx.flags['project'] ? ctx.cwd : homedir();
  const skillPath = join(base, '.claude', 'skills', SKILL_NAME, 'SKILL.md');
  mkdirSync(dirname(skillPath), { recursive: true });
  writeFileSync(skillPath, SKILL_MD);
  written.push(skillPath);

  if (ctx.flags['codex']) {
    const agents = join(homedir(), '.codex', 'AGENTS.md');
    mkdirSync(dirname(agents), { recursive: true });
    const existing = existsSync(agents) ? readFileSync(agents, 'utf8') : '';
    if (!existing.includes(AGENTS_MARKER)) {
      appendFileSync(agents, `${existing && !existing.endsWith('\n') ? '\n' : ''}${existing ? '\n' : ''}${AGENTS_SECTION}`);
      written.push(agents);
    }
  }

  ctx.out.result({ installed: written, skill: SKILL_NAME }, () => {
    for (const path of written) ctx.out.success(`Installed ${path}`);
    ctx.out.info('Now ask your agent: "add an AI chat assistant to my website".');
  });
  return 0;
}

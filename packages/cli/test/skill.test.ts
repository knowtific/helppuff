import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKILL_MD, SKILL_NAME } from '../src/skill.js';

const repo = join(__dirname, '..', '..', '..');

describe('the agent skill', () => {
  it('is the same text in the Claude Code plugin — run `pnpm sync:plugin` after editing skill.ts', () => {
    expect(readFileSync(join(repo, 'plugin', 'skills', SKILL_NAME, 'SKILL.md'), 'utf8')).toBe(SKILL_MD);
  });

  it('has the frontmatter Claude Code needs, and a description that says when to use it', () => {
    const front = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---/.exec(SKILL_MD);
    expect(front?.[1]).toBe(SKILL_NAME);
    expect(front?.[2]).toMatch(/chatbot/);
    expect(front?.[2]).toMatch(/website/);
  });

  it('only tells agents to run commands the CLI has', async () => {
    const { COMMAND_HELP } = await import('../src/help.js');
    const used = [...SKILL_MD.matchAll(/@knowtific\/murmur (\w+)/g)].map((m) => m[1]!);
    for (const command of new Set(used)) expect(Object.keys(COMMAND_HELP), command).toContain(command);
  });
});

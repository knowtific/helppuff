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
    const used = [...SKILL_MD.matchAll(/@knowtific\/helppuff (\w+)/g)].map((m) => m[1]!);
    for (const command of new Set(used)) expect(Object.keys(COMMAND_HELP), command).toContain(command);
  });
});

describe('the package AGENTS.md', () => {
  it('is the generated agent guide — run `pnpm sync:plugin` after editing help.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { agentsGuide } = await import('../src/help.js');
    expect(readFileSync(join(__dirname, '..', 'AGENTS.md'), 'utf8')).toBe(agentsGuide());
  });

  it('keeps the wiki\'s generated pages current — run `pnpm sync:plugin` after editing help.ts or a schema', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { cliReferencePage } = await import('../src/help.js');
    const { configReferencePage } = await import('../src/engine/reference.js');
    const wiki = join(__dirname, '..', '..', '..', 'wiki');
    expect(readFileSync(join(wiki, 'CLI-Reference.md'), 'utf8')).toBe(cliReferencePage());
    expect(readFileSync(join(wiki, 'Configuration-Reference.md'), 'utf8')).toBe(configReferencePage());
  });

  it('documents every command and exit code', async () => {
    const { agentsGuide, COMMAND_HELP } = await import('../src/help.js');
    const guide = agentsGuide();
    for (const name of Object.keys(COMMAND_HELP)) expect(guide).toContain(`### \`helppuff ${name}\``);
    for (const code of ['`0` ok', '`2` bad usage', '`3` auth', '`4` Cloudflare quota', '`10` needs_input']) expect(guide).toContain(code);
  });
});

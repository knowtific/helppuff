import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '..', '..', '..');
const instructions = readFileSync(join(repo, 'instructions.md'), 'utf8');
const rawUrl = 'https://raw.githubusercontent.com/knowtific/helppuff/main/instructions.md';

describe('shared AI-agent instructions', () => {
  it('documents the complete safe setup path', () => {
    expect(instructions).toContain('npx -y @knowtific/helppuff init --url <website> --deploy --yes --onboarding defaults --json');
    expect(instructions).toContain('--onboarding dashboard');
    expect(instructions).toContain('Do not ask whether the user wants manual onboarding');
    expect(instructions).toContain('status: "needs_input"');
    expect(instructions).toContain('secret set CLOUDFLARE_API_TOKEN');
    // init reads the .env of the folder it runs in, so the token must be stored there.
    expect(instructions).toMatch(/cd <project folder>\nnpx -y @knowtific\/helppuff secret set CLOUDFLARE_API_TOKEN/);
    expect(instructions).toContain('knowledge status --json');
    expect(instructions).toContain('deploy.setupUrl');
    expect(instructions).toContain('upgrade --check --json');
    expect(instructions).toContain('Never ask the user to paste a token into chat.');
  });

  it('only invokes top-level commands the CLI exposes', async () => {
    const { COMMAND_HELP } = await import('../src/help.js');
    const used = [...instructions.matchAll(/@knowtific\/helppuff(?:@latest)?\s+([a-z][\w-]*)/g)].map((match) => match[1]!);
    for (const command of new Set(used)) expect(Object.keys(COMMAND_HELP), command).toContain(command);
  });

  it('is linked consistently from the public entry points', () => {
    for (const file of ['README.md', 'packages/cli/README.md', 'wiki/AI-Agents.md', 'wiki/Getting-Started.md', 'wiki/Home.md']) {
      expect(readFileSync(join(repo, file), 'utf8'), file).toContain(rawUrl);
    }
  });
});

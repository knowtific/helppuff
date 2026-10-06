import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('generated documentation', () => {
  it('keeps the wiki reference pages current — run `pnpm sync:docs` after editing help.ts or a schema', async () => {
    const { cliReferencePage } = await import('../src/help.js');
    const { configReferencePage } = await import('../src/engine/reference.js');
    const wiki = join(__dirname, '..', '..', '..', 'wiki');
    expect(readFileSync(join(wiki, 'CLI-Reference.md'), 'utf8')).toBe(cliReferencePage());
    expect(readFileSync(join(wiki, 'Configuration-Reference.md'), 'utf8')).toBe(configReferencePage());
  });

  it('documents every command and exit code', async () => {
    const { cliReferencePage, COMMAND_HELP } = await import('../src/help.js');
    const reference = cliReferencePage();
    for (const name of Object.keys(COMMAND_HELP)) expect(reference).toContain(`### \`helppuff ${name}\``);
    for (const code of ['`0` ok', '`2` bad usage', '`3` auth', '`4` Cloudflare quota', '`10` needs_input']) expect(reference).toContain(code);
  });

  it('keeps every wiki page discoverable and every internal page link valid', () => {
    const wiki = join(__dirname, '..', '..', '..', 'wiki');
    const files = readdirSync(wiki).filter((file) => file.endsWith('.md'));
    const pages = new Set(files.map((file) => file.replace(/\.md$/, '')));
    const sidebar = readFileSync(join(wiki, '_Sidebar.md'), 'utf8');

    for (const file of files) {
      const raw = readFileSync(join(wiki, file), 'utf8');
      const prose = raw.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
      for (const match of prose.matchAll(/\[\[(?:[^\]|]+\|)?([^\]#|]+)(?:#[^\]]+)?\]\]/g)) {
        expect(pages, `${file}: ${match[0]}`).toContain(match[1]!.trim());
      }
      if (!file.startsWith('_')) expect(sidebar, `${file} is missing from _Sidebar.md`).toContain(file.replace(/\.md$/, ''));
    }
  });
});

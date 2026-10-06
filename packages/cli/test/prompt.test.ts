import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, promptHash, promptOverlaps } from '@helppuff/server';
import type { CloudflareApi } from '../src/engine/cloudflare.js';
import { parseProject } from '../src/engine/project.js';
import { driftError, promptSync, pullPrompt, readLivePrompt, recordPublish, type Remote } from '../src/engine/prompt.js';
import { readState, writeState } from '../src/engine/state.js';
import { tempProject } from './helpers.js';
import { promptFor } from '../src/engine/generate.js';
import type { SiteInfo } from '../src/engine/site.js';

describe('promptSync', () => {
  const live = { version: 3, hash: 'live' };

  it('tells every case apart', () => {
    expect(promptSync('x', undefined, null)).toBe('not_deployed');
    expect(promptSync('x', undefined, { version: 0, hash: 'old' })).toBe('untracked');
    expect(promptSync('live', { version: 1, hash: 'a' }, live)).toBe('in_sync');
    // Only prompt.md changed since it was last published or pulled.
    expect(promptSync('mine', { version: 3, hash: 'live' }, live)).toBe('ahead');
    // Only the live prompt changed (the dashboard): prompt.md is untouched.
    expect(promptSync('v2', { version: 2, hash: 'v2' }, live)).toBe('behind');
    // Both changed.
    expect(promptSync('mine', { version: 2, hash: 'v2' }, live)).toBe('diverged');
    // A fresh clone that has never synced cannot know which side is newer.
    expect(promptSync('mine', undefined, live)).toBe('diverged');
  });

  it('explains a refusal in terms of the dashboard edit that caused it', () => {
    const error = driftError(
      'behind',
      { version: 4, hash: 'h', text: '', editable: true, meta: { version: 4, hash: 'h', at: Date.UTC(2026, 8, 27, 9, 30), by: 'owner@acme.com', source: 'dashboard' } },
      { version: 3, hash: 'g' },
      '/x/prompt.md',
    );
    expect(error.code).toBe('prompt_behind');
    expect(error.message).toContain('version 4 (published in the dashboard by owner@acme.com, 2026-09-27 09:30 UTC)');
    expect(error.hint).toContain('helppuff prompt pull');
  });
});

/** A deployment: KV in a map, D1 in real SQLite (D1 is SQLite), behind the Cloudflare client's shape. */
function deployment(options: { dashboard?: boolean } = {}) {
  const kv = new Map<string, string>();
  const db = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) for (const sql of migration.statements) db.exec(sql);
  const api = {
    kvGet: async (_a: string, _n: string, key: string) => kv.get(key) ?? null,
    d1Query: async (_a: string, _d: string, sql: string, params: unknown[] = []) => {
      const statement = db.prepare(sql);
      return /^\s*select/i.test(sql) ? statement.all(...(params as never[])) : (statement.run(...(params as never[])), []);
    },
  } as unknown as CloudflareApi;
  const remote: Remote = {
    cf: { api, accountId: 'acct', accountName: null, token: 't', source: 'api-token' },
    kvNamespaceId: 'kv',
    d1DatabaseId: options.dashboard === false ? null : 'd1',
  };
  const publishLive = (text: string, meta?: object) =>
    kv.set('config:acme', JSON.stringify({ connector: { type: 'cloudflare', options: { binding: 'AI_SEARCH', instructions: text } }, ...(meta ? { prompt: meta } : {}) }));
  return { kv, db, remote, publishLive };
}

function project(prompt: string) {
  const dir = tempProject({ 'prompt.md': `${prompt}\n` });
  const raw = { site: 'acme', name: 'Acme', origins: ['https://acme.com'], backend: { type: 'cloudflare' } };
  return { dir, file: join(dir, 'helppuff.json'), raw, project: parseProject(raw) };
}

describe('publishing from the CLI', () => {
  it('keeps a pre-versioning prompt as version 1 before publishing the new one', async () => {
    const d = deployment();
    d.publishLive('Old prompt.');
    const { live } = await readLivePrompt(d.remote, 'acme');
    expect(live).toMatchObject({ version: 0, text: 'Old prompt.', editable: true });

    const { meta } = await recordPublish(d.remote, 'acme', { text: 'New prompt.', hash: await promptHash('New prompt.'), live, by: 'dev@acme.com' });
    expect(meta).toMatchObject({ version: 2, source: 'cli', by: 'dev@acme.com' });
    expect(d.db.prepare('SELECT version, text FROM prompt_versions ORDER BY version').all()).toEqual([
      { version: 1, text: 'Old prompt.' },
      { version: 2, text: 'New prompt.' },
    ]);
  });

  it('rolls the version back when the config could not be published', async () => {
    const d = deployment();
    d.publishLive('Old prompt.', { version: 1, hash: await promptHash('Old prompt.'), at: 1, by: null, source: 'cli' });
    const { live } = await readLivePrompt(d.remote, 'acme');
    const { rollback } = await recordPublish(d.remote, 'acme', { text: 'New.', hash: await promptHash('New.'), live, by: null });
    await rollback();
    expect(d.db.prepare('SELECT COUNT(*) AS n FROM prompt_versions').get()).toEqual({ n: 0 });
  });

  it('refuses a version number someone else just took', async () => {
    const d = deployment();
    d.publishLive('v1', { version: 1, hash: await promptHash('v1'), at: 1, by: null, source: 'cli' });
    d.db.prepare("INSERT INTO prompt_versions VALUES ('acme', 2, 'theirs', 'h', 'dashboard', null, null, null, 1)").run();
    const live = { version: 1, hash: await promptHash('v1'), text: 'v1', meta: null, editable: true };
    await expect(recordPublish(d.remote, 'acme', { text: 'mine', hash: 'm', live, by: null })).rejects.toMatchObject({ code: 'prompt_behind' });
  });

  it('reads a deployment whose database predates versioning as untracked', async () => {
    const d = deployment();
    d.db.exec('DROP TABLE prompt_versions');
    d.publishLive('Old prompt.');
    expect((await readLivePrompt(d.remote, 'acme')).live).toMatchObject({ version: 0, text: 'Old prompt.' });
  });

  it('versions without the dashboard too, in the KV config alone', async () => {
    const d = deployment({ dashboard: false });
    d.publishLive('v4', { version: 4, hash: await promptHash('v4'), at: 1, by: null, source: 'cli' });
    const { live } = await readLivePrompt(d.remote, 'acme');
    expect(live?.version).toBe(4);
    expect((await recordPublish(d.remote, 'acme', { text: 'v5', hash: 'h5', live, by: null })).meta.version).toBe(5);
  });
});

describe('pulling', () => {
  async function editedInDashboard() {
    const d = deployment();
    const v1 = 'You help Acme customers.';
    d.db.prepare("INSERT INTO prompt_versions VALUES ('acme', 1, ?, ?, 'cli', null, null, null, 1)").run(v1, await promptHash(v1));
    d.db.prepare("INSERT INTO prompt_versions VALUES ('acme', 2, 'Dashboard edit.', ?, 'dashboard', 'owner@acme.com', null, null, 2)").run(
      await promptHash('Dashboard edit.'),
    );
    d.publishLive('Dashboard edit.', { version: 2, hash: await promptHash('Dashboard edit.'), at: 2, by: 'owner@acme.com', source: 'dashboard' });
    return { d, v1 };
  }

  it('brings a dashboard edit into an untouched prompt.md', async () => {
    const { d, v1 } = await editedInDashboard();
    const loaded = project(v1);
    writeState(loaded.dir, { prompt: { version: 1, hash: await promptHash(v1) } });

    const result = await pullPrompt(loaded, d.remote);
    expect(result).toMatchObject({ pulled: 2, live: 2, changed: true, backup: null });
    expect(readFileSync(join(loaded.dir, 'prompt.md'), 'utf8')).toBe('Dashboard edit.\n');
    expect(readState(loaded.dir).prompt?.version).toBe(2);
  });

  it('keeps unpublished local edits as prompt.mine.md instead of losing them', async () => {
    const { d, v1 } = await editedInDashboard();
    const loaded = project('My local edit.');
    writeState(loaded.dir, { prompt: { version: 1, hash: await promptHash(v1) } });

    const result = await pullPrompt(loaded, d.remote);
    expect(result.backup).toBe(join(loaded.dir, 'prompt.mine.md'));
    expect(readFileSync(result.backup!, 'utf8')).toBe('My local edit.\n');
    expect(readFileSync(join(loaded.dir, 'prompt.md'), 'utf8')).toBe('Dashboard edit.\n');
  });

  it('restores an old version by making the next deploy publish it', async () => {
    const { d, v1 } = await editedInDashboard();
    const loaded = project('Dashboard edit.');
    const result = await pullPrompt(loaded, d.remote, { version: 1 });
    expect(result).toMatchObject({ pulled: 1, live: 2, backup: null });
    expect(existsSync(join(loaded.dir, 'prompt.mine.md'))).toBe(false);

    // Based on live version 2 with version 1's text: exactly "ahead".
    const state = readState(loaded.dir).prompt!;
    const { live } = await readLivePrompt(d.remote, 'acme');
    expect(promptSync(await promptHash(v1), state, live)).toBe('ahead');
  });

  it('treats a change of line endings as no change', async () => {
    const { d } = await editedInDashboard();
    const loaded = project('x');
    writeFileSync(join(loaded.dir, 'prompt.md'), 'Dashboard edit.\r\n');
    const result = await pullPrompt(loaded, d.remote);
    expect(result).toMatchObject({ changed: false, backup: null });
  });
});

describe('the starting prompt', () => {
  const site = { phone: '03 9876 5432', email: 'hello@acme.test', description: 'Plumbing in Melbourne.', pages: {} } as unknown as SiteInfo;

  it('holds only what is specific to the business: no identity, tone, rules or form fields to repeat a setting', () => {
    const text = promptFor('Acme', site, 'workers-ai', 'Quotes are free.');
    expect(text).toBe('About Acme: Plumbing in Melbourne.\n\nQuotes are free.\n');
    expect(promptOverlaps(text, 'workers-ai')).toEqual([]);
  });

  it('keeps contact details for backends that are not given the business details', () => {
    const text = promptFor('Acme', site, 'openai');
    expect(text).toContain('Contact: phone 03 9876 5432, email hello@acme.test.');
    expect(promptOverlaps(text, 'openai')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { confirmDelete } from '../src/commands/confirm.js';
import type { Ctx } from '../src/commands/context.js';

const ctx = (flags: Ctx['flags']): Ctx => ({ cwd: '.', positionals: [], flags, interactive: false, out: { info: () => {} } as unknown as Ctx['out'] });

describe('confirmDelete', () => {
  it('stops a run nobody can answer, saying it cannot be undone', async () => {
    await expect(confirmDelete(ctx({}), 'Remove the tool order_status?')).rejects.toMatchObject({
      code: 'needs_confirmation',
      message: 'Remove the tool order_status? This cannot be undone.',
      hint: 'Re-run with --yes to confirm.',
    });
  });

  it('goes ahead with --yes', async () => {
    expect(await confirmDelete(ctx({ yes: true }), 'Remove it?')).toBe(true);
    expect(await confirmDelete(ctx({ y: true }), 'Remove it?')).toBe(true);
  });
});

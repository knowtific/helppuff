import * as p from '@clack/prompts';
import { CliError, EXIT } from '../errors.js';
import type { Ctx } from './context.js';

/**
 * Every delete asks first and says it cannot be undone. `--yes` answers for
 * scripts and agents; without it, a run nobody can answer (--json, a pipe,
 * CI) stops with `needs_confirmation` and deletes nothing.
 *
 * `question` is the whole question ("Delete the tool order_status?"),
 * `consequence` what else happens. False when the person says no.
 */
export async function confirmDelete(ctx: Ctx, question: string, consequence?: string): Promise<boolean> {
  if (ctx.flags['yes'] || ctx.flags['y']) return true;
  const said = [question, consequence, 'This cannot be undone.'].filter(Boolean).join(' ');
  if (!ctx.interactive) {
    throw new CliError('needs_confirmation', said, { hint: 'Re-run with --yes to confirm.', exitCode: EXIT.usage });
  }
  const answer = await p.confirm({ message: said, initialValue: false });
  if (p.isCancel(answer) || !answer) {
    ctx.out.info('Nothing was deleted.');
    return false;
  }
  return true;
}

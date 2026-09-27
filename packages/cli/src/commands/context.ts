import type { Flags } from '../args.js';
import type { Output } from '../output.js';

export type Ctx = {
  cwd: string;
  positionals: string[];
  flags: Flags;
  out: Output;
  /** A person at a terminal: prompts allowed. False for --json, pipes and CI. */
  interactive: boolean;
};

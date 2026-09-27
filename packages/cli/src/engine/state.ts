import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED_DIR } from './project.js';

/**
 * What this folder last did to the deployment, in `.murmur/state.json`
 * (gitignored): enough to skip work that is already done, and to tell a
 * change made here from one made elsewhere.
 */
export type State = {
  workerHash?: string;
  secrets?: Record<string, string>;
  /** The live prompt version prompt.md was last published as, or pulled from. */
  prompt?: { version: number; hash: string };
};

export function stateFile(dir: string): string {
  return join(dir, GENERATED_DIR, 'state.json');
}

export function readState(dir: string): State {
  try {
    return JSON.parse(readFileSync(stateFile(dir), 'utf8')) as State;
  } catch {
    return {};
  }
}

export function writeState(dir: string, state: State): void {
  mkdirSync(join(dir, GENERATED_DIR), { recursive: true });
  writeFileSync(stateFile(dir), `${JSON.stringify(state, null, 2)}\n`);
}

/** Whether `.murmur/` exists from an earlier deploy — for status output. */
export function hasDeployed(dir: string): boolean {
  return existsSync(stateFile(dir));
}

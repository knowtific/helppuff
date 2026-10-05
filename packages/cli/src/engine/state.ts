import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  /** The live settings (see `/admin/api/settings`) murmur.json was last deployed as, or pulled from. */
  settings?: { hash: string };
  /** The embedding model the knowledge base was last learned with; a change means re-learning. */
  embeddingModel?: string;
  /** workers-ai: each `knowledge.files` file as last sent — its hash, and the id it lives under on the Worker. */
  files?: Record<string, { hash: string; id: string; kind: 'file' | 'manual' }>;
  /** `murmur upgrade` runs, newest last: what it went from and to, and the D1 restore point taken just before. */
  upgrades?: { from: string | null; to: string; at: string; restoreTimestamp: number | null }[];
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

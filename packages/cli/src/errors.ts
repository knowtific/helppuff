/**
 * Every failure the CLI reports on purpose. `code` is stable and meant to be
 * branched on by scripts and agents; `hint` says what to do next, in one
 * line, as a command where there is one.
 */
export class CliError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  readonly exitCode: number;

  constructor(
    code: string,
    message: string,
    options: { hint?: string; details?: Record<string, unknown>; exitCode?: number } = {},
  ) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.hint = options.hint;
    this.details = options.details;
    this.exitCode = options.exitCode ?? 1;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/** Exit codes, documented in `murmur --help`. */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  /** Cloudflare (or the admin API) refused the credentials or a permission. */
  auth: 3,
  /** A Cloudflare quota or plan limit was hit. */
  quota: 4,
  /** Setup needs answers the CLI was not given and could not ask for. */
  needsInput: 10,
} as const;

export function isCliError(value: unknown): value is CliError {
  return value instanceof CliError;
}

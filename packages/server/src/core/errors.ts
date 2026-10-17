import { HTTP_STATUS_FOR_ERROR, type ErrorCode, type ErrorEnvelope } from '@helppuff/protocol';
import { explainDetail } from './explain.js';

/** Default visitor-facing copy. Never leaks a backend's own error text. */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  bad_request: 'Something in that request was not quite right.',
  unauthorized: 'This conversation is no longer available.',
  forbidden_origin: 'This chat is not available on this site.',
  forbidden: 'This key is not allowed to do that.',
  conflict: 'That already exists.',
  not_found: 'This chat is not available.',
  rate_limited: 'Too many messages. Try again shortly.',
  quota_exceeded: 'Chat is unavailable right now.',
  captcha_failed: 'We could not verify that you are human. Please try again.',
  connector_error: 'The assistant is unavailable right now.',
  session_expired: 'This conversation has expired.',
  internal: 'Something went wrong on our end.',
};

export class HelpPuffError extends Error {
  readonly code: ErrorCode;
  readonly retryAfter?: number;
  /** Structured log detail — never sent to the visitor. */
  readonly detail?: string;

  constructor(code: ErrorCode, options: { message?: string; retryAfter?: number; detail?: string } = {}) {
    super(options.message ?? DEFAULT_MESSAGES[code]);
    this.name = 'HelpPuffError';
    this.code = code;
    if (options.retryAfter !== undefined) this.retryAfter = options.retryAfter;
    if (options.detail !== undefined) this.detail = options.detail;
  }

  get status(): number {
    return HTTP_STATUS_FOR_ERROR[this.code];
  }

  /**
   * The JSON body. `forOwner` adds what went wrong and what to do (`reason`,
   * `hint`): only for the people who can fix it, never for a visitor.
   */
  toEnvelope(forOwner = false): ErrorEnvelope {
    const explained = forOwner ? this.explanation() : null;
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
        ...(explained ? { reason: explained.reason.slice(0, 500), ...(explained.hint ? { hint: explained.hint.slice(0, 300) } : {}) } : {}),
      },
    };
  }

  /** The detail said plainly; for an opaque failure (`internal`, `connector_error`) at least the detail itself. */
  explanation(): { reason: string; hint?: string } | null {
    const known = explainDetail(this.detail);
    if (known) return known;
    if (this.detail && (this.code === 'internal' || this.code === 'connector_error')) return { reason: this.detail.slice(0, 500) };
    return null;
  }
}

export function isHelpPuffError(value: unknown): value is HelpPuffError {
  return value instanceof HelpPuffError;
}

/**
 * Turn anything thrown into a HelpPuffError. An unexpected throw becomes a
 * generic `internal` — the original text never reaches the visitor.
 */
export function toHelpPuffError(thrown: unknown): HelpPuffError {
  if (isHelpPuffError(thrown)) return thrown;
  const detail = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : 'unknown_throw';
  return new HelpPuffError('internal', { detail });
}

import type { ErrorCode } from '@murmur/protocol';

/**
 * The only error a connector should throw. `message` is shown to the visitor,
 * so it must never contain a backend's raw error text.
 */
export class ConnectorError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfter?: number;
  /** Not sent to the visitor — for the server's structured log only. */
  readonly detail?: string;

  constructor(
    message: string,
    options: { code?: ErrorCode; retryable?: boolean; retryAfter?: number; detail?: string } = {},
  ) {
    super(message);
    this.name = 'ConnectorError';
    this.code = options.code ?? 'connector_error';
    this.retryable = options.retryable ?? true;
    if (options.retryAfter !== undefined) this.retryAfter = options.retryAfter;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

export function isConnectorError(value: unknown): value is ConnectorError {
  return value instanceof ConnectorError;
}

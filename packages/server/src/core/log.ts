import { HTTP_STATUS_FOR_ERROR, type ErrorCode } from '@helppuff/protocol';

/**
 * The server's one logger, and the only place it writes to the console.
 *
 * Failures are always logged, on every deployment: an event whose name says
 * something went wrong (`request.error`, `*_failed`, `*.threw`, …) goes out
 * as a JSON line at `error` (or `warn`, for a refused request), so Workers
 * Observability and `helppuff logs` show what failed and why. Everything
 * else (timings, a chat starting) only with `HELPPUFF_LOG=1`.
 *
 * Structured and PII-free: callers pass ids, codes and error details, never
 * message text, contact details or IP addresses.
 */

export type Log = (event: string, data?: object) => void;

const PROBLEM = /error|fail|threw|missing|unparsable|unreadable|rejected|exhausted|leak|dropped|bad_options|not_started|unavailable/;

export const isProblem = (event: string) => PROBLEM.test(event);

function level(event: string, data: Record<string, unknown> | undefined): 'error' | 'warn' {
  if (event !== 'request.error') return 'error';
  const status = HTTP_STATUS_FOR_ERROR[data?.['code'] as ErrorCode] ?? 500;
  return status >= 500 ? 'error' : 'warn';
}

export function createLog(debug: boolean): Log {
  return (event, data) => {
    if (isProblem(event)) {
      const fields = data as Record<string, unknown> | undefined;
      const at = level(event, fields);
      const line = JSON.stringify({ level: at, event, ...fields });
      if (at === 'error') console.error(line);
      else console.warn(line);
      return;
    }
    if (debug) console.log(JSON.stringify({ event, ...data }));
  };
}

/** A logger for work outside a request (cron, the live hub's alarms), from the Worker's env. */
export const envLog = (env: Record<string, unknown>): Log => createLog(env['HELPPUFF_LOG'] === '1');

/** A thrown value as a short, loggable reason: its name and message, cut. Never pass one that may hold visitor text. */
export function reasonOf(thrown: unknown): string {
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`.slice(0, 300);
  return String(thrown).slice(0, 300);
}

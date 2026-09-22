import { log } from './env.js';

/**
 * Nothing the widget exposes to a host page may ever throw into it (§8.3).
 * These wrappers are the boundary: every public method, every listener and
 * every timer callback goes through one of them.
 */

export function safe<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => R,
  onError?: (error: unknown) => void,
): (...args: A) => R | undefined {
  return (...args: A) => {
    try {
      return fn(...args);
    } catch (error) {
      log(`caught:${name}`, error);
      try {
        onError?.(error);
      } catch {
        // An error handler that itself throws must not escape either.
      }
      return undefined;
    }
  };
}

export async function safeAsync<T>(
  name: string,
  fn: () => Promise<T>,
  onError?: (error: unknown) => void,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    log(`caught:${name}`, error);
    try {
      onError?.(error);
    } catch {
      // As above.
    }
    return undefined;
  }
}

/**
 * Timers, listeners and observers registered here are all removed by one
 * `dispose()` — the same path `Murmur.destroy()` and a fatal `hide()` take.
 */
export class Disposer {
  private tasks: Array<() => void> = [];
  private disposed = false;

  add(task: () => void): void {
    if (this.disposed) {
      task();
      return;
    }
    this.tasks.push(task);
  }

  listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
    const wrapped: EventListener = (event) => {
      try {
        handler(event);
      } catch (error) {
        // A listener must never surface an exception to the host page.
        log('caught:listener', error);
      }
    };
    target.addEventListener(type, wrapped);
    this.add(() => target.removeEventListener(type, wrapped));
  }

  timeout(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      try {
        fn();
      } catch (error) {
        log('caught:timeout', error);
      }
    }, ms);
    this.add(() => clearTimeout(id));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Run in reverse so teardown mirrors setup.
    for (const task of this.tasks.reverse()) {
      try {
        task();
      } catch {
        // Every remaining task still gets its turn.
      }
    }
    this.tasks = [];
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * Every fetch is bounded (§8.3): 6s for config, 30s for a message. No
 * unbounded retry and no backoff loop that outlives the page view.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

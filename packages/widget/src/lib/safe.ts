import { log } from './env.js';

/**
 * Timers, listeners and observers registered here are all removed by one
 * `dispose()` — the same path `HelpPuff.destroy()` and a fatal `hide()` take.
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
 * Every fetch is bounded: 6s for config, 30s for a message. No
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

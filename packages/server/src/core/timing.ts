/**
 * Where a request's time goes, stage by stage: sent as a `Server-Timing`
 * header on JSON responses (visible in the browser's network panel) and as
 * an SSE comment before `done` on streamed ones (clients skip comments).
 * Never carries message text or visitor data — only stage names and
 * milliseconds.
 *
 * Inside Workers the clock advances on I/O, not CPU, which is exactly what
 * these stages are: KV, D1, Vectorize and Workers AI round trips.
 */
export class Timing {
  private readonly start = Date.now();
  readonly entries: { name: string; ms: number }[] = [];

  add(name: string, ms: number): void {
    if (this.entries.length < 64) this.entries.push({ name: name.replace(/[^\w.-]/g, '_').slice(0, 40), ms: Math.max(0, Math.round(ms)) });
  }

  async span<T>(name: string, work: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await work();
    } finally {
      this.add(name, Date.now() - started);
    }
  }

  /** `stage;dur=12, other;dur=340, total;dur=400` */
  header(): string {
    return [...this.entries, { name: 'total', ms: Date.now() - this.start }].map((e) => `${e.name};dur=${e.ms}`).join(', ');
  }

  summary(): Record<string, number> {
    return Object.fromEntries([...this.entries.map((e) => [e.name, e.ms] as const), ['total', Date.now() - this.start] as const]);
  }
}

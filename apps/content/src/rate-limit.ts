/**
 * FR-34: requests per subdomain per second on the content domain. A fixed one-second
 * window per subdomain, kept in memory (one content-server instance; Cloudflare adds
 * coarse limiting at the edge in production).
 */
export class SubdomainRateLimiter {
  private windows = new Map<string, { second: number; count: number }>();
  private lastSweep = 0;

  constructor(private now: () => number = Date.now) {}

  /** Returns true if the request is allowed. */
  allow(subdomain: string, limitPerSecond: number): boolean {
    const t = this.now();
    const second = Math.floor(t / 1000);
    if (t - this.lastSweep > 10_000) this.sweep(second);
    const w = this.windows.get(subdomain);
    if (!w || w.second !== second) {
      this.windows.set(subdomain, { second, count: 1 });
      return true;
    }
    w.count++;
    return w.count <= limitPerSecond;
  }

  private sweep(second: number) {
    this.lastSweep = this.now();
    for (const [k, w] of this.windows) if (w.second < second) this.windows.delete(k);
  }
}

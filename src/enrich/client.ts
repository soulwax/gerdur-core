import delay from 'delay';
import {getJson, HttpStatusError} from '../lib/http';

/**
 * Small polite JSON client for the third-party enrichment services (MusicBrainz,
 * Cover Art Archive). Each service gets its own instance so it can enforce its
 * own minimum request interval and identify itself with a `User-Agent`.
 *
 * - serialises requests and spaces them by `minIntervalMs` (MusicBrainz asks for
 *   ≤ 1 req/s per IP)
 * - retries `503` (their "server busy") and `429` with exponential backoff
 * - returns `null` on `404` rather than throwing (no data for that id)
 */
export class PoliteJsonClient {
  userAgent: string;
  minIntervalMs: number;

  private queue: Promise<unknown> = Promise.resolve();
  private lastAt = 0;

  constructor(opts: {userAgent: string; minIntervalMs?: number}) {
    this.userAgent = opts.userAgent;
    this.minIntervalMs = opts.minIntervalMs ?? 1100;
  }

  /** GET `url` as JSON. Resolves `null` on 404. */
  get<T>(url: string, {retries = 3}: {retries?: number} = {}): Promise<T | null> {
    const run = this.queue.then(() => this.fetch<T>(url, retries));
    // keep the chain alive even if this call rejects
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async fetch<T>(url: string, retries: number): Promise<T | null> {
    const wait = this.minIntervalMs - (Date.now() - this.lastAt);
    if (wait > 0) await delay(wait);

    for (let attempt = 0; ; attempt++) {
      try {
        const data = await getJson<T>(url, {headers: {'User-Agent': this.userAgent, Accept: 'application/json'}});
        this.lastAt = Date.now();
        return data;
      } catch (err) {
        this.lastAt = Date.now();
        const status = err instanceof HttpStatusError ? err.statusCode : 0;
        if (status === 404) {
          return null;
        }
        if ((status === 503 || status === 429 || status >= 500) && attempt < retries) {
          await delay(Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 400);
          continue;
        }
        throw err;
      }
    }
  }
}

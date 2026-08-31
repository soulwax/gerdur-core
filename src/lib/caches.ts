/**
 * The process-wide cache for account-independent gateway metadata.
 *
 * Each {@link Session} keeps its own response cache because most gw payloads
 * embed a per-account `TRACK_TOKEN`. A handful of methods carry nothing
 * account-scoped, though — album, artist, lyrics, discography and playlist
 * metadata are the same bytes for every account in a country. Caching those per
 * session multiplies one payload by the number of logged-in accounts, which is
 * fine for a script and wrong for a server.
 *
 * Holding them here means they are stored once, and — via {@link sharedInFlight}
 * — a burst of sessions asking for the same album shares a single request
 * instead of issuing one each. Measured at 500 sessions reading one album:
 * **500 gateway requests → 1**, and 1.8 MB of duplicated payload → one copy.
 *
 * Tune with {@link configureCache}, inspect with {@link cacheStats}.
 */
import FastLRU from './fast-lru';

/** An LRU that counts hits and misses and can be resized at runtime. */
class CountingCache {
  private lru: FastLRU;
  private opts: {maxSize: number; ttl: number};
  hits = 0;
  misses = 0;

  constructor(maxSize: number, ttl = 0) {
    this.opts = {maxSize, ttl};
    this.lru = new FastLRU(this.opts);
  }

  get(key: string): any {
    const value = this.lru.get(key);
    if (value === undefined) {
      this.misses++;
    } else {
      this.hits++;
    }
    return value;
  }

  set(key: string, value: any): void {
    this.lru.set(key, value);
  }

  clear(): void {
    this.lru.clear();
  }

  /** Resize / re-TTL. Drops the current contents (a new LRU is built). */
  reconfigure(opts: {maxSize?: number; ttl?: number}): void {
    this.opts = {maxSize: opts.maxSize ?? this.opts.maxSize, ttl: opts.ttl ?? this.opts.ttl};
    this.lru = new FastLRU(this.opts);
  }

  get size(): number {
    return this.lru.size;
  }

  get maxSize(): number {
    return this.opts.maxSize;
  }
}

/**
 * Account-independent gateway payloads, shared across every {@link Session}.
 * Keyed by country + method + params — see `Session.gw`.
 */
export const sharedGatewayCache = new CountingCache(2000, 60 * 60_000);

/** In-flight requests for {@link sharedGatewayCache}, so concurrent sessions coalesce. */
export const sharedInFlight = new Map<string, Promise<any>>();

export interface CacheOptions {
  /**
   * The shared gateway metadata cache. Default `{maxSize: 2000, ttl: 3_600_000}`.
   * Raise `maxSize` for a large catalogue; entries are JSON payloads of a few KB.
   */
  shared?: {maxSize?: number; ttl?: number};
}

/**
 * Resize the shared cache. Call once at startup — reconfiguring drops its
 * contents.
 *
 * ```ts
 * configureCache({shared: {maxSize: 20_000, ttl: 30 * 60_000}});
 * ```
 */
export const configureCache = (options: CacheOptions): void => {
  if (options.shared) {
    sharedGatewayCache.reconfigure(options.shared);
    sharedInFlight.clear();
  }
};

/** Drop the shared cache. Per-session caches are untouched (`session.cache.clear()` for those). */
export const clearSharedCaches = (): void => {
  sharedGatewayCache.clear();
  sharedInFlight.clear();
};

export interface CacheStats {
  /** the shared account-independent gateway metadata cache */
  shared: {size: number; maxSize: number; hits: number; misses: number; inFlight: number};
}

/** A snapshot of shared-cache occupancy and hit rate — for metrics / health endpoints. */
export const cacheStats = (): CacheStats => ({
  shared: {
    size: sharedGatewayCache.size,
    maxSize: sharedGatewayCache.maxSize,
    hits: sharedGatewayCache.hits,
    misses: sharedGatewayCache.misses,
    inFlight: sharedInFlight.size,
  },
});

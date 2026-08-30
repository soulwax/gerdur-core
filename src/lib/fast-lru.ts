/**
 * LRU + TTL cache.
 *
 * A `Map` keeps insertion order = recency: `get` re-inserts to bump an entry to
 * the tail; a full `set` evicts the head (least-recently-used). All operations
 * are O(1). Expired entries are dropped lazily on `get` and opportunistically on
 * a full `set`.
 *
 * @param options.maxSize max entries (default `Infinity`)
 * @param options.ttl     ms before an entry expires (default `0` = never)
 */
interface Entry {
  value: unknown;
  expire: number; // 0 = never
}

class FastLRU {
  private readonly max: number;
  private readonly ttl: number;
  private readonly map = new Map<string, Entry>();

  constructor({maxSize = Infinity, ttl = 0}: {maxSize?: number; ttl?: number} = {}) {
    this.max = maxSize;
    this.ttl = ttl;
  }

  get(key: string): any {
    const e = this.map.get(key);
    if (e === undefined) return undefined;
    if (e.expire !== 0 && e.expire < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // bump to most-recently-used
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  peek(key: string): any {
    return this.map.get(key)?.value;
  }

  set(key: string, value: any, ttl: number = this.ttl): void {
    this.map.delete(key);
    if (this.map.size >= this.max) {
      // drop expired first, then the LRU head if still over
      if (this.ttl > 0) {
        const now = Date.now();
        for (const [k, e] of this.map) {
          if (e.expire !== 0 && e.expire < now) this.map.delete(k);
        }
      }
      while (this.map.size >= this.max) {
        const oldest = this.map.keys().next().value;
        if (oldest === undefined) break;
        this.map.delete(oldest);
      }
    }
    this.map.set(key, {value, expire: ttl > 0 ? Date.now() + ttl : 0});
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  has(key: string): boolean {
    const e = this.map.get(key);
    return e !== undefined && (e.expire === 0 || e.expire >= Date.now());
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  *values(): IterableIterator<unknown> {
    for (const e of this.map.values()) yield e.value;
  }

  *entries(): IterableIterator<[string, unknown]> {
    for (const [k, e] of this.map) yield [k, e.value];
  }

  forEach(cb: (value: unknown, key: string) => void): void {
    for (const [k, e] of this.map) cb(e.value, k);
  }

  get size(): number {
    return this.map.size;
  }
}

export default FastLRU;

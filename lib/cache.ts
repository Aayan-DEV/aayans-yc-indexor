/** Tiny LRU cache with expiry (LRU = least recently used entries are dropped first). Repeat searches return instantly. */
export class LruCache<T> {
  private map = new Map<string, { value: T; expires: number }>();

  constructor(private max = 200, private ttlMs = 10 * 60 * 1000) {}

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T) {
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

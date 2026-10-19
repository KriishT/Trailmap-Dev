/**
 * A small in-memory sliding-window limiter. It protects the public share route and key-based
 * endpoints from simple abuse. State is per server instance, so on a multi-instance deployment
 * the effective limit is the limit times the number of instances; put a shared limiter in front
 * (an edge or gateway rule) if you need a hard global limit.
 */
export interface RateLimiter {
  /** Returns true when the call is allowed, false when `key` has used up its budget. */
  take(key: string, now?: number): boolean;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      // Keep the map from growing without bound.
      if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return true;
    },
  };
}

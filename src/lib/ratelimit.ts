// Tiny in-memory fixed-window rate limiter. Adequate for a single-replica
// deployment (the StatefulSet runs one pod); revisit if we scale horizontally
// (would move to Redis/libSQL). Not a security boundary on its own — just
// abuse dampening on expensive/sensitive endpoints.

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

/** Returns true if the action is allowed, false if the limit is exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}

/** Stable client key: prefer the authed user, else the forwarded client IP. */
export function clientKey(request: Request, userId: string | null, clientAddress?: string): string {
  if (userId) return `u:${userId}`;
  const xff = request.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() || clientAddress || "unknown";
  return `ip:${ip}`;
}

// Opportunistic cleanup so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, w] of buckets) if (now >= w.resetAt) buckets.delete(k);
}, 60_000).unref?.();

// In-memory per-IP rate limiter for /api/checkout. Cheap, single-region,
// no external dependency. v1 trade-off: Vercel hobby is a single instance
// in a single region, so an in-memory limiter is effective. When we move
// to multi-region or pro tier, swap this for Upstash Ratelimit or Vercel
// Edge KV. (Fix from /review on 2026-05-18 — without this, anyone with
// curl could flood the leads table and burn Stripe API quota.)
//
// Algorithm: sliding window. Each IP gets a deque of recent timestamps;
// requests are allowed if fewer than N timestamps fall within the last
// windowMs.

type Bucket = {
  timestamps: number[]; // unix ms, oldest first
};

const buckets = new Map<string, Bucket>();

// Periodic cleanup so the Map doesn't grow forever in long-lived
// processes. Runs every 5 minutes; drops buckets with no recent activity.
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const STALE_MS = 30 * 60_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - STALE_MS;
    for (const [key, bucket] of buckets) {
      const lastSeen = bucket.timestamps[bucket.timestamps.length - 1];
      if (!lastSeen || lastSeen < cutoff) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive solely for the cleanup timer.
  if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number; // unix ms when the oldest request leaves the window
};

/**
 * Check whether the given client IP is allowed to make another request.
 * @param ip Client identifier (typically `req.headers["x-forwarded-for"]` first hop)
 * @param limit Max requests allowed in the window (default 5)
 * @param windowMs Window size in ms (default 60_000 = 1 min)
 */
export function checkRateLimit(
  ip: string,
  limit = 5,
  windowMs = 60_000,
): RateLimitResult {
  ensureCleanup();
  const now = Date.now();
  const cutoff = now - windowMs;

  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(ip, bucket);
  }

  // Drop timestamps older than the window
  while (bucket.timestamps.length > 0 && bucket.timestamps[0]! < cutoff) {
    bucket.timestamps.shift();
  }

  if (bucket.timestamps.length >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: bucket.timestamps[0]! + windowMs,
    };
  }

  bucket.timestamps.push(now);
  return {
    allowed: true,
    remaining: limit - bucket.timestamps.length,
    resetAt: now + windowMs,
  };
}

/**
 * Extract the client IP from a Next.js Request. Prefers `x-forwarded-for`
 * (set by Vercel's edge proxy) and falls back to `x-real-ip`. In local
 * dev these may be absent — fall back to a literal string so all local
 * requests share one bucket (intentional; no rate limit in single-tenant
 * dev).
 */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "local-dev";
}

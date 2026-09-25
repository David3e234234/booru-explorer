const buckets = new Map();
let namespaceCounter = 0;

function pruneBuckets(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function createRateLimiter({ windowMs, max, message = 'Слишком много запросов' }) {
  // Each limiter needs its own budget: sharing a per-IP bucket across routes makes
  // the strictest limiter silently throttle every other route for the same client.
  const namespace = `rl${++namespaceCounter}:`;
  return (req, res, next) => {
    const now = Date.now();
    if (buckets.size > 5000) pruneBuckets(now);
    const key = namespace + (req.ip || req.socket?.remoteAddress || 'unknown');
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ success: false, message });
    }
    return next();
  };
}

/**
 * Best-effort in-memory rate limit per Edge isolate (not global across instances).
 * Does not replace WAF / Vercel password — document in ops runbook.
 */
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(clientKey: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(clientKey);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    buckets.set(clientKey, bucket);
  }
  bucket.count += 1;
  return bucket.count <= MAX_ATTEMPTS;
}

export function clientKeyFromRequest(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

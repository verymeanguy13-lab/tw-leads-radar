import { createHash } from "crypto";
import { db } from "./db";

// IP-based rate limit for the public, no-login /search page (2026-09-05).
// That page has no account behind it to hold accountable, and no
// rate-limiter existed anywhere in this codebase before now (flagged as
// an open gap when /search was first built) - this is the fix.
//
// Deliberately DB-backed rather than an in-memory Map: this app runs as
// Vercel serverless functions, which don't share memory across instances
// or survive cold starts, so an in-memory counter would silently under-
// count under real traffic and give a false sense of protection. Neon
// Postgres is already the single source of truth for everything else in
// this app - reusing it here avoids a new external dependency (e.g.
// Upstash Redis) for what's currently a single, low-volume endpoint. If
// /search traffic ever gets large enough that a DB round-trip per
// request becomes the bottleneck, an edge/KV-based limiter is the right
// next step - not needed yet.
//
// Fixed windows, not sliding: a request at 10:09:59 and another at
// 10:10:01 land in different buckets even though they're 2 seconds
// apart. That's a known, accepted imprecision of fixed-window limiting -
// simple, one row per (ip_hash, window) via ON CONFLICT, no separate
// cleanup-of-individual-timestamps logic. Good enough to blunt casual
// scraping; not a precise rate guarantee.
const WINDOW_MINUTES = 10;
const MAX_REQUESTS_PER_WINDOW = 30;

// Never store a raw IP - hash it (with NEXTAUTH_SECRET as a pepper, same
// secret already used to sign session tokens, so no new env var needed)
// so this table can't itself become a "why do you have my IP address on
// file" question later.
function hashIp(ip: string): string {
  const pepper = process.env.NEXTAUTH_SECRET ?? "";
  return createHash("sha256").update(`${pepper}:${ip}`).digest("hex");
}

function currentWindowStart(): Date {
  const now = new Date();
  const windowMs = WINDOW_MINUTES * 60 * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

// Records this request against the caller's IP and reports whether it's
// still within the allowed rate. Call this BEFORE doing the expensive
// work (the actual company search), not after - a blocked request should
// never reach the real query.
export async function checkSearchRateLimit(ip: string): Promise<RateLimitResult> {
  if (!ip || ip === "unknown") {
    // No IP to key on (shouldn't normally happen behind Vercel, which
    // always sets x-forwarded-for) - fail open rather than locking out
    // every visitor over a missing header. The 2-character-minimum and
    // 20-row cap on /search are still in place regardless.
    return { allowed: true };
  }

  const ipHash = hashIp(ip);
  const windowStart = currentWindowStart();
  const sql = db();

  const rows = await sql`
    INSERT INTO search_rate_limits (ip_hash, window_start, request_count)
    VALUES (${ipHash}, ${windowStart.toISOString()}, 1)
    ON CONFLICT (ip_hash, window_start) DO UPDATE
      SET request_count = search_rate_limits.request_count + 1
    RETURNING request_count
  `;
  const count = Number(rows[0]?.request_count ?? 1);

  // Opportunistic cleanup: on roughly 1 in 200 requests, delete windows
  // old enough that nothing still needs them. Avoids unbounded row
  // growth without needing a separate scheduled job for what's still a
  // low-volume table - revisit with a real cron cleanup (matching
  // .github/workflows/cleanup-unverified-signups.yml's pattern) if
  // volume grows enough that this isn't keeping up.
  if (Math.random() < 0.005) {
    await sql`DELETE FROM search_rate_limits WHERE window_start < now() - interval '1 day'`;
  }

  if (count > MAX_REQUESTS_PER_WINDOW) {
    const windowEndMs = windowStart.getTime() + WINDOW_MINUTES * 60 * 1000;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - Date.now()) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true };
}

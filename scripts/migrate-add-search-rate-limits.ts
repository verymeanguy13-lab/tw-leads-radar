import { neon } from "@neondatabase/serverless";

// One-time migration (2026-09-05): adds search_rate_limits, backing the
// IP-based rate limit on the public /search page - see db/schema.sql's
// comment on this table and lib/rate-limit.ts for the actual policy.
//
// Safe to re-run - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
// EXISTS throughout, same pattern as every other migrate-add-*.ts here.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Creating search_rate_limits if it doesn't already exist...");
  await sql`
    CREATE TABLE IF NOT EXISTS search_rate_limits (
        ip_hash TEXT NOT NULL,
        window_start TIMESTAMPTZ NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (ip_hash, window_start)
    )
  `;

  console.log("Creating idx_search_rate_limits_window_start if it doesn't already exist...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_search_rate_limits_window_start ON search_rate_limits(window_start)
  `;

  console.log("Granting app_user access...");
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON search_rate_limits TO app_user`;

  console.log("Done.");
}

main().catch((err) => {
  console.error("migrate-add-search-rate-limits.ts failed:", err);
  process.exit(1);
});

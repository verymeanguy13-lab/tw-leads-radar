import { neon } from "@neondatabase/serverless";

// One-time migration for the digest watchdog (2026-09-03). Adds
// digest_runs, a log table mirroring ingestion_runs' existing pattern —
// scripts/run-digest.ts now writes one row here every time it actually
// runs to completion (success, partial, or a caught crash), so a separate
// watchdog job (.github/workflows/digest-watchdog.yml +
// scripts/check-digest-ran.ts) can detect the one failure mode digest.yml's
// own `if: failure()` alert step can never catch: GitHub Actions silently
// not triggering the scheduled workflow at all (this happened for real,
// 2026-09-01 to 09-02, with nothing anywhere flagging it).
//
// Safe to re-run — CREATE TABLE IF NOT EXISTS / IF NOT EXISTS guards
// throughout, same idempotency style as migrate-add-daily-cadence.ts.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Creating digest_runs table if it doesn't already exist...");
  await sql`
    CREATE TABLE IF NOT EXISTS digest_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'partial', 'failed')) DEFAULT 'success',
        sent_count INTEGER DEFAULT 0,
        skipped_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        error_log TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ
    )
  `;

  console.log("Adding index on started_at...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_digest_runs_started_at ON digest_runs(started_at DESC)
  `;

  console.log("Granting app_user access (not RLS-protected — not user-owned data, same as ingestion_runs)...");
  await sql`GRANT SELECT, INSERT, UPDATE ON digest_runs TO app_user`;

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

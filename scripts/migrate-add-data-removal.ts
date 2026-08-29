import { neon } from "@neondatabase/serverless";

// One-time migration for the PDPA data-removal feature (2026-08-28).
// Safe to re-run — every statement is idempotent (IF NOT EXISTS /
// CREATE INDEX IF NOT EXISTS), matching db/schema.sql's own convention.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Adding companies.suppressed_at...");
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ`;

  console.log("Adding index on suppressed_at...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_companies_suppressed_at
    ON companies(suppressed_at) WHERE suppressed_at IS NOT NULL
  `;

  console.log("Creating data_removal_requests table...");
  await sql`
    CREATE TABLE IF NOT EXISTS data_removal_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uniform_id VARCHAR(8),
      company_name_submitted TEXT NOT NULL,
      requester_email TEXT NOT NULL,
      reason TEXT,
      status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at TIMESTAMPTZ
    )
  `;

  console.log("Adding index on data_removal_requests.status...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_data_removal_requests_status
    ON data_removal_requests(status)
  `;

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

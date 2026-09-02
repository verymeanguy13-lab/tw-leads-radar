import { neon } from "@neondatabase/serverless";

// One-time migration for daily-cadence support (2026-08-30). Safe to
// re-run — DROP CONSTRAINT IF EXISTS before recreating.
//
// Fixes a real gap: Plan C ("每日方案") has been marketed with "每日
// 電子郵件摘要" as its headline feature over Plan B since the pricing
// page was built, but the cadence CHECK constraint only ever allowed
// 'weekly' or 'monthly' — 'daily' was rejected at the database level
// even if every other layer had somehow allowed it through. See
// architecture.md's 2026-08-30 entry for the full multi-layer fix this
// is part of.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Looking up existing CHECK constraint(s) on saved_searches.cadence...");
  // Don't assume the exact auto-generated constraint name — safer to
  // look it up from Postgres's own catalog than guess, in case this
  // table's constraint was named differently than the usual
  // <table>_<column>_check convention.
  const existing = await sql`
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'saved_searches'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%cadence%'
  `;

  for (const row of existing) {
    const name = row.conname as string;
    console.log(`Dropping constraint: ${name}`);
    await sql.query(`ALTER TABLE saved_searches DROP CONSTRAINT "${name}"`);
  }

  console.log("Adding updated CHECK constraint including 'daily'...");
  await sql`
    ALTER TABLE saved_searches
    ADD CONSTRAINT saved_searches_cadence_check
    CHECK (cadence IN ('weekly', 'monthly', 'daily'))
  `;

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

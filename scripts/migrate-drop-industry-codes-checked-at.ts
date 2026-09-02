import { neon } from "@neondatabase/serverless";

// Removes companies.industry_codes_checked_at - confirmed dead schema,
// unused since Session 20b's revised design (see architecture.md's
// "Known open items" entry). Verified via a full codebase grep before
// writing this: referenced nowhere except its own CREATE TABLE
// declaration - no reads, no writes, anywhere in the application.
// Safe to re-run (IF EXISTS).
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Dropping companies.industry_codes_checked_at...");
  await sql`ALTER TABLE companies DROP COLUMN IF EXISTS industry_codes_checked_at`;
  console.log("Done.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

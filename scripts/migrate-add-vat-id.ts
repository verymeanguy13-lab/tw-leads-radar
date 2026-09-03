import { neon } from "@neondatabase/serverless";

// One-time migration (2026-09-03): adds users.vat_id for capturing a
// customer's 統一編號 (Taiwan Uniform Business Number). Deliberately
// scoped to capture-and-store only per user decision this session - see
// architecture.md's 2026-09-03 entry for why this was NOT wired into
// Paddle checkout as a business customer field (Paddle's built-in
// tax-ID handling targets EU/UK-style reverse-charge VAT, a different
// legal mechanism from Taiwan's own 統一發票 system - that distinction
// needs a real answer before building checkout logic on top of it).
//
// Safe to re-run - ADD COLUMN IF NOT EXISTS.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Adding users.vat_id if it doesn't already exist...");
  await sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS vat_id VARCHAR(8)
  `;
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

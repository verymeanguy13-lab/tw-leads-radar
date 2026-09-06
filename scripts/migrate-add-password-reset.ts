import { neon } from "@neondatabase/serverless";

// One-time migration (2026-09-06): adds users.password_reset_token_hash
// and users.password_reset_token_expires_at, for the new forgot-password
// flow (app/(marketing)/forgot-password, app/(marketing)/reset-password,
// lib/email/password-reset.ts). Flagged by the 2026-09-06 site
// completeness audit: there was previously no self-service way for a
// credentials-based user to recover a forgotten password at all.
//
// Deliberately separate from the existing verification_token_hash/
// verification_token_expires_at columns (added for email verification) -
// see db/schema.sql's comment on these columns for why sharing one pair
// would be wrong (the two flows can be in progress on the same account
// at once).
//
// Safe to re-run - ADD COLUMN IF NOT EXISTS.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Adding users.password_reset_token_hash and .password_reset_token_expires_at...");
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT,
      ADD COLUMN IF NOT EXISTS password_reset_token_expires_at TIMESTAMPTZ
  `;

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

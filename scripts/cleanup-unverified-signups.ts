import { db } from "../lib/db";

// Cleanup job (2026-09-04): permanently deletes credential-based signups
// that were never verified, once they're old enough that the verification
// link itself would already be long expired (that link expires after 24
// hours - see lib/email/verification.ts's TOKEN_EXPIRY_HOURS). Without
// this, an unverified signup row sits in `users` forever - nobody can log
// in to it (lib/auth.ts's authorize() rejects sign-in until
// email_verified_at is set), and nothing else in the app ever revisits it.
//
// Scoped deliberately narrow:
//   - password_hash IS NOT NULL   -> only credential signups. Google
//     sign-ins (lib/auth.ts's signIn callback) set email_verified_at
//     immediately on insert/upsert, so they can never match this
//     condition regardless of age.
//   - email_verified_at IS NULL   -> never completed verification.
//     Anyone who verified - or who later signed in with Google using the
//     same email, which that same signIn callback upserts
//     email_verified_at onto - is excluded, no matter how old the row is.
//   - created_at older than the retention window below.
//
// Safe to hard-delete: an unverified credentials-only user cannot log in
// at all (see lib/auth.ts), so they can never have created saved_searches
// or a subscription. Both of those tables reference users(id) ON DELETE
// CASCADE anyway, so even if that assumption ever changed, this cleanup
// couldn't silently orphan other data - it would cascade cleanly.
const RETENTION_DAYS = 7;

async function main() {
  console.log(`Deleting unverified signups older than ${RETENTION_DAYS} days...`);

  const sql = db();
  const deleted = await sql`
    DELETE FROM users
    WHERE password_hash IS NOT NULL
      AND email_verified_at IS NULL
      AND created_at < now() - make_interval(days => ${RETENTION_DAYS})
    RETURNING id, email, created_at
  `;

  if (deleted.length === 0) {
    console.log("No unverified signups old enough to delete. Nothing to do.");
  } else {
    console.log(`Deleted ${deleted.length} unverified signup(s):`);
    for (const row of deleted as { id: string; email: string; created_at: string }[]) {
      console.log(`  ${row.email} (id=${row.id}, created_at=${row.created_at})`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("cleanup-unverified-signups crashed:", err);
  process.exit(1);
});

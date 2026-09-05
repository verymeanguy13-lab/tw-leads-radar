import { neon } from "@neondatabase/serverless";

// One-time data fix (2026-09-05), companion to the free tier
// weekly->monthly cadence policy change in lib/tiers.ts (see that
// file's comment on TIER_LIMITS for the full reasoning).
//
// Changing TIER_LIMITS alone only affects NEW saved searches going
// forward - it does nothing for any saved_searches row that already
// exists with cadence='weekly' from before this policy existed. Without
// this fix, an existing free-tier user would keep receiving weekly
// digests indefinitely, exempt from a restriction every new free
// signup is held to - not because they're grandfathered on purpose, but
// because nothing ever went back and corrected their row.
//
// Deliberately does NOT touch pro/business users' saved_searches, even
// ones set to 'weekly' or 'daily' - those cadences are legitimately
// theirs. "Free tier" here is determined the same way
// lib/tiers.ts's getUserTier() defines it: no active pro/business
// subscription row = free, regardless of what's in the users table.
//
// Safe to re-run - it's a plain UPDATE ... WHERE cadence != 'monthly',
// so running it twice just finds nothing left to update the second time.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Finding free-tier saved_searches not already on monthly cadence...");
  const preview = await sql`
    SELECT ss.id, ss.cadence
    FROM saved_searches ss
    WHERE ss.cadence != 'monthly'
      AND NOT EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.user_id = ss.user_id
          AND s.status = 'active'
          AND s.tier IN ('pro', 'business')
      )
  `;

  if (preview.length === 0) {
    console.log("Nothing to do - no free-tier saved_searches on a non-monthly cadence.");
    return;
  }

  console.log(`Updating ${preview.length} free-tier saved_searches to cadence='monthly'...`);
  await sql`
    UPDATE saved_searches ss
    SET cadence = 'monthly'
    WHERE ss.cadence != 'monthly'
      AND NOT EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.user_id = ss.user_id
          AND s.status = 'active'
          AND s.tier IN ('pro', 'business')
      )
  `;

  console.log("Done.");
}

main().catch((err) => {
  console.error("migrate-free-tier-cadence-to-monthly.ts failed:", err);
  process.exit(1);
});

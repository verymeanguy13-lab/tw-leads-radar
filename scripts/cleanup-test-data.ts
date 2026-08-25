import { neon } from "@neondatabase/serverless";

// Deletes the two confirmed test-data items from architecture.md's
// "Known open items", per scripts/check-test-data.ts's confirmed output
// on 2026-08-24/25:
//   - subscriptions row 166ec8f8-8a3f-40af-b29e-bd4e16221e02
//     (paddle_subscription_id confirmed NULL — not backed by real Paddle)
//   - verymeanguy11@gmail.com's 7 "Test" saved_searches
//     (search_matches cascade-deletes automatically per schema.sql's
//     ON DELETE CASCADE on saved_search_id)
//
// Re-checks the safety condition itself rather than trusting the earlier
// check script's output blindly, in case anything changed in between.

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("=== Deleting test subscription row ===");
  const sub = await sql`
    SELECT id, paddle_subscription_id FROM subscriptions
    WHERE user_id = '3503f33c-486d-43c2-a63d-73fbc4f69193'
  `;
  if (sub.length === 0) {
    console.log("No matching subscription row found — already deleted, nothing to do.");
  } else if (sub[0].paddle_subscription_id !== null) {
    console.error(
      "ABORTING: this row now has a non-null paddle_subscription_id — it may be a real subscription. Not deleting. Check manually."
    );
    process.exit(1);
  } else {
    await sql`DELETE FROM subscriptions WHERE id = ${sub[0].id}`;
    console.log(`Deleted subscription row ${sub[0].id}.`);
  }

  console.log("");
  console.log("=== Deleting verymeanguy11@gmail.com's test saved searches ===");
  const deleted = await sql`
    DELETE FROM saved_searches
    WHERE user_id = (SELECT id FROM users WHERE email = 'verymeanguy11@gmail.com')
    AND name = 'Test'
    RETURNING id, name
  `;
  console.log(`Deleted ${deleted.length} saved search(es).`);
  for (const row of deleted) {
    console.log(`  - ${row.id} ("${row.name}")`);
  }

  console.log("");
  console.log("Done. search_matches for the deleted searches were removed automatically via ON DELETE CASCADE.");
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});

import { neon } from "@neondatabase/serverless";

// Read-only. Reports the two known test-data items from
// architecture.md's "Known open items" before scripts/cleanup-test-data.ts
// actually deletes anything.

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("=== Test subscription row (user id 3503f33c-486d-43c2-a63d-73fbc4f69193) ===");
  const user = await sql`
    SELECT id, email, name, created_at FROM users
    WHERE id = '3503f33c-486d-43c2-a63d-73fbc4f69193'
  `;
  if (user.length === 0) {
    console.log("No user found with this id — may already have been cleaned up.");
  } else {
    console.log("User:", user[0]);
    const sub = await sql`
      SELECT id, tier, paddle_customer_id, paddle_subscription_id, status, created_at
      FROM subscriptions
      WHERE user_id = '3503f33c-486d-43c2-a63d-73fbc4f69193'
    `;
    console.log(`Subscription row(s) (${sub.length}):`, sub);
    const realPaddleRows = sub.filter((r) => r.paddle_subscription_id !== null);
    if (realPaddleRows.length > 0) {
      console.log(
        "WARNING: this user has a subscription row WITH a real paddle_subscription_id — this may not be pure test data. Do not delete without checking manually first."
      );
    }
  }

  console.log("");
  console.log("=== verymeanguy11@gmail.com's saved searches ===");
  const searches = await sql`
    SELECT ss.id, ss.name, ss.created_at,
           (SELECT count(*) FROM search_matches sm WHERE sm.saved_search_id = ss.id) as match_count
    FROM saved_searches ss
    JOIN users u ON u.id = ss.user_id
    WHERE u.email = 'verymeanguy11@gmail.com'
    ORDER BY ss.created_at
  `;
  console.log(`Found ${searches.length} saved search(es):`);
  for (const s of searches) {
    console.log(`  - "${s.name}" (id: ${s.id}, ${s.match_count} matches, created ${s.created_at})`);
  }
}

main().catch((err) => {
  console.error("Check failed:", err);
  process.exit(1);
});

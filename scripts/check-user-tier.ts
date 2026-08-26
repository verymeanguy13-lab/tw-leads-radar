import { neon } from "@neondatabase/serverless";

// Session 23 (QA Pass) — small reusable utility, not tied to any one
// session's specific test data. Prints a user's tier/subscription
// status by email, so future QA/testing doesn't need to guess which
// account is free vs. paid before running a bypass test against it.

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npx tsx scripts/check-user-tier.ts <email>");
    process.exit(1);
  }

  const users = await sql`SELECT id, email FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    console.log(`No user found with email ${email}`);
    return;
  }
  const userId = users[0].id;

  const subs = await sql`
    SELECT tier, status, paddle_subscription_id, created_at
    FROM subscriptions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  console.log(`User: ${email} (id: ${userId})`);
  if (subs.length === 0) {
    console.log("No subscription rows at all — effectively free tier.");
  } else {
    console.log(`${subs.length} subscription row(s):`);
    for (const s of subs) {
      console.log(`  - tier: ${s.tier}, status: ${s.status}, paddle_subscription_id: ${s.paddle_subscription_id}, created: ${s.created_at}`);
    }
    const active = subs.find((s) => s.status === "active");
    console.log(active ? `Effective tier: ${active.tier} (active)` : "No active subscription row — effectively free tier.");
  }

  const searches = await sql`
    SELECT id, name, cadence, industry_codes, regions, capital_min, capital_max, entity_type, keyword, paused
    FROM saved_searches WHERE user_id = ${userId}
  `;
  console.log(`${searches.length} saved search(es):`);
  for (const s of searches) {
    console.log(`  - ${s.id} "${s.name}" (cadence: ${s.cadence}, paused: ${s.paused})`);
    console.log(`    industry_codes: ${JSON.stringify(s.industry_codes)}, regions: ${JSON.stringify(s.regions)}`);
    console.log(`    entity_type: ${s.entity_type}, capital_min: ${s.capital_min}, capital_max: ${s.capital_max}, keyword: ${JSON.stringify(s.keyword)}`);
  }

  const matchCounts = await sql`
    SELECT ss.id, count(sm.id) as match_count
    FROM saved_searches ss
    LEFT JOIN search_matches sm ON sm.saved_search_id = ss.id
    WHERE ss.user_id = ${userId}
    GROUP BY ss.id
  `;
  console.log("Match counts:", matchCounts);
}

main().catch((err) => {
  console.error("Check failed:", err);
  process.exit(1);
});

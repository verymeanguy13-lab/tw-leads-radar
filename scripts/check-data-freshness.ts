import { neon } from "@neondatabase/serverless";

// One-off diagnostic — not part of the regular scripts, just answering
// "is the newest company data actually current, or has ingestion
// stalled?" Prints:
//   1. The newest registration_date across ALL companies (any tier) —
//      if this is old, no tier can see anything newer, and that's an
//      ingestion problem, not a tier-gating problem.
//   2. How many companies were inserted in the last 7 days (created_at)
//      — near-zero here means the daily discovery job isn't adding new
//      companies, regardless of what their registration_date says.
//   3. The 10 most recent ingestion_runs rows, so you can see whether
//      the daily/monthly jobs are actually completing successfully or
//      erroring out silently.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const [freshness] = await sql`
    SELECT
      MAX(registration_date) AS max_registration_date,
      MAX(created_at) AS max_created_at,
      COUNT(*) FILTER (WHERE created_at > now() - interval '7 days') AS inserted_last_7_days,
      COUNT(*) FILTER (WHERE registration_date > now() - interval '30 days') AS registered_last_30_days
    FROM companies
    WHERE entity_type = 'company'
  `;

  console.log("=== Data freshness (entity_type='company', all tiers) ===");
  console.log(`Newest registration_date in the whole table: ${freshness.max_registration_date}`);
  console.log(`Newest created_at (most recently imported row): ${freshness.max_created_at}`);
  console.log(`Companies inserted in the last 7 days: ${freshness.inserted_last_7_days}`);
  console.log(`Companies with registration_date in the last 30 days: ${freshness.registered_last_30_days}`);
  console.log("");

  const runs = await sql`
    SELECT dataset_name, source_month, status, row_count, new_count, started_at, completed_at, error_log
    FROM ingestion_runs
    ORDER BY started_at DESC
    LIMIT 10
  `;

  console.log("=== 10 most recent ingestion_runs ===");
  for (const r of runs) {
    console.log(
      `${r.started_at} | ${r.dataset_name} (${r.source_month ?? "n/a"}) | ${r.status} | rows=${r.row_count} new=${r.new_count}${
        r.error_log ? ` | ERROR: ${String(r.error_log).slice(0, 200)}` : ""
      }`
    );
  }
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});

import { neon } from "@neondatabase/serverless";

// Investigating: company-wide data shows real companies registered
// 2026-08-12 to 2026-08-25 (confirmed via check-registration-date-gap.ts),
// but a specific filtered search (Taipei region + some industry code)
// shows ZERO matches in that exact window. Checking whether daily-
// pipeline-sourced rows (source_dataset='gcis_daily_setup_query') are
// missing address_region and/or industry_codes — the two fields any
// filtered search actually needs to match against. If so, this is a
// much bigger problem than "sparse matches by chance": it would mean
// paid tier's core promise (same-day fresh data) is being ingested but
// is effectively unsearchable.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("=== Field completeness by source, for companies registered 2026-08-12 to 2026-08-25 ===");
  const bySource = await sql`
    SELECT
      source_dataset,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE address_region IS NULL OR address_region = '') AS missing_region,
      COUNT(*) FILTER (WHERE industry_codes IS NULL OR array_length(industry_codes, 1) IS NULL) AS missing_industry_codes
    FROM companies
    WHERE entity_type = 'company'
      AND registration_date BETWEEN '2026-08-12' AND '2026-08-25'
    GROUP BY source_dataset
  `;
  for (const row of bySource) {
    console.log(
      `${row.source_dataset}: ${row.total} total, ${row.missing_region} missing address_region, ${row.missing_industry_codes} missing industry_codes`
    );
  }

  console.log("");
  console.log("=== Sample of 5 daily-pipeline rows from that window (raw field values) ===");
  const sample = await sql`
    SELECT uniform_id, name, address_region, industry_codes, registration_date, source_dataset
    FROM companies
    WHERE entity_type = 'company'
      AND registration_date BETWEEN '2026-08-12' AND '2026-08-25'
      AND source_dataset = 'gcis_daily_setup_query'
    LIMIT 5
  `;
  for (const row of sample) {
    console.log(JSON.stringify(row));
  }

  console.log("");
  console.log("=== For comparison: same check on company_new (07-15 to 07-22 window) ===");
  const compareSource = await sql`
    SELECT
      source_dataset,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE address_region IS NULL OR address_region = '') AS missing_region,
      COUNT(*) FILTER (WHERE industry_codes IS NULL OR array_length(industry_codes, 1) IS NULL) AS missing_industry_codes
    FROM companies
    WHERE entity_type = 'company'
      AND registration_date BETWEEN '2026-07-15' AND '2026-07-22'
    GROUP BY source_dataset
  `;
  for (const row of compareSource) {
    console.log(
      `${row.source_dataset}: ${row.total} total, ${row.missing_region} missing address_region, ${row.missing_industry_codes} missing industry_codes`
    );
  }
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});

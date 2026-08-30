import { neon } from "@neondatabase/serverless";

// Distinguishing two very different explanations for missing
// address_region / industry_codes on daily-pipeline rows:
//   (a) a bug in our fetch/parse code — completeness would be roughly
//       flat regardless of how old the registration is within the
//       window, since a code bug doesn't care about elapsed time.
//   (b) GCIS's own systems haven't finished processing very recently
//       registered companies yet (their detailed business-activity
//       classification might be filed/processed separately from basic
//       registration, on their timeline, not immediately) — completion
//       rates should visibly IMPROVE for older-within-window dates,
//       since GCIS has had more days to catch up.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("=== Field completeness by day, gcis_daily_setup_query only, 2026-08-01 to 2026-08-30 ===");
  const byDay = await sql`
    SELECT
      registration_date,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE address_region IS NOT NULL AND address_region != '') AS has_region,
      COUNT(*) FILTER (WHERE industry_codes IS NOT NULL AND array_length(industry_codes, 1) > 0) AS has_industry_codes,
      COUNT(*) FILTER (WHERE address_raw IS NULL) AS missing_address_raw
    FROM companies
    WHERE entity_type = 'company'
      AND source_dataset = 'gcis_daily_setup_query'
      AND registration_date BETWEEN '2026-08-01' AND '2026-08-30'
    GROUP BY registration_date
    ORDER BY registration_date ASC
  `;
  for (const row of byDay) {
    const regionPct = ((Number(row.has_region) / Number(row.total)) * 100).toFixed(0);
    const industryPct = ((Number(row.has_industry_codes) / Number(row.total)) * 100).toFixed(0);
    console.log(
      `${row.registration_date}: total=${row.total}, has_region=${regionPct}%, has_industry_codes=${industryPct}%, missing_address_raw=${row.missing_address_raw}`
    );
  }
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});

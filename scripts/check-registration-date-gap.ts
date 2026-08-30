import { neon } from "@neondatabase/serverless";

// One-off diagnostic — investigating an observed gap in registration
// dates (roughly 2026-07-22 to 2026-08-26) noticed in one filtered
// search's results. Checks whether this is a gap across the WHOLE
// companies table (a real ingestion problem) or specific to that one
// search's narrow filter (just sparse matching data, not a bug).
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("=== Daily registration_date counts, 2026-07-15 to 2026-08-30 (ALL companies, no filter) ===");
  const daily = await sql`
    SELECT registration_date, COUNT(*) AS company_count
    FROM companies
    WHERE entity_type = 'company'
      AND registration_date BETWEEN '2026-07-15' AND '2026-08-30'
    GROUP BY registration_date
    ORDER BY registration_date ASC
  `;
  for (const row of daily) {
    console.log(`${row.registration_date}: ${row.company_count} companies`);
  }

  console.log("");
  console.log("=== source_dataset breakdown for companies registered in the gap window (07-22 to 08-26) ===");
  const gapSources = await sql`
    SELECT source_dataset, source_month, COUNT(*) AS company_count
    FROM companies
    WHERE entity_type = 'company'
      AND registration_date > '2026-07-22'
      AND registration_date < '2026-08-26'
    GROUP BY source_dataset, source_month
    ORDER BY company_count DESC
  `;
  if (gapSources.length === 0) {
    console.log("(no companies at all have a registration_date in this window, company-wide)");
  } else {
    for (const row of gapSources) {
      console.log(`${row.source_dataset} (${row.source_month ?? "n/a"}): ${row.company_count}`);
    }
  }

  console.log("");
  console.log("=== source_dataset breakdown for companies registered right around 08-26 (the dense cluster) ===");
  const clusterSources = await sql`
    SELECT source_dataset, source_month, COUNT(*) AS company_count
    FROM companies
    WHERE entity_type = 'company'
      AND registration_date BETWEEN '2026-08-24' AND '2026-08-28'
    GROUP BY source_dataset, source_month
    ORDER BY company_count DESC
  `;
  for (const row of clusterSources) {
    console.log(`${row.source_dataset} (${row.source_month ?? "n/a"}): ${row.company_count}`);
  }

  console.log("");
  console.log("=== source_dataset breakdown for companies registered right around 07-15 to 07-22 (the earlier cluster) ===");
  const earlierClusterSources = await sql`
    SELECT source_dataset, source_month, COUNT(*) AS company_count
    FROM companies
    WHERE entity_type = 'company'
      AND registration_date BETWEEN '2026-07-15' AND '2026-07-22'
    GROUP BY source_dataset, source_month
    ORDER BY company_count DESC
  `;
  for (const row of earlierClusterSources) {
    console.log(`${row.source_dataset} (${row.source_month ?? "n/a"}): ${row.company_count}`);
  }
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});

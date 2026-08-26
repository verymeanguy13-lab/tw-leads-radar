import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const aug = await sql`
    SELECT count(*) FROM companies
    WHERE entity_type='company' AND address_region='臺北市' AND registration_date >= '2026-08-01'
  `;
  console.log("Taipei companies registered in August (any industry):", aug[0].count);

  const augEmpty = await sql`
    SELECT count(*) FROM companies
    WHERE entity_type='company' AND address_region='臺北市' AND registration_date >= '2026-08-01'
      AND industry_codes = '{}'
  `;
  console.log("...of those, with EMPTY industry_codes:", augEmpty[0].count);

  const augH = await sql`
    SELECT count(*) FROM companies
    WHERE entity_type='company' AND address_region='臺北市' AND registration_date >= '2026-08-01'
      AND 'H' = ANY(industry_codes)
  `;
  console.log("...of those, classified as H (finance/insurance/real-estate):", augH[0].count);

  const sample = await sql`
    SELECT uniform_id, name, registration_date, industry_codes FROM companies
    WHERE entity_type='company' AND address_region='臺北市' AND registration_date >= '2026-08-01'
    ORDER BY registration_date DESC
    LIMIT 5
  `;
  console.log("Sample of 5 recent August Taipei companies:", sample);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

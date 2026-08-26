import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const today = await sql`
    SELECT uniform_id, name, registration_date, industry_codes
    FROM companies
    WHERE entity_type='company' AND registration_date >= '2026-08-25'
    ORDER BY registration_date DESC
    LIMIT 20
  `;
  console.log(`${today.length} companies registered since 2026-08-25:`);
  let withCodes = 0;
  let empty = 0;
  for (const c of today) {
    const hasCodes = c.industry_codes && c.industry_codes.length > 0;
    if (hasCodes) withCodes++; else empty++;
    console.log(`  ${hasCodes ? "OK " : "EMPTY"} ${c.uniform_id} ${c.name} (${c.registration_date}) codes: ${JSON.stringify(c.industry_codes)}`);
  }
  console.log(`\nWith codes: ${withCodes}, Empty: ${empty}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

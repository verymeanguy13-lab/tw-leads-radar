import { neon } from "@neondatabase/serverless";

// One-time migration (2026-09-05): adds the prospect_contacts table for
// Sessions 25-26 (bookkeeper association + CPA firm prospect lists).
// Admin-only, internal outbound-sales data - not customer-owned, no RLS
// (see db/schema.sql's comment on this table for why). Additive only.
//
// Safe to re-run - every statement is IF NOT EXISTS / CREATE TABLE IF
// NOT EXISTS.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Creating prospect_contacts if it doesn't already exist...");
  await sql`
    CREATE TABLE IF NOT EXISTS prospect_contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_type VARCHAR(30) NOT NULL CHECK (contact_type IN ('bookkeeper', 'bookkeeper_association', 'cpa_firm')),
      name TEXT NOT NULL,
      firm_name TEXT NOT NULL,
      region TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      website TEXT,
      source_url TEXT NOT NULL,
      source_association TEXT,
      seed_source TEXT,
      contact_method TEXT,
      do_not_contact BOOLEAN NOT NULL DEFAULT FALSE,
      outreach_status VARCHAR(20) NOT NULL CHECK (outreach_status IN ('not_contacted', 'contacted', 'replied', 'opted_out', 'converted')) DEFAULT 'not_contacted',
      notes TEXT,
      scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(name, firm_name, region)
    )
  `;

  console.log("Creating indexes if they don't already exist...");
  await sql`CREATE INDEX IF NOT EXISTS idx_prospect_contacts_region ON prospect_contacts(region)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prospect_contacts_contact_type ON prospect_contacts(contact_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prospect_contacts_do_not_contact ON prospect_contacts(do_not_contact)`;

  console.log("Granting app_user access (no RLS - admin-only, gated at the app layer)...");
  await sql`GRANT SELECT, INSERT, UPDATE ON prospect_contacts TO app_user`;

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

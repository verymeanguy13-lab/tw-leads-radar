import type { NeonQueryFunction } from "@neondatabase/serverless";

export interface ProspectContactRow {
  contact_type: "bookkeeper" | "bookkeeper_association" | "cpa_firm";
  name: string;
  firm_name: string;
  region: string;
  phone?: string;
  email?: string;
  website?: string;
  source_url: string;
  source_association?: string;
  seed_source?: string;
  contact_method?: string;
  notes?: string;
}

// Shared by scripts/scrape-bookkeepers.ts and scripts/scrape-cpa-firms.ts.
// Idempotent via ON CONFLICT on prospect_contacts' (name, firm_name,
// region) unique key (Session 25/26 objective: re-running updates
// existing rows rather than duplicating them). Deliberately does NOT
// overwrite do_not_contact or outreach_status on conflict - see
// db/schema.sql's comment on prospect_contacts for why: a re-scrape
// must never silently resurrect a contact an admin already excluded.
export async function upsertProspectContact(
  sql: NeonQueryFunction<false, false>,
  row: ProspectContactRow
): Promise<void> {
  await sql`
    INSERT INTO prospect_contacts (
      contact_type, name, firm_name, region, phone, email, website,
      source_url, source_association, seed_source, contact_method, notes, scraped_at
    ) VALUES (
      ${row.contact_type}, ${row.name}, ${row.firm_name}, ${row.region},
      ${row.phone ?? null}, ${row.email ?? null}, ${row.website ?? null},
      ${row.source_url}, ${row.source_association ?? null}, ${row.seed_source ?? null},
      ${row.contact_method ?? null}, ${row.notes ?? null}, now()
    )
    ON CONFLICT (name, firm_name, region) DO UPDATE SET
      contact_type = EXCLUDED.contact_type,
      phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      website = EXCLUDED.website,
      source_url = EXCLUDED.source_url,
      source_association = EXCLUDED.source_association,
      seed_source = EXCLUDED.seed_source,
      contact_method = EXCLUDED.contact_method,
      notes = EXCLUDED.notes,
      scraped_at = now()
  `;
}

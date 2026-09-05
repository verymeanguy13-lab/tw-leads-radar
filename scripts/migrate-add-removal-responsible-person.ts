import { neon } from "@neondatabase/serverless";

// One-time migration (2026-09-05): adds
// data_removal_requests.responsible_person_submitted.
//
// Context: the public /data-removal form now requires both 統一編號
// and the company's registered 負責人姓名, and the API route rejects
// the submission outright if the name doesn't match
// companies.responsible_person for that uniform_id - see
// app/api/data-removal-requests/route.ts. This was added to raise the
// bar against someone impersonating a business they don't represent to
// get a real competitor delisted (the uniform_id alone wasn't a
// meaningful barrier, since it's visible on this site's own public
// search results).
//
// This column just records what the requester typed, for the admin
// review queue - by the time a row exists in this table, the name
// match already passed, so this is an audit trail, not itself a check.
//
// Safe to re-run - ADD COLUMN IF NOT EXISTS.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Adding data_removal_requests.responsible_person_submitted...");
  await sql`
    ALTER TABLE data_removal_requests
    ADD COLUMN IF NOT EXISTS responsible_person_submitted TEXT
  `;
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

import { neon } from "@neondatabase/serverless";

// One-time migration (2026-09-08): adds
// newebpay_pending_orders.supersedes_period_no, needed for the new
// self-service plan-switch feature (existing monthly NewebPay Period
// subscribers moving between Plan B/pro and Plan C/business — see
// app/api/checkout/newebpay-switch/route.ts and the matching change in
// app/api/webhooks/newebpay/route.ts).
//
// Context: NewebPay's Period API has no "change the amount on an
// existing commitment" endpoint — only create (a brand-new
// authorization) and AlterStatus (restart/suspend/terminate an existing
// one). A plan switch is therefore implemented as "create a new Period
// commitment at the target tier's price, and once THAT is confirmed
// paid, terminate the old one" — never the other order, so a customer
// who abandons the new checkout never ends up with zero active
// subscription (see architecture.md's 2026-09-08 entry for the full
// design and its failure-mode reasoning).
// supersedes_period_no records which old commitment a given pending
// switch-order should terminate once it's confirmed. NULL for every
// ordinary new-purchase order (app/api/checkout/newebpay/route.ts never
// sets it) — only the new switch route sets this.
//
// Safe to re-run - ADD COLUMN IF NOT EXISTS.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Adding newebpay_pending_orders.supersedes_period_no...");
  await sql`
    ALTER TABLE newebpay_pending_orders
    ADD COLUMN IF NOT EXISTS supersedes_period_no TEXT
  `;

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

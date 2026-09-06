import { neon } from "@neondatabase/serverless";

// One-time migration (2026-09-06): adds business_use_confirmed_at to
// both newebpay_pending_orders and subscriptions.
//
// Context: app/(marketing)/terms/page.tsx (第一條, 第六條) already stated
// that at subscription time the user is asked to confirm they're using
// the service for business/operational/professional purposes, not
// personal consumption - a confirmation this site's Terms rely on to
// support the position that the Consumer Protection Act's cooling-off
// right for distance transactions doesn't apply (Terms 第六條). Until
// this round, that checkbox didn't actually exist anywhere in the
// product - flagged by the 2026-09-06 site completeness audit. This
// migration just prepares the schema for the checkbox added the same
// round to components/NewebpayCheckoutButton.tsx:
// newebpay_pending_orders.business_use_confirmed_at is set at
// checkout-initiation time (app/api/checkout/newebpay/route.ts and
// .../newebpay-yearly/route.ts, which now also reject the request
// outright if the checkbox wasn't checked), and copied onto
// subscriptions.business_use_confirmed_at when the webhook
// (app/api/webhooks/newebpay/route.ts and .../newebpay-mpg/route.ts)
// creates the real subscription row, so the record survives past the
// pending order's short lifetime.
//
// Safe to re-run - ADD COLUMN IF NOT EXISTS.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Adding newebpay_pending_orders.business_use_confirmed_at...");
  await sql`
    ALTER TABLE newebpay_pending_orders
    ADD COLUMN IF NOT EXISTS business_use_confirmed_at TIMESTAMPTZ
  `;

  console.log("Adding subscriptions.business_use_confirmed_at...");
  await sql`
    ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS business_use_confirmed_at TIMESTAMPTZ
  `;

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

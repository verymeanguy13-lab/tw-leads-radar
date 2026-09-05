import { neon } from "@neondatabase/serverless";

// One-time migration (2026-09-05): adds subscriptions.canceled_at.
//
// Needed once app/(marketing)/pricing/page.tsx's checkout button was
// switched from Paddle to NewebPay (see that file's own comment) and
// app/api/account/cancel/route.ts gained a NewebPay cancellation branch
// (lib/newebpay-api.ts's alterNewebpayPeriodStatus()). Unlike Paddle,
// where "is a cancellation pending" is read live from Paddle's own API
// on every GET /api/account call, NewebPay has no equivalent live read —
// this column is this app's own record that a NewebPay subscription's
// cancellation was already requested, so the account page can show
// "訂閱將於以下日期結束" instead of "下次續費日期" for it. See
// db/schema.sql's own comment on this column and lib/tiers.ts's
// getUserTier() for how current_period_end (not status) is what
// actually keeps access alive until the already-paid period ends.
//
// Additive only - does not touch any existing column, table, or row.
// Safe to re-run - IF NOT EXISTS.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Adding subscriptions.canceled_at if it doesn't already exist...");
  await sql`
    ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ
  `;
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

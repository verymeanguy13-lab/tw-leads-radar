import { neon } from "@neondatabase/serverless";

// One-time migration (2026-09-04): adds the 藍新 (NewebPay) recurring-
// billing columns to `subscriptions`, plus the new
// `newebpay_pending_orders` table. Part of the 2026-09-04 billing-switch
// decision (architecture.md) - additive only, does NOT touch or remove
// any paddle_* column. Paddle checkout stays live until the NewebPay
// integration is built and verified; this migration just prepares the
// schema ahead of that, same spirit as the vat_id migration's
// capture-and-store-only scoping.
//
// Safe to re-run - every statement is IF NOT EXISTS / CREATE TABLE IF
// NOT EXISTS.
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Adding subscriptions.newebpay_merchant_order_no and .newebpay_period_no if they don't already exist...");
  await sql`
    ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS newebpay_merchant_order_no TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS newebpay_period_no TEXT UNIQUE
  `;

  console.log("Creating newebpay_pending_orders if it doesn't already exist...");
  await sql`
    CREATE TABLE IF NOT EXISTS newebpay_pending_orders (
      merchant_order_no TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tier VARCHAR(20) NOT NULL CHECK (tier IN ('pro', 'business')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      claimed_at TIMESTAMPTZ
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_newebpay_pending_orders_user_id
      ON newebpay_pending_orders(user_id)
  `;

  console.log("Enabling RLS and isolation policy on newebpay_pending_orders...");
  await sql`ALTER TABLE newebpay_pending_orders ENABLE ROW LEVEL SECURITY`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'newebpay_pending_orders'
          AND policyname = 'newebpay_pending_orders_isolation'
      ) THEN
        CREATE POLICY newebpay_pending_orders_isolation ON newebpay_pending_orders
          USING (user_id = current_setting('app.current_user_id', true)::UUID);
      END IF;
    END
    $$;
  `;
  await sql`
    GRANT SELECT, INSERT, UPDATE, DELETE ON newebpay_pending_orders TO app_user
  `;

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

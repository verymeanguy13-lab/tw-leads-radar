import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";
import { buildCreatePeriodOrderRequest, type PeriodType } from "@/lib/newebpay-api";
import { TIER_PRICING } from "@/lib/tiers";
import { NextResponse } from "next/server";
import crypto from "crypto";

// 2026-09-04 — checkout-initiation route for 藍新 (NewebPay) 信用卡定期定額
// (recurring credit card). This is the missing piece both
// lib/newebpay-api.ts and app/api/webhooks/newebpay/route.ts's own
// comments flagged as "not yet built" — until now nothing called
// buildCreatePeriodOrderRequest() or inserted into
// newebpay_pending_orders, so the webhook had nothing to match incoming
// notifies against.
//
// **Not wired into any live page yet, by design.** This route and its
// matching client component (components/NewebpayCheckoutButton.tsx) are
// real, callable code, but nothing currently imports the button into
// app/(marketing)/pricing/page.tsx. Per the standing 2026-09-04 decision,
// hiding/replacing the Paddle checkout flow is deferred until the whole
// NewebPay loop is built AND verified against a real sandbox account —
// see architecture.md's to-do list. Wiring this in is a later, deliberate
// step, not an oversight.
//
// **Cannot be tested end-to-end yet.** NEWEBPAY_MERCHANT_ID/HASH_KEY/
// HASH_IV are still unset — no merchant account exists as of this
// writing. This route fails clearly (503), not with a silent no-op or a
// raw 500, when those are missing, so it's safe to leave deployed live
// even before an account exists.
//
// Mirrors app/api/account/change-plan/route.ts's auth/lookup pattern.
// Unlike that route (existing subscriber only), this is a NEW-purchase
// flow — the NewebPay equivalent of what components/CheckoutButton.tsx's
// Paddle.Checkout.open() does for Paddle. NewebPay has no client-side
// checkout overlay, so "open checkout" here means: call this route to
// get back {url, postData, merchantId}, then browser-POST those two
// fields directly to NewebPay's hosted /MPG/period page (see
// NewebpayCheckoutButton.tsx) — NewebPay's own hosted page takes over
// from there, the same way Paddle's overlay takes over after
// Checkout.open().

function generateMerchantOrderNo(): string {
  // string(30) max, alphanumeric + underscore only, per the field spec
  // lib/newebpay-api.ts's CreatePeriodOrderParams is built against. Well
  // under the limit and collision-safe without a DB round-trip to check
  // uniqueness first.
  return `nwp_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

const TIER_LABELS: Record<"pro" | "business", string> = {
  // Kept ASCII-only, not the Chinese plan names used elsewhere in the UI:
  // ProdDesc is spec'd as string(100) "limited charset" (architecture.md,
  // 2026-09-04 API-spec-pull entry) and whether that charset covers UTF-8
  // Chinese text was never confirmed. Not worth the risk on a field
  // NewebPay may reject or mangle — this text is only ever shown on
  // NewebPay's own hosted page and in their back-office, not on
  // taiwanleads.com itself.
  pro: "TaiwanLeads Pro Plan",
  business: "TaiwanLeads Business Plan",
};

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tier = body?.tier as "pro" | "business" | undefined;
  const cadence = body?.cadence as "monthly" | "yearly" | undefined;

  if (!tier || !cadence || !TIER_PRICING[tier]?.[cadence]) {
    return NextResponse.json({ error: "tier and cadence are required" }, { status: 400 });
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Mirrors change-plan's guard in reverse: that route requires an
  // existing active paid subscription; this one requires there NOT be
  // one, since it's a new-purchase flow only. Without this check, an
  // already-paying customer hitting this route again could create a
  // second, orphaned newebpay_pending_orders row (or a second
  // subscriptions row) — change-plan is the correct path for an existing
  // subscriber.
  const existingRows = await sql`
    SELECT id FROM subscriptions WHERE user_id = ${userId} AND status = 'active'
  `;
  if (existingRows.length > 0) {
    return NextResponse.json(
      { error: "已有進行中的訂閱，請至帳戶設定變更方案" },
      { status: 400 }
    );
  }

  const periodAmt = TIER_PRICING[tier][cadence];
  const merchantOrderNo = generateMerchantOrderNo();

  // 2026-09-04: periodPoint's exact expected format/encoding is NOT
  // confirmed against NewebPay's real spec — lib/newebpay-api.ts's own
  // CreatePeriodOrderParams comment already flags this. This follows the
  // most commonly documented convention across independent NewebPay
  // integration write-ups (day-of-month, zero-padded, for M; MMDD for Y)
  // but has never been tested against a live or sandbox NewebPay
  // endpoint. Re-verify against the actual current PDF (NDNP-1.0.6), or
  // a sandbox test, before trusting this in production.
  const now = new Date();
  let periodType: PeriodType;
  let periodPoint: string;
  if (cadence === "monthly") {
    periodType = "M";
    periodPoint = String(now.getDate()).padStart(2, "0");
  } else {
    periodType = "Y";
    periodPoint = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }

  // NewebPay's Period API requires an explicit, bounded cycle count (max
  // 99 per the field spec) — unlike Paddle, there is no "run
  // indefinitely until canceled" option. 99 is the maximum allowed, used
  // here to approximate an open-ended subscription (99 cycles ≈ 8.25
  // years for monthly, 99 years for yearly). **Real, unbuilt gap**: when
  // a commitment's cycles run out, NewebPay simply stops charging —
  // nothing in this codebase yet detects that or creates a fresh Period
  // commitment to continue billing past cycle 99. Flagging this now so
  // it isn't rediscovered as a surprise years from now.
  const periodTimes = 99;

  let order: { url: string; postData: string; merchantId: string };
  try {
    order = buildCreatePeriodOrderRequest({
      merchantOrderNo,
      periodAmt,
      periodType,
      periodPoint,
      periodTimes,
      payerEmail: session.user.email,
      prodDesc: `${TIER_LABELS[tier]} (${cadence === "monthly" ? "Monthly" : "Yearly"})`,
      returnUrl: `${process.env.NEXTAUTH_URL}/account?newebpay=return`,
      notifyUrl: `${process.env.NEXTAUTH_URL}/api/webhooks/newebpay`,
    });
  } catch (err) {
    // requireEnv() inside lib/newebpay-api.ts throws when
    // NEWEBPAY_MERCHANT_ID/HASH_KEY/HASH_IV aren't set — expected until a
    // real merchant account exists. Fail loudly with a clear status, not
    // a raw 500 or a silent no-op.
    console.error("NewebPay checkout: not configured yet", err);
    return NextResponse.json(
      { error: "NewebPay 尚未設定完成，目前無法使用此付款方式" },
      { status: 503 }
    );
  }

  // Insert through withUserContext (RLS-scoped), matching db/schema.sql's
  // own comment on newebpay_pending_orders: "Checkout-initiation code...
  // should insert through withUserContext like every other user-owned
  // write in this app." The webhook, by contrast, correctly uses the
  // non-RLS db() connection since a server-to-server notify callback has
  // no app.current_user_id to set.
  try {
    await withUserContext(userId, (sqlClient) =>
      sqlClient`
        INSERT INTO newebpay_pending_orders (merchant_order_no, user_id, tier)
        VALUES (${merchantOrderNo}, ${userId}, ${tier})
      `
    );
  } catch (err) {
    console.error("NewebPay checkout: failed to record pending order", err);
    return NextResponse.json(
      { error: "建立訂單失敗，請稍後再試" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    url: order.url,
    postData: order.postData,
    merchantId: order.merchantId,
  });
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";
import { buildCreateMpgOrderRequest } from "@/lib/newebpay-api";
import { TIER_PRICING } from "@/lib/tiers";
import { NextResponse } from "next/server";
import crypto from "crypto";

// 2026-09-05 — checkout-initiation route for 藍新 (NewebPay)'s general
// one-time checkout (幕前支付/MPG), used ONLY for the yearly cadence.
// Sibling to app/api/checkout/newebpay/route.ts (monthly, recurring
// Period API) — see that route's own updated header comment for why
// these are two separate routes rather than one branching on cadence:
// Period and MPG are different NewebPay products with different request
// shapes, and MPG is what actually lets a customer pay via ATM transfer
// or 超商代碼 instead of a card (see lib/newebpay-api.ts's
// buildCreateMpgOrderRequest() for the full reasoning and sourcing).
//
// **The resulting subscription does NOT auto-renew.** This is a single
// upfront payment for one year of access, not a recurring commitment -
// there is nothing for NewebPay to re-charge later, so at
// current_period_end the customer simply reverts to free tier unless
// they buy again. This is a real, deliberate product difference from
// every other checkout path in this app (Paddle and NewebPay-monthly
// both auto-renew) - see app/api/account/route.ts's `autoRenew` field
// and AccountPageClient.tsx for how the account page reflects this.
//
// **Cannot be tested end-to-end yet.** Same blocker as every other
// NewebPay route: NEWEBPAY_MERCHANT_ID/HASH_KEY/HASH_IV are unset, no
// merchant account exists. Fails clearly with 503, not a raw 500 or
// silent no-op.

function generateMerchantOrderNo(): string {
  // Same format as the monthly route's generator (string(30) max,
  // alphanumeric + underscore) but with a distinct "nwy_" prefix so a
  // merchant_order_no's prefix alone tells you which flow created it,
  // useful when reading newebpay_pending_orders/subscriptions rows by
  // eye during debugging - not read/parsed by any code.
  return `nwy_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

const TIER_LABELS: Record<"pro" | "business", string> = {
  // ASCII-only, same reasoning as the monthly route's TIER_LABELS -
  // ItemDesc's charset support for UTF-8 Chinese text was never
  // confirmed, and this text is only ever shown on NewebPay's own hosted
  // page and back-office, not on taiwanleads.com itself.
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
  const cadence = body?.cadence as "yearly" | undefined;

  if (!tier || cadence !== "yearly" || !TIER_PRICING[tier]?.yearly) {
    return NextResponse.json(
      { error: "tier and cadence (yearly) are required" },
      { status: 400 }
    );
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Same guard as the monthly route, same reasoning: this is a
  // new-purchase flow only, not for someone who already has an active
  // subscription (of either kind, either processor).
  const existingRows = await sql`
    SELECT id FROM subscriptions WHERE user_id = ${userId} AND status = 'active'
  `;
  if (existingRows.length > 0) {
    return NextResponse.json(
      { error: "已有進行中的訂閱，請至帳戶設定變更方案" },
      { status: 400 }
    );
  }

  const amt = TIER_PRICING[tier].yearly;
  const merchantOrderNo = generateMerchantOrderNo();

  let order: { url: string; merchantId: string; tradeInfo: string; tradeSha: string; version: string };
  try {
    order = buildCreateMpgOrderRequest({
      merchantOrderNo,
      amt,
      itemDesc: `${TIER_LABELS[tier]} (Yearly, one-time)`,
      payerEmail: session.user.email,
      returnUrl: `${process.env.NEXTAUTH_URL}/account?newebpay=return`,
      notifyUrl: `${process.env.NEXTAUTH_URL}/api/webhooks/newebpay-mpg`,
      clientBackUrl: `${process.env.NEXTAUTH_URL}/pricing`,
    });
  } catch (err) {
    console.error("NewebPay yearly checkout: not configured yet", err);
    return NextResponse.json(
      { error: "NewebPay 尚未設定完成，目前無法使用此付款方式" },
      { status: 503 }
    );
  }

  // Reuses newebpay_pending_orders - same merchant_order_no → user_id/
  // tier bridge role it already plays for monthly orders (see
  // db/schema.sql's comment on that table). The webhook that claims this
  // row (app/api/webhooks/newebpay-mpg/route.ts) is a different route
  // from the one that claims monthly's rows, but the table itself needs
  // no schema change to serve both - it was already generic.
  try {
    await withUserContext(userId, (sqlClient) =>
      sqlClient`
        INSERT INTO newebpay_pending_orders (merchant_order_no, user_id, tier)
        VALUES (${merchantOrderNo}, ${userId}, ${tier})
      `
    );
  } catch (err) {
    console.error("NewebPay yearly checkout: failed to record pending order", err);
    return NextResponse.json(
      { error: "建立訂單失敗，請稍後再試" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    url: order.url,
    merchantId: order.merchantId,
    tradeInfo: order.tradeInfo,
    tradeSha: order.tradeSha,
    version: order.version,
  });
}

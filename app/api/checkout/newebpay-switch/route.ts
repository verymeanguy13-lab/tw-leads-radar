import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";
import { buildCreatePeriodOrderRequest, type PeriodType } from "@/lib/newebpay-api";
import { TIER_PRICING } from "@/lib/tiers";
import { NextResponse } from "next/server";
import crypto from "crypto";

// 2026-09-08 — self-service plan switch (Plan B/pro <-> Plan C/business)
// for an EXISTING monthly NewebPay Period subscriber. Requested after
// the user asked "they can not upgrade by pushing a button?" and
// confirmed she wants that button built, rather than leaving switching
// as an email-support-only path (see app/(marketing)/terms/page.tsx's
// 第五條, which currently says exactly that and should be revisited once
// this ships — not done as part of this change).
//
// Why this can't just be app/api/account/change-plan/route.ts (the
// existing Paddle switch route): that route calls
// changePaddleSubscriptionPrice(), which relies on Paddle's own
// "change the price on an existing subscription, with proration" API.
// NewebPay's Period API has NO equivalent — lib/newebpay-api.ts only
// ever exposed create (a brand-new authorization) and AlterStatus
// (restart/suspend/terminate an existing one, not "change the amount").
// So a NewebPay plan switch is unavoidably: create a brand-new Period
// commitment at the target tier's full price (this route), and only
// once THAT is confirmed paid, terminate the old one
// (app/api/webhooks/newebpay/route.ts, via the supersedes_period_no this
// route records). See architecture.md's 2026-09-08 entry for the full
// design and, importantly, why the termination step lives in the
// webhook and not here: if it happened here instead, a customer who
// abandoned the new checkout (closed the tab on NewebPay's hosted page,
// declined the card prompt, etc.) would be left with the OLD commitment
// already terminated and no new one ever confirmed — zero active
// subscription through no further fault of their own. Terminating only
// after webhook confirmation means an abandoned switch leaves the
// customer exactly where they started: still on their original plan,
// paying its original price, nothing changed.
//
// Consequence worth stating plainly to the customer in the UI, not just
// here: this is a full new charge at the target tier's price, not a
// prorated top-up/credit the way Paddle's switch is — the old
// commitment's remaining paid time is not credited or refunded. Given
// how few subscribers exist at this stage, that tradeoff (simplicity and
// safety over billing elegance) was accepted deliberately rather than
// building proration logic against an untested payment integration.
//
// **Cannot be tested end-to-end yet** — same standing caveat as every
// other NewebPay route in this codebase: no real merchant credentials
// exist, so buildCreatePeriodOrderRequest() below throws (503) until
// NEWEBPAY_MERCHANT_ID/HASH_KEY/HASH_IV are set.

function generateMerchantOrderNo(): string {
  // Same generator/format as app/api/checkout/newebpay/route.ts — see
  // that file's comment for the field-length/charset reasoning.
  return `nwps_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

const TIER_LABELS: Record<"pro" | "business", string> = {
  // ASCII-only, matching app/api/checkout/newebpay/route.ts's own
  // TIER_LABELS for the same "ProdDesc charset unconfirmed" reason.
  pro: "TaiwanLeads Pro Plan",
  business: "TaiwanLeads Business Plan",
};

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const targetTier = body?.targetTier as "pro" | "business" | undefined;
  const businessUseConfirmed = body?.businessUseConfirmed === true;

  if (!targetTier || !TIER_PRICING[targetTier]?.monthly) {
    return NextResponse.json({ error: "targetTier is required" }, { status: 400 });
  }

  // Same server-side enforcement as app/api/checkout/newebpay/route.ts —
  // this is a brand-new payment authorization (see this file's header
  // comment), so the same Terms 第六條 business-use confirmation applies
  // to it exactly as it does to a first-time purchase.
  if (!businessUseConfirmed) {
    return NextResponse.json(
      { error: "請確認本次訂閱之使用目的後再繼續" },
      { status: 400 }
    );
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const subRows = await sql`
    SELECT tier, newebpay_period_no FROM subscriptions
    WHERE user_id = ${userId} AND status = 'active'
      AND (current_period_end IS NULL OR current_period_end >= now())
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const sub = subRows[0] as { tier: string; newebpay_period_no: string | null } | undefined;

  // Only an existing monthly NewebPay Period subscriber can use this
  // route — a Paddle subscriber has app/api/account/change-plan/route.ts
  // for this, and a one-time yearly MPG purchase has no recurring
  // commitment (no newebpay_period_no) for this route to supersede at
  // all. AccountPageClient.tsx only renders this button for
  // processor === "newebpay_period" (see GET /api/account), but this is
  // enforced here too since the client-side gate is not load-bearing.
  if (!sub?.newebpay_period_no) {
    return NextResponse.json(
      { error: "此帳戶無可變更之藍新定期定額訂閱" },
      { status: 400 }
    );
  }

  if (sub.tier === targetTier) {
    return NextResponse.json({ error: "已經是此方案，無需變更" }, { status: 400 });
  }

  // Guards against a double-click (or a reload-and-resubmit) creating a
  // second in-flight switch order for the same old commitment — if both
  // were later confirmed, the webhook would attempt to terminate the old
  // Period commitment twice (harmless — AlterStatus terminate on an
  // already-terminated commitment should just no-op or error, not
  // double-charge) but would leave two new active subscriptions rows
  // fighting over which one is "current." Simpler to just refuse a
  // second attempt while one is already pending.
  const pendingRows = await sql`
    SELECT merchant_order_no FROM newebpay_pending_orders
    WHERE user_id = ${userId} AND claimed_at IS NULL
  `;
  if (pendingRows.length > 0) {
    return NextResponse.json(
      { error: "已有處理中的訂單，請稍候或重新整理頁面後再試" },
      { status: 400 }
    );
  }

  const periodAmt = TIER_PRICING[targetTier].monthly;
  const merchantOrderNo = generateMerchantOrderNo();

  // Same unconfirmed periodPoint convention as the new-purchase route —
  // see that file's comment. Using "today" as the new commitment's
  // monthly billing day, since this is a fresh Period authorization, not
  // a continuation of the old one's billing date.
  const now = new Date();
  const periodType: PeriodType = "M";
  const periodPoint = String(now.getDate()).padStart(2, "0");
  const periodTimes = 99; // see newebpay/route.ts's comment on this cap

  let order: { url: string; postData: string; merchantId: string };
  try {
    order = buildCreatePeriodOrderRequest({
      merchantOrderNo,
      periodAmt,
      periodType,
      periodPoint,
      periodTimes,
      payerEmail: session.user.email,
      prodDesc: `${TIER_LABELS[targetTier]} (Plan Switch)`,
      // 2026-09-12 fix: same "logged out on return" fix as the monthly
      // Period checkout route — see app/api/checkout/newebpay/return/
      // route.ts's header comment.
      returnUrl: `${process.env.NEXTAUTH_URL}/api/checkout/newebpay/return?dest=switch-return`,
      notifyUrl: `${process.env.NEXTAUTH_URL}/api/webhooks/newebpay`,
    });
  } catch (err) {
    console.error("NewebPay plan switch: not configured yet", err);
    return NextResponse.json(
      { error: "NewebPay 尚未設定完成，目前無法使用此功能" },
      { status: 503 }
    );
  }

  try {
    await withUserContext(userId, (sqlClient) =>
      sqlClient`
        INSERT INTO newebpay_pending_orders (
          merchant_order_no, user_id, tier, business_use_confirmed_at, supersedes_period_no
        )
        VALUES (
          ${merchantOrderNo}, ${userId}, ${targetTier}, now(), ${sub.newebpay_period_no}
        )
      `
    );
  } catch (err) {
    console.error("NewebPay plan switch: failed to record pending order", err);
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

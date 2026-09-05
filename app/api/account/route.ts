import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPaddleSubscription } from "@/lib/paddle-api";
import { NextResponse } from "next/server";

// Session 21 — Account & Billing Settings.
// GET /api/account: returns the logged-in user's current plan, renewal
// info, and a payment-method-update link. Cancellation is a separate
// POST /api/account/cancel (see that route) rather than a link returned
// here, since we call Paddle's cancel API directly with an explicit
// effective_from rather than relying on the hosted portal's default —
// see lib/paddle-api.ts's comment on cancelPaddleSubscription().
//
// 2026-09-05: also recognizes newebpay_period_no, added once
// app/(marketing)/pricing/page.tsx's checkout button was switched from
// Paddle to NewebPay. Before this change, the `if (!sub ||
// !sub.paddle_subscription_id)` check below meant a NewebPay-based
// subscriber would show up here as plain free tier with no way to see
// their plan or cancel it — a real gap, since the only reachable
// checkout on the site now leads to a NewebPay subscription, not a
// Paddle one. There is no NewebPay equivalent of getPaddleSubscription()
// (no live-status read endpoint exists — only period creation and
// status-alteration are built in lib/newebpay-api.ts), so a NewebPay row
// is always served straight from this app's own database rather than a
// live upstream call; `updatePaymentMethodUrl` is always null for it (no
// NewebPay feature exists for that), and `scheduledCancellation` reads
// `canceled_at` (see db/schema.sql's comment on that column) since
// there's no live "is this pending cancellation" read to check instead.
//
// 2026-09-05, same day, continued: also recognizes a subscription with
// `newebpay_merchant_order_no` set but NO `newebpay_period_no` — a
// one-time yearly purchase via the new MPG checkout
// (app/api/checkout/newebpay-yearly/route.ts), which has no recurring
// commitment at all, so there's no ID to store in `newebpay_period_no`.
// Without this, the same class of bug this whole comment already
// describes would have recurred for yearly buyers specifically: the `if
// (!sub || (!sub.paddle_subscription_id && !sub.newebpay_period_no))`
// check would treat them as free tier. Added a new `autoRenew` field to
// the response (false only for this one-time case) so the account page
// can show "有效至 [date]，不會自動續約" instead of a cancel button that
// doesn't apply — there's no recurring charge to cancel.

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2026-09-05: the two DB queries below (and everything derived from
  // them) are now wrapped in a top-level try/catch that didn't exist
  // before. Found live on taiwanleads.com: this route was returning a
  // bare HTTP 500 with a COMPLETELY EMPTY body - no JSON, no message -
  // which is what Next.js/Vercel does for an uncaught exception in a
  // route handler in production (it strips the real error before it
  // reaches the client, for good reason, but that also means there was
  // no way to tell what broke without digging through Vercel's own
  // function logs). Wrapping this means: (a) the account page gets an
  // actual JSON error it can show instead of silently failing to parse
  // an empty body, and (b) the real error still reaches Vercel's logs
  // via console.error, same as the existing Paddle-specific catch below
  // already does - this just extends that same discipline to the
  // queries that didn't have it. Does not change behavior for the
  // success path at all.
  try {
    const sql = db();
    // 2026-09-03: also select vat_id so the account page can show/edit the
    // saved 統一編號 alongside billing info — see app/api/account/vat-id/
    // route.ts for the save endpoint and its comment for why this is
    // capture-and-store only, not wired into checkout.
    const userRows = await sql`SELECT id, vat_id FROM users WHERE email = ${session.user.email}`;
    const userId = userRows[0]?.id as string | undefined;
    const vatId = (userRows[0]?.vat_id as string | null) ?? null;
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const subRows = await sql`
      SELECT tier, status, paddle_subscription_id, newebpay_period_no,
             newebpay_merchant_order_no, canceled_at, current_period_end
      FROM subscriptions
      WHERE user_id = ${userId} AND status = 'active'
        AND (current_period_end IS NULL OR current_period_end >= now())
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const sub = subRows[0] as
      | {
          tier: string;
          status: string;
          paddle_subscription_id: string | null;
          newebpay_period_no: string | null;
          newebpay_merchant_order_no: string | null;
          canceled_at: string | null;
          current_period_end: string | null;
        }
      | undefined;

    const hasAnyProcessorId =
      sub && (sub.paddle_subscription_id || sub.newebpay_period_no || sub.newebpay_merchant_order_no);

    if (!sub || !hasAnyProcessorId) {
      // No active (and not-yet-expired — see the current_period_end guard
      // above, matching lib/tiers.ts's getUserTier()) subscription with a
      // real processor ID attached — free tier, nothing to manage.
      return NextResponse.json({
        tier: "free",
        status: null,
        currentPeriodEnd: null,
        scheduledCancellation: false,
        autoRenew: false,
        updatePaymentMethodUrl: null,
        vatId,
      });
    }

    if (sub.newebpay_period_no) {
      return NextResponse.json({
        tier: sub.tier,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
        scheduledCancellation: sub.canceled_at !== null,
        autoRenew: true,
        updatePaymentMethodUrl: null,
        vatId,
      });
    }

    if (sub.newebpay_merchant_order_no) {
      // One-time yearly purchase (MPG checkout, no recurring commitment) -
      // see this file's header comment. autoRenew: false is what tells the
      // account page to show an expiry date instead of a cancel button.
      return NextResponse.json({
        tier: sub.tier,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
        scheduledCancellation: false,
        autoRenew: false,
        updatePaymentMethodUrl: null,
        vatId,
      });
    }

    try {
      const paddleSub = await getPaddleSubscription(sub.paddle_subscription_id!);
      return NextResponse.json({
        tier: sub.tier,
        status: sub.status,
        currentPeriodEnd:
          paddleSub.current_billing_period?.ends_at ?? sub.current_period_end,
        scheduledCancellation: paddleSub.scheduled_change?.action === "cancel",
        autoRenew: true,
        updatePaymentMethodUrl: paddleSub.management_urls?.update_payment_method ?? null,
        vatId,
      });
    } catch (err) {
      console.error("Failed to fetch Paddle subscription:", err);
      // Fall back to our own database's view rather than failing the
      // whole page — the person can still see their tier even if Paddle's
      // API is temporarily unreachable, just without the live payment
      // link or scheduled-cancellation status.
      return NextResponse.json({
        tier: sub.tier,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
        scheduledCancellation: false,
        autoRenew: true,
        updatePaymentMethodUrl: null,
        paddleUnreachable: true,
        vatId,
      });
    }
  } catch (err) {
    console.error("GET /api/account failed:", err);
    return NextResponse.json(
      { error: "無法載入帳戶資訊，請稍後再試" },
      { status: 500 }
    );
  }
}

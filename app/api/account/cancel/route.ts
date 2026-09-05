import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { cancelPaddleSubscription } from "@/lib/paddle-api";
import { alterNewebpayPeriodStatus } from "@/lib/newebpay-api";
import { NextResponse } from "next/server";

// Session 21 — Account & Billing Settings.
// POST /api/account/cancel: cancels the logged-in user's active
// subscription, effective at the end of the current billing period
// (2026-08-24/25 decision — they keep access and we keep the payment
// for the period already paid for, matching standard SaaS practice).
//
// Does NOT update the local `subscriptions` row's status directly for
// either processor — each processor's own webhook/notify handler is the
// single source of truth for that, same as every other subscription-
// state change in this app:
// - Paddle: verified against the actual webhook handler
//   (app/api/webhooks/paddle/route.ts): resolveStatus() reads only
//   Paddle's `data.status` field, which stays "active" throughout the
//   cancel-at-period-end grace window (Paddle tracks the pending
//   cancellation separately via scheduled_change, which the handler
//   doesn't even check) — so this app's own access control correctly
//   keeps working until the real subscription.canceled event fires at
//   the actual period end.
// - NewebPay (2026-09-05, added once app/(marketing)/pricing/page.tsx's
//   checkout button was switched from Paddle to NewebPay — see that
//   file's own comment): alterNewebpayPeriodStatus() stops future
//   billing but there is no NewebPay-side event that will ever flip
//   this row's status the way Paddle's subscription.canceled does — see
//   lib/tiers.ts's getUserTier(), which now checks current_period_end
//   instead of relying on that, for both processors.
//
// A subscription row has at most one of paddle_subscription_id /
// newebpay_period_no set — each processor's own webhook only ever
// populates its own column — so which one is present determines which
// API this calls.
//
// 2026-09-05, continued: also handles a row with `newebpay_merchant_
// order_no` set but neither of the above — a one-time yearly purchase
// via the MPG checkout (app/api/checkout/newebpay-yearly/route.ts).
// There is no recurring commitment there at all, so "cancel" has nothing
// to actually stop; AccountPageClient.tsx hides the cancel button for
// this case (driven by GET /api/account's `autoRenew: false`), but this
// route still handles it explicitly rather than falling through to the
// generic "No active subscription" error, which would be actively wrong
// — they do have an active subscription, it just isn't cancelable in
// the future-billing sense.

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2026-09-05: wrapped the rest of this route in a top-level try/catch,
  // matching the same fix just made to GET /api/account (see that
  // route's own comment on why) — the two queries below were previously
  // unguarded, so a failure in either (a missing column, an RLS issue,
  // anything) would have crashed with the same opaque, empty-body 500
  // Next.js/Vercel returns for an uncaught exception in production,
  // instead of a real JSON error. The three try/catch blocks already
  // below this (NewebPay AlterStatus, Paddle cancel) are unchanged —
  // this just extends the same safety net to what wasn't covered.
  try {
    const sql = db();
    const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
    const userId = userRows[0]?.id as string | undefined;
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const subRows = await sql`
      SELECT paddle_subscription_id, newebpay_period_no, newebpay_merchant_order_no
      FROM subscriptions
      WHERE user_id = ${userId} AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const sub = subRows[0] as
      | {
          paddle_subscription_id: string | null;
          newebpay_period_no: string | null;
          newebpay_merchant_order_no: string | null;
        }
      | undefined;

    const hasAnyProcessorId =
      sub && (sub.paddle_subscription_id || sub.newebpay_period_no || sub.newebpay_merchant_order_no);

    if (!sub || !hasAnyProcessorId) {
      return NextResponse.json(
        { error: "No active subscription to cancel" },
        { status: 400 }
      );
    }

    if (!sub.paddle_subscription_id && !sub.newebpay_period_no && sub.newebpay_merchant_order_no) {
      return NextResponse.json(
        {
          error:
            "此訂閱為年繳一次性付款，無自動續約機制，故無需取消；服務將持續至已付費期間結束後自動停止。",
        },
        { status: 400 }
      );
    }

    if (sub.newebpay_period_no) {
      try {
        const result = await alterNewebpayPeriodStatus(sub.newebpay_period_no, "terminate");
        if (!result.success) {
          console.error("NewebPay AlterStatus returned non-success:", result);
          return NextResponse.json(
            { error: "Cancellation failed — please try again or contact support" },
            { status: 502 }
          );
        }
        // No `scheduled_change`-style object comes back from NewebPay the
        // way Paddle's cancel response has one, and there's no live read
        // to check "is a cancellation already pending" later either — so
        // `canceled_at` is set here as this app's own record of that,
        // read back by GET /api/account (see db/schema.sql's comment on
        // this column). `effectiveAt` is read from `current_period_end`
        // (already correct, set by the last successful-charge notify),
        // not touched by this UPDATE, so the account page can display the
        // same "服務將持續至" date it already shows for Paddle.
        const periodRows = await sql`
          UPDATE subscriptions
          SET canceled_at = now()
          WHERE newebpay_period_no = ${sub.newebpay_period_no}
          RETURNING current_period_end
        `;
        return NextResponse.json({
          success: true,
          scheduledCancellation: true,
          effectiveAt: periodRows[0]?.current_period_end ?? null,
        });
      } catch (err) {
        console.error("Failed to cancel NewebPay subscription:", err);
        return NextResponse.json(
          { error: "Cancellation failed — please try again or contact support" },
          { status: 502 }
        );
      }
    }

    try {
      const result = await cancelPaddleSubscription(sub.paddle_subscription_id!);
      return NextResponse.json({
        success: true,
        scheduledCancellation: result.scheduled_change?.action === "cancel",
        effectiveAt: result.scheduled_change?.effective_at ?? null,
      });
    } catch (err) {
      console.error("Failed to cancel Paddle subscription:", err);
      return NextResponse.json(
        { error: "Cancellation failed — please try again or contact support" },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error("POST /api/account/cancel failed:", err);
    return NextResponse.json(
      { error: "Cancellation failed — please try again or contact support" },
      { status: 500 }
    );
  }
}

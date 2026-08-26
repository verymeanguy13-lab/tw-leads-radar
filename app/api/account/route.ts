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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const subRows = await sql`
    SELECT tier, status, paddle_subscription_id, current_period_end
    FROM subscriptions
    WHERE user_id = ${userId} AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const sub = subRows[0] as
    | {
        tier: string;
        status: string;
        paddle_subscription_id: string | null;
        current_period_end: string | null;
      }
    | undefined;

  if (!sub || !sub.paddle_subscription_id) {
    // No active subscription (or a subscription with no real Paddle ID,
    // e.g. old test data) — free tier, nothing to manage in Paddle.
    return NextResponse.json({
      tier: "free",
      status: null,
      currentPeriodEnd: null,
      scheduledCancellation: false,
      updatePaymentMethodUrl: null,
    });
  }

  try {
    const paddleSub = await getPaddleSubscription(sub.paddle_subscription_id);
    return NextResponse.json({
      tier: sub.tier,
      status: sub.status,
      currentPeriodEnd:
        paddleSub.current_billing_period?.ends_at ?? sub.current_period_end,
      scheduledCancellation: paddleSub.scheduled_change?.action === "cancel",
      updatePaymentMethodUrl: paddleSub.management_urls?.update_payment_method ?? null,
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
      updatePaymentMethodUrl: null,
      paddleUnreachable: true,
    });
  }
}

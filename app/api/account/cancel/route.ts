import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { cancelPaddleSubscription } from "@/lib/paddle-api";
import { NextResponse } from "next/server";

// Session 21 — Account & Billing Settings.
// POST /api/account/cancel: cancels the logged-in user's active
// subscription, effective at the end of the current billing period
// (2026-08-24/25 decision — they keep access and we keep the payment
// for the period already paid for, matching standard SaaS practice).
//
// Does NOT update the local `subscriptions` row's status directly —
// Paddle's own webhook (already built, handling subscription.updated /
// subscription.canceled events) is the single source of truth for that,
// same as every other subscription-state change in this app. Verified
// against the actual webhook handler (app/api/webhooks/paddle/route.ts):
// resolveStatus() reads only Paddle's `data.status` field, which stays
// "active" throughout the cancel-at-period-end grace window (Paddle
// tracks the pending cancellation separately via scheduled_change,
// which the handler doesn't even check) — so this app's own access
// control correctly keeps working until the real subscription.canceled
// event fires at the actual period end. No webhook changes needed.

export async function POST() {
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
    SELECT paddle_subscription_id FROM subscriptions
    WHERE user_id = ${userId} AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const paddleSubscriptionId = subRows[0]?.paddle_subscription_id as string | undefined;

  if (!paddleSubscriptionId) {
    return NextResponse.json(
      { error: "No active subscription to cancel" },
      { status: 400 }
    );
  }

  try {
    const result = await cancelPaddleSubscription(paddleSubscriptionId);
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
}

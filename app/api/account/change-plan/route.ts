import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { changePaddleSubscriptionPrice } from "@/lib/paddle-api";
import { NextResponse } from "next/server";

// Session 21 — Account & Billing Settings.
// POST /api/account/change-plan: switches an EXISTING subscriber
// between pro/business and/or monthly/yearly. This is for changing an
// active subscription only — going from free to a paid tier is a NEW
// purchase and goes through components/CheckoutButton.tsx's
// Paddle.Checkout.open() flow instead, not this route.
//
// Price ID -> tier mapping matches app/api/webhooks/paddle/route.ts's
// PRICE_TIER_MAP exactly, so the webhook correctly resolves the new
// tier when Paddle sends subscription.updated after this call.
//
// Proration: upgrading (pro -> business) charges the prorated
// difference immediately, matching "you're getting more value now, pay
// for it now." Downgrading (business -> pro) waits until the next
// billing period instead, avoiding mid-cycle refund/credit complexity
// for a case where the person is paying less, not more. A same-tier
// cadence switch (monthly <-> yearly) is treated as immediate since
// it's not really an upgrade or downgrade in value terms either way.

const TIER_RANK: Record<"pro" | "business", number> = { pro: 1, business: 2 };

function resolvePriceId(targetTier: "pro" | "business", cadence: "monthly" | "yearly"): string | undefined {
  const envVar =
    targetTier === "pro"
      ? cadence === "monthly"
        ? "NEXT_PUBLIC_PADDLE_PRICE_B_MONTHLY"
        : "NEXT_PUBLIC_PADDLE_PRICE_B_YEARLY"
      : cadence === "monthly"
      ? "NEXT_PUBLIC_PADDLE_PRICE_C_MONTHLY"
      : "NEXT_PUBLIC_PADDLE_PRICE_C_YEARLY";
  return process.env[envVar];
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const targetTier = body?.targetTier as "pro" | "business" | undefined;
  const cadence = body?.cadence as "monthly" | "yearly" | undefined;

  if (!targetTier || !cadence || !TIER_RANK[targetTier]) {
    return NextResponse.json({ error: "targetTier and cadence are required" }, { status: 400 });
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const subRows = await sql`
    SELECT tier, paddle_subscription_id FROM subscriptions
    WHERE user_id = ${userId} AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const sub = subRows[0] as { tier: string; paddle_subscription_id: string | null } | undefined;

  if (!sub?.paddle_subscription_id || !(sub.tier === "pro" || sub.tier === "business")) {
    return NextResponse.json(
      { error: "No active paid subscription to change — use checkout to subscribe first" },
      { status: 400 }
    );
  }

  const newPriceId = resolvePriceId(targetTier, cadence);
  if (!newPriceId) {
    return NextResponse.json(
      { error: `Missing price ID env var for ${targetTier}/${cadence}` },
      { status: 500 }
    );
  }

  const isDowngrade = TIER_RANK[targetTier] < TIER_RANK[sub.tier as "pro" | "business"];
  const prorationBillingMode = isDowngrade ? "next_billing_period" : "prorated_immediately";

  try {
    await changePaddleSubscriptionPrice(sub.paddle_subscription_id, newPriceId, prorationBillingMode);
    return NextResponse.json({ success: true, prorationBillingMode });
  } catch (err) {
    console.error("Failed to change Paddle subscription price:", err);
    return NextResponse.json(
      { error: "Plan change failed — please try again or contact support" },
      { status: 502 }
    );
  }
}

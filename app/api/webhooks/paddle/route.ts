import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";

// Paddle's own SDKs default to a 5-second timestamp tolerance, but that's
// tight enough to false-reject legitimate webhooks over ordinary network
// or clock-skew delay. The HMAC match is the real security guarantee here;
// this timestamp check is defense-in-depth against replay, not the primary
// check - 5 minutes is a safer margin (matches common practice elsewhere,
// e.g. Stripe's own default).
const TIMESTAMP_TOLERANCE_SECONDS = 300;

const PRICE_TIER_MAP: Record<string, "pro" | "business"> = {};
if (process.env.NEXT_PUBLIC_PADDLE_PRICE_B_MONTHLY) {
  PRICE_TIER_MAP[process.env.NEXT_PUBLIC_PADDLE_PRICE_B_MONTHLY] = "pro";
}
if (process.env.NEXT_PUBLIC_PADDLE_PRICE_B_YEARLY) {
  PRICE_TIER_MAP[process.env.NEXT_PUBLIC_PADDLE_PRICE_B_YEARLY] = "pro";
}
if (process.env.NEXT_PUBLIC_PADDLE_PRICE_C_MONTHLY) {
  PRICE_TIER_MAP[process.env.NEXT_PUBLIC_PADDLE_PRICE_C_MONTHLY] = "business";
}
if (process.env.NEXT_PUBLIC_PADDLE_PRICE_C_YEARLY) {
  PRICE_TIER_MAP[process.env.NEXT_PUBLIC_PADDLE_PRICE_C_YEARLY] = "business";
}

function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const match = signatureHeader.match(/^ts=(\d+);h1=([0-9a-f]+)$/);
  if (!match) return false;
  const [, ts, h1] = match;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(ts));
  if (ageSeconds > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const signedPayload = `${ts}:${rawBody}`;
  const expectedHex = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  const expectedBuf = Buffer.from(expectedHex, "hex");
  const actualBuf = Buffer.from(h1, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function resolveTier(items: { price?: { id?: string } }[] | undefined): "pro" | "business" | null {
  if (!items) return null;
  for (const item of items) {
    const priceId = item.price?.id;
    if (priceId && PRICE_TIER_MAP[priceId]) return PRICE_TIER_MAP[priceId];
  }
  return null;
}

function resolveStatus(paddleStatus: string): "active" | "past_due" | "canceled" | "none" {
  if (paddleStatus === "active" || paddleStatus === "trialing") return "active";
  if (paddleStatus === "past_due") return "past_due";
  if (paddleStatus === "canceled" || paddleStatus === "paused") return "canceled";
  return "none";
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("paddle-signature");
  const secret = process.env.PADDLE_WEBHOOK_SECRET;

  if (!secret) {
    console.error("Paddle webhook: PADDLE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  if (!signatureHeader || !verifySignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event_type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = event.event_type;
  const data = event.data as Record<string, unknown> | undefined;
  if (!eventType || !data) {
    return NextResponse.json({ error: "Missing event_type or data" }, { status: 400 });
  }

  const sql = db();

  try {
    switch (eventType) {
      case "subscription.created":
      case "subscription.activated":
      case "subscription.updated": {
        const customData = data.custom_data as { userId?: string } | null | undefined;
        const userId = customData?.userId;
        if (!userId) {
          console.error(
            `Paddle webhook ${eventType}: no custom_data.userId on subscription ${data.id}`
          );
          break;
        }

        const tier = resolveTier(data.items as { price?: { id?: string } }[] | undefined);
        if (!tier) {
          console.error(
            `Paddle webhook ${eventType}: could not resolve tier from price IDs, subscription ${data.id}`
          );
          break;
        }

        const status = resolveStatus(data.status as string);
        const billingPeriod = data.current_billing_period as { ends_at?: string } | null | undefined;
        const periodEnd = billingPeriod?.ends_at ?? null;

        await sql`
          INSERT INTO subscriptions (
            user_id, paddle_customer_id, paddle_subscription_id, tier, status, current_period_end
          )
          VALUES (
            ${userId}, ${data.customer_id as string}, ${data.id as string}, ${tier}, ${status}, ${periodEnd}
          )
          ON CONFLICT (paddle_subscription_id) DO UPDATE
          SET tier = EXCLUDED.tier,
              status = EXCLUDED.status,
              current_period_end = EXCLUDED.current_period_end,
              paddle_customer_id = EXCLUDED.paddle_customer_id,
              updated_at = now()
        `;
        break;
      }

      case "subscription.canceled": {
        await sql`
          UPDATE subscriptions
          SET status = 'canceled', updated_at = now()
          WHERE paddle_subscription_id = ${data.id as string}
        `;
        break;
      }

      case "transaction.payment_failed": {
        const subscriptionId = data.subscription_id as string | null | undefined;
        if (subscriptionId) {
          await sql`
            UPDATE subscriptions
            SET status = 'past_due', updated_at = now()
            WHERE paddle_subscription_id = ${subscriptionId}
          `;
        }
        break;
      }

      default:
        // Unhandled event type - not an error, just nothing for us to do.
        break;
    }
  } catch (err) {
    console.error("Paddle webhook processing error:", err);
    return NextResponse.json({ error: "Processing error" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
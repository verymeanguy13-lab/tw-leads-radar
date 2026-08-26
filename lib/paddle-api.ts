// Session 21 — Account & Billing Settings.
//
// Server-side Paddle Billing REST API client. This is separate from
// components/CheckoutButton.tsx's client-side Paddle.js usage — that's
// only for NEW purchases (Paddle.Checkout.open()). Managing an EXISTING
// subscription (canceling, changing plan, fetching payment-method links)
// requires calling Paddle's server-side REST API directly with
// PADDLE_API_KEY, a new secret this session introduces.
//
// Setup required before this works: create an API key at
// paddle.com (Developer Tools > Authentication > API keys) with the
// "Customer portal sessions (Write)" permission — without it,
// management_urls on the subscription response comes back null/absent
// rather than an error, which is easy to misread as "not implemented."
//
// Base URL: sandbox-api.paddle.com for testing, api.paddle.com for
// live — selected via the same NEXT_PUBLIC_PADDLE_ENV convention
// components/CheckoutButton.tsx already uses (note: NEXT_PUBLIC_ vars
// are readable server-side too, just also exposed to the client; that's
// fine since "sandbox" vs not isn't sensitive).

const PADDLE_BASE_URL =
  process.env.NEXT_PUBLIC_PADDLE_ENV === "sandbox"
    ? "https://sandbox-api.paddle.com"
    : "https://api.paddle.com";

interface PaddleManagementUrls {
  update_payment_method: string | null;
  cancel: string | null;
}

interface PaddleSubscription {
  id: string;
  status: string;
  current_billing_period: { starts_at: string; ends_at: string } | null;
  scheduled_change: { action: string; effective_at: string } | null;
  management_urls: PaddleManagementUrls | null;
}

async function paddleFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${PADDLE_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

/**
 * Fetches a subscription directly from Paddle (not our own database) so
 * management_urls and scheduled_change are always current, not
 * whatever our local `subscriptions` table last had webhooked to it.
 */
export async function getPaddleSubscription(
  subscriptionId: string
): Promise<PaddleSubscription> {
  const res = await paddleFetch(`/subscriptions/${subscriptionId}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Paddle getSubscription ${res.status}: ${body}`);
  }
  const json = await res.json();
  return json.data as PaddleSubscription;
}

/**
 * Cancels a subscription to take effect at the end of the current
 * billing period, not immediately — the customer keeps access (and we
 * keep the payment) for the period they already paid for, matching
 * this product's chosen cancellation policy (2026-08-24/25 decision).
 * Do not change effective_from to "immediately" without also revisiting
 * that decision and lib/tiers.ts's getUserTier() comment.
 */
export async function cancelPaddleSubscription(
  subscriptionId: string
): Promise<PaddleSubscription> {
  const res = await paddleFetch(`/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ effective_from: "next_billing_period" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Paddle cancelSubscription ${res.status}: ${body}`);
  }
  const json = await res.json();
  return json.data as PaddleSubscription;
}

/**
 * Changes a subscription to a different price (upgrade or downgrade),
 * applying Paddle's own proration. `prorationBillingMode` matters:
 * "prorated_immediately" charges/credits the difference right away and
 * applies the new price now; "next_billing_period" waits until renewal.
 * This project uses immediate proration for upgrades (the person is
 * paying for more value now) — downgrades could reasonably use
 * next_billing_period instead if you want to avoid mid-cycle refund
 * complexity, but this function doesn't decide that; the caller does.
 */
export async function changePaddleSubscriptionPrice(
  subscriptionId: string,
  newPriceId: string,
  prorationBillingMode: "prorated_immediately" | "next_billing_period"
): Promise<PaddleSubscription> {
  const res = await paddleFetch(`/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify({
      items: [{ price_id: newPriceId, quantity: 1 }],
      proration_billing_mode: prorationBillingMode,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Paddle changeSubscriptionPrice ${res.status}: ${body}`);
  }
  const json = await res.json();
  return json.data as PaddleSubscription;
}

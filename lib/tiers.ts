import { db } from "./db";

export type Tier = "free" | "pro" | "business";
export type Cadence = "weekly" | "monthly" | "daily";

interface TierLimits {
  maxSavedSearches: number | null; // null = unlimited
  allowedCadences: Cadence[];
  csvExport: boolean;
}

// 2026-08-30: found that `business` (Plan C, marketed on the pricing
// page as "每日方案" with "每日電子郵件摘要" as its headline feature
// over Plan B) had IDENTICAL allowedCadences to `pro` — no "daily"
// cadence existed anywhere in the stack at all (not in this file, not
// in the DB CHECK constraint, not in the API's VALID_CADENCE, not in
// the search-creation form, not in the digest scheduler's due-date
// logic, and the workflow that actually sends digest emails was
// hardcoded to a weekly-only cron). The two paid tiers were completely
// functionally identical prior to this fix — someone paying for Plan C
// specifically for daily notifications was getting exactly what Plan B
// customers get, with no error or indication anywhere. See
// architecture.md's 2026-08-30 entry for the full fix across every
// layer this touched.
export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { maxSavedSearches: 1, allowedCadences: ["weekly"], csvExport: false },
  pro: { maxSavedSearches: null, allowedCadences: ["weekly", "monthly"], csvExport: true },
  business: { maxSavedSearches: null, allowedCadences: ["weekly", "monthly", "daily"], csvExport: true },
};

// 2026-09-04: plain NT$ amounts for the paid tiers, added for the new
// NewebPay checkout-initiation route (app/api/checkout/newebpay/route.ts)
// — NewebPay's Period API needs a real TWD amount up front, unlike
// Paddle, which only ever needed an opaque price ID configured in
// Paddle's own dashboard. There was no single source of truth for these
// amounts before now; they're copied from the display copy hard-coded in
// app/(marketing)/pricing/page.tsx ("方案B"/NT$600/NT$6,000, "方案C"/
// NT$1,300/NT$13,000). **This is a second place these numbers now live —
// if pricing ever changes, this map must be updated by hand too**, the
// same kind of two-places-to-update risk this file's own 2026-08-30
// cadence-bug comment above already warns about.
export const TIER_PRICING: Record<"pro" | "business", Record<"monthly" | "yearly", number>> = {
  pro: { monthly: 600, yearly: 6000 },
  business: { monthly: 1300, yearly: 13000 },
};

/**
 * Resolves a user's current tier from their subscription. Only an
 * `active` subscription grants paid-tier benefits - past_due, canceled,
 * or no subscription row at all (a brand-new signup) all fall back to
 * free. This means access is lost immediately on cancellation, not at
 * the end of the already-paid period - a deliberate simplification, not
 * an oversight; revisit if a grace period is ever wanted.
 */
export async function getUserTier(userId: string): Promise<Tier> {
  const sql = db();
  const rows = await sql`
    SELECT tier FROM subscriptions
    WHERE user_id = ${userId} AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const tier = rows[0]?.tier as string | undefined;
  if (tier === "pro" || tier === "business") return tier;
  return "free";
}

export async function canCreateSavedSearch(
  userId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const tier = await getUserTier(userId);
  const limit = TIER_LIMITS[tier].maxSavedSearches;
  if (limit === null) return { allowed: true };

  const sql = db();
  const rows = await sql`
    SELECT COUNT(*) AS count FROM saved_searches WHERE user_id = ${userId}
  `;
  const count = Number(rows[0]?.count ?? 0);

  if (count >= limit) {
    return {
      allowed: false,
      reason: `免費方案最多可建立 ${limit} 組儲存搜尋條件，請升級方案以新增更多。`,
    };
  }
  return { allowed: true };
}

export function isCadenceAllowed(tier: Tier, cadence: string): boolean {
  return (TIER_LIMITS[tier].allowedCadences as string[]).includes(cadence);
}

/**
 * Not wired into any route yet - CSV export itself doesn't exist until
 * Session 20. Exported now, ready to call, so Session 20 gates its
 * export endpoint from day one instead of shipping ungated and needing
 * a follow-up fix.
 */
export async function canExportCsv(userId: string): Promise<boolean> {
  const tier = await getUserTier(userId);
  return TIER_LIMITS[tier].csvExport;
}
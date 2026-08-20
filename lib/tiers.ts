import { db } from "./db";

export type Tier = "free" | "pro" | "business";
export type Cadence = "weekly" | "monthly";

interface TierLimits {
  maxSavedSearches: number | null; // null = unlimited
  allowedCadences: Cadence[];
  csvExport: boolean;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { maxSavedSearches: 1, allowedCadences: ["weekly"], csvExport: false },
  pro: { maxSavedSearches: null, allowedCadences: ["weekly", "monthly"], csvExport: true },
  business: { maxSavedSearches: null, allowedCadences: ["weekly", "monthly"], csvExport: true },
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
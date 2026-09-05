"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 2026-09-05 - lets a logged-in visitor turn the filters they just ran
// on the public /search page into a real monitored saved_search, with
// one click, without re-entering anything on /searches/new. Mirrors
// RunNowButton.tsx's fetch + inline-message pattern.
//
// Always saves with cadence: "monthly" - the one cadence every tier
// (free, pro, business) is allowed to use (see lib/tiers.ts's
// TIER_LIMITS), so this button never needs to know the caller's tier or
// branch on it. A pro/business user who specifically wants weekly or
// daily instead can still use the full /searches/new form - this button
// is deliberately the "just get me notified monthly" shortcut, matching
// what free tier actually gets (see architecture.md's 2026-09-05 entry
// on the free-tier cadence policy).
export interface SaveSearchFilters {
  name: string;
  industry_codes: string[];
  regions: string[];
  capital_min: number | null;
  capital_max: number | null;
  entity_type: "company" | "business" | "both";
  keyword: string;
}

export default function SaveSearchButton({ filters }: { filters: SaveSearchFilters }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...filters, cadence: "monthly" }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(
          data.errors?._general ?? data.errors?.cadence ?? data.errors?.name ?? "儲存失敗，請稍後再試。"
        );
        setSaving(false);
        return;
      }

      router.push(`/searches/${data.id}`);
    } catch {
      setError("儲存失敗，請稍後再試。");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={saving}
        className="px-4 py-2 rounded text-white text-sm disabled:opacity-50 w-fit"
        style={{ backgroundColor: "var(--accent)" }}
      >
        {saving ? "儲存中…" : "儲存此搜尋條件，每月通知我"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

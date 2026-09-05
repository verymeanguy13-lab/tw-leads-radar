"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Session 25 - per-row do_not_contact toggle on /admin/prospects.
// Mirrors RemovalRequestActions.tsx's fetch + router.refresh() pattern.
// This sets a suppression flag, not a delete (Session 25 Step 5) - a
// later re-scrape must not silently resurrect an excluded contact, see
// lib/prospecting/upsert.ts.
export default function ProspectDoNotContactToggle({
  contactId,
  doNotContact,
}: {
  contactId: string;
  doNotContact: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/prospects/${contactId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ do_not_contact: !doNotContact }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "操作失敗，請稍後再試。");
        setBusy(false);
        return;
      }

      router.refresh();
    } catch {
      setError("系統暫時無法連線，請稍後再試。");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={toggle}
        disabled={busy}
        className="px-3 py-1 rounded text-xs border disabled:opacity-50"
        style={{ borderColor: "var(--border)" }}
      >
        {doNotContact ? "取消排除" : "標記排除"}
      </button>
      {error && <span className="text-xs status-dissolved">{error}</span>}
    </div>
  );
}

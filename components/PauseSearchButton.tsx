"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 2026-09-04: the `paused` column has existed since Session 15, but
// there was never a way for a user to actually flip it in either
// direction - see the PATCH handler this calls (app/api/searches/[id]/
// route.ts) for the backstory. This is the missing UI half: a single
// toggle button that reads its own label from the search's current
// paused state, same disabled-while-in-flight / inline-message pattern
// as RunNowButton.tsx and DeleteSearchButton.tsx.
export default function PauseSearchButton({
  searchId,
  paused,
}: {
  searchId: string;
  paused: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/searches/${searchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !paused }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "操作失敗，請稍後再試。");
        return;
      }

      router.refresh();
    } catch {
      setError("操作失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={handleClick}
        disabled={submitting}
        className="px-4 py-2 rounded text-sm border disabled:opacity-50"
        style={{ borderColor: "var(--border)" }}
      >
        {submitting ? "處理中…" : paused ? "恢復搜尋" : "暫停搜尋"}
      </button>
      {error && <span className="text-sm text-secondary">{error}</span>}
    </div>
  );
}

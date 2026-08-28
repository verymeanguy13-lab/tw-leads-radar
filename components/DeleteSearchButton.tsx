"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// No delete functionality existed anywhere before this - see
// app/api/searches/[id]/route.ts's DELETE handler for the API side.
// window.confirm() is deliberately used here rather than a custom
// modal: this is the only destructive action in the app, and matching
// the existing minimal-dependency style (no modal library used
// anywhere else in components/) outweighs the UX polish of a custom
// confirm dialog for a single button.
export default function DeleteSearchButton({
  searchId,
  searchName,
}: {
  searchId: string;
  searchName: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const confirmed = window.confirm(
      `確定要刪除「${searchName}」這組搜尋條件嗎？此操作無法復原。`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/searches/${searchId}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "刪除失敗，請稍後再試。");
        setDeleting(false);
        return;
      }

      router.push("/searches");
      router.refresh();
    } catch {
      setError("刪除失敗，請稍後再試。");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={handleClick}
        disabled={deleting}
        className="px-4 py-2 rounded text-sm border disabled:opacity-50"
        style={{ borderColor: "var(--border)", color: "#b91c1c" }}
      >
        {deleting ? "刪除中…" : "刪除搜尋條件"}
      </button>
      {error && <span className="text-sm text-secondary">{error}</span>}
    </div>
  );
}

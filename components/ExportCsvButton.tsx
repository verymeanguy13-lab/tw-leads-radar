"use client";

import { useState } from "react";

// Session 20 — CSV Export button. Mirrors RunNowButton.tsx's fetch +
// loading/message pattern for consistency. Uses fetch (not a plain <a
// href>) so a 403 from the free-tier gate shows a readable Chinese
// message instead of navigating to raw JSON.
export default function ExportCsvButton({ searchId }: { searchId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/searches/${searchId}/export`);

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setMessage(data?.error ?? "匯出失敗，請稍後再試。");
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : "export.csv";

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setMessage("匯出失敗，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={handleClick}
        disabled={loading}
        className="px-4 py-2 rounded text-sm border border-default disabled:opacity-50"
      >
        {loading ? "匯出中…" : "匯出 CSV"}
      </button>
      {message && <span className="text-sm text-secondary">{message}</span>}
    </div>
  );
}

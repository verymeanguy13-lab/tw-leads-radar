"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RunNowButton({ searchId }: { searchId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setRunning(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/searches/${searchId}/run`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error ?? "執行失敗，請稍後再試。");
      } else {
        setMessage(
          data.newMatches > 0
            ? `已找到 ${data.newMatches} 筆新符合結果。`
            : "已重新執行，沒有新的符合結果。"
        );
        router.refresh();
      }
    } catch {
      setMessage("執行失敗，請稍後再試。");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={handleClick}
        disabled={running}
        className="px-4 py-2 rounded text-white text-sm disabled:opacity-50"
        style={{ backgroundColor: "var(--accent)" }}
      >
        {running ? "執行中…" : "立即執行"}
      </button>
      {message && <span className="text-sm text-secondary">{message}</span>}
    </div>
  );
}

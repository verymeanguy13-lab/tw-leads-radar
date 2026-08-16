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
        setMessage(data.error ?? "?瑁?憭望?嚗?蝔??岫??);
      } else {
        setMessage(
          data.newMatches > 0
            ? `撌脫??${data.newMatches} 蝑蝚血?蝯??
            : "撌脤??啣銵?瘝??啁?蝚血?蝯???
        );
        router.refresh();
      }
    } catch {
      setMessage("?瑁?憭望?嚗?蝔??岫??);
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
        {running ? "?瑁?銝凌? : "蝡?瑁?"}
      </button>
      {message && <span className="text-sm text-secondary">{message}</span>}
    </div>
  );
}

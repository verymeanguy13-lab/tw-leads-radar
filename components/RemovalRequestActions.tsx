"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RemovalRequestActions({
  requestId,
  submittedUniformId,
}: {
  requestId: string;
  submittedUniformId: string | null;
}) {
  const router = useRouter();
  const [uniformId, setUniformId] = useState(submittedUniformId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/data-removal-requests/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { action, confirmedUniformId: uniformId.trim() } : { action }
        ),
      });

      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        throw new Error("non-json-response");
      }

      if (!res.ok) {
        setError(data.error ?? "操作失敗，請稍後再試。");
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
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={uniformId}
        onChange={(e) => setUniformId(e.target.value)}
        placeholder="確認統一編號（8碼）"
        maxLength={8}
        className="border rounded px-2 py-1 text-sm w-40"
        style={{ borderColor: "var(--border)" }}
      />
      <div className="flex gap-2">
        <button
          onClick={() => act("approve")}
          disabled={busy}
          className="px-3 py-1 rounded text-xs text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--accent)" }}
        >
          核准並隱藏
        </button>
        <button
          onClick={() => act("reject")}
          disabled={busy}
          className="px-3 py-1 rounded text-xs border disabled:opacity-50"
          style={{ borderColor: "var(--border)" }}
        >
          駁回
        </button>
      </div>
      {error && <span className="text-xs status-dissolved">{error}</span>}
    </div>
  );
}

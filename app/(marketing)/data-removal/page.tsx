"use client";
import { useState } from "react";

// Public PDPA data-removal request form — see db/schema.sql's
// 2026-08-28 comment on data_removal_requests for the full rationale.
// No login required: the business owner requesting removal is very
// likely not a registered user of this service at all.
//
// Error handling here is deliberately more defensive than the older
// signup form's pattern (fetch -> res.json() with no try/catch): a
// removal request silently failing during a Vercel/Neon blip and
// looking like it succeeded would be a real problem for someone
// specifically trying to exercise a legal right, not just a UX
// annoyance. Network failures (fetch itself throwing, e.g. because
// Vercel or the browser's connection dropped) and non-JSON error
// responses (e.g. a raw 502/503 HTML page from an upstream outage,
// which .json() would throw trying to parse) are both caught
// explicitly and shown as the same honest "something went wrong,
// please try again or email us directly" message, rather than either
// crashing or silently reporting success.
export default function DataRemovalPage() {
  const [uniformId, setUniformId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/data-removal-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uniformId: uniformId.trim() || null,
          companyName: companyName.trim(),
          email: email.trim(),
          reason: reason.trim() || null,
        }),
      });

      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        // Response wasn't valid JSON at all — most likely an upstream
        // outage (Vercel/Neon) returning a raw error page instead of
        // our API's normal JSON response. Treat the same as a network
        // failure below rather than crashing on the parse itself.
        throw new Error("non-json-response");
      }

      if (!res.ok) {
        setError(data.error ?? "提交失敗，請稍後再試，或直接寄信至 shihjungching@gmail.com。");
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
    } catch {
      // Covers both fetch() itself throwing (network/connectivity
      // failure) and the non-JSON-response case thrown above.
      setError(
        "目前無法送出請求，可能是系統暫時無法連線。請稍後再試，或直接寄信至 shihjungching@gmail.com，我們會盡快處理。"
      );
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="px-8 py-16 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">請求已送出</h1>
        <p className="text-secondary">
          {"感謝您的請求，我們將於審核後處理，並可能透過您留下的電子郵件與您聯繫確認。"}
        </p>
      </div>
    );
  }

  return (
    <div className="px-8 py-16 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">資料移除請求</h1>
      <p className="text-secondary mb-8">
        {"若您是本服務所列公司登記資料中的負責人，且不希望您的公司資訊出現於本服務的搜尋結果與通知信中，可透過以下表單提出移除請求。我們將審核後儘速處理。"}
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            {"統一編號（選填，若知道請填寫以加快審核）"}
          </label>
          <input
            type="text"
            value={uniformId}
            onChange={(e) => setUniformId(e.target.value)}
            maxLength={8}
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: "var(--border)" }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">{"公司名稱（必填）"}</label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: "var(--border)" }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">{"您的聯絡電子郵件（必填）"}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: "var(--border)" }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">{"備註（選填）"}</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full border rounded px-3 py-2"
            style={{ borderColor: "var(--border)" }}
          />
        </div>

        {error && <p className="text-sm status-dissolved">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded text-white text-sm disabled:opacity-50 self-start"
          style={{ backgroundColor: "var(--accent)" }}
        >
          {submitting ? "送出中…" : "送出請求"}
        </button>
      </form>
    </div>
  );
}

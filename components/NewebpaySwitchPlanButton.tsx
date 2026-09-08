"use client";
import { useRef, useState } from "react";

// 2026-09-08 — self-service plan switch for an existing monthly
// NewebPay Period subscriber, requested after the user asked "they can
// not upgrade by pushing a button?" about the account page. Structured
// to match NewebpayCheckoutButton.tsx's loading/processingRef/
// buildFormAndSubmit pattern (same reasoning: NewebPay has no
// client-side checkout overlay, so completing this still means a real
// top-level browser form POST to NewebPay's hosted page), but simpler in
// two ways that component isn't: no signed-out branch (this only ever
// renders for an existing subscriber on /account, already signed in by
// definition), and no monthly/yearly choice (a Period switch is always
// monthly — see app/api/checkout/newebpay-switch/route.ts's header
// comment for why yearly/MPG subscribers can't use this route at all).
//
// Disclosure copy below is deliberately explicit about the "full new
// charge, no proration" consequence — see that same route's comment for
// why this codebase chose that over building proration against an
// untested payment integration. This is not a detail to bury in fine
// print given it's a real, immediate charge to a real card.

function buildFormAndSubmit(url: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

const TARGET_LABELS: Record<"pro" | "business", string> = {
  pro: "方案 B",
  business: "方案 C",
};

export default function NewebpaySwitchPlanButton({
  targetTier,
  direction,
}: {
  targetTier: "pro" | "business";
  /** Only changes the button's own label/copy ("升級"/"降級") — the
   * request and backend behavior are identical either way. */
  direction: "upgrade" | "downgrade";
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessUseConfirmed, setBusinessUseConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Same ref-not-state reasoning as NewebpayCheckoutButton.tsx.
  const processingRef = useRef(false);

  async function handleConfirm() {
    if (processingRef.current || !businessUseConfirmed) return;
    processingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/checkout/newebpay-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTier, businessUseConfirmed }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.url || !data?.postData || !data?.merchantId) {
        // Matches NewebpayCheckoutButton.tsx's 2026-09-05 fix — reset so
        // the person can actually retry instead of the button getting
        // stuck on "處理中…" forever.
        setError(data?.error ?? "無法建立訂單，請稍後再試");
        processingRef.current = false;
        setLoading(false);
        return;
      }

      buildFormAndSubmit(data.url, {
        MerchantID: data.merchantId,
        PostData_: data.postData,
      });
      // No reset on the success path — the tab is about to navigate away
      // to NewebPay, same as NewebpayCheckoutButton.tsx's own comment.
    } catch (err) {
      console.error("NewebPay plan switch failed:", err);
      setError("無法建立訂單，請稍後再試");
      processingRef.current = false;
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="block w-full text-center border border-default rounded px-4 py-2 font-medium hover:bg-black/5 transition-colors"
      >
        {direction === "upgrade"
          ? `升級至${TARGET_LABELS[targetTier]}`
          : `降級至${TARGET_LABELS[targetTier]}`}
      </button>
    );
  }

  return (
    <div className="border border-default rounded-lg p-4 space-y-3">
      <p className="text-sm">
        {`確定要變更為${TARGET_LABELS[targetTier]}嗎？此操作將立即以${TARGET_LABELS[targetTier]}之完整月費重新收費一次（不會依原方案剩餘天數折抵），原訂閱將於新訂單付款成功後自動終止。`}
      </p>
      <label className="flex items-start gap-2 text-xs text-secondary">
        <input
          type="checkbox"
          checked={businessUseConfirmed}
          onChange={(e) => setBusinessUseConfirmed(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          我確認本次訂閱係基於商業、營業或專業目的而非個人消費使用，並同意服務於付款完成後立即開始提供，了解此情形依法不適用通訊交易之七日猶豫期解除權。
        </span>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={loading || !businessUseConfirmed}
          onClick={handleConfirm}
          className="flex-1 text-center bg-[var(--accent)] text-white rounded px-4 py-2 font-medium disabled:opacity-50"
        >
          {loading ? "處理中…" : "確認並前往付款"}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setConfirming(false);
            setError(null);
            setBusinessUseConfirmed(false);
          }}
          className="border border-default rounded px-4 py-2 disabled:opacity-50"
        >
          取消
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

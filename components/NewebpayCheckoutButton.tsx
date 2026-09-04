"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// 2026-09-04 — NewebPay equivalent of CheckoutButton.tsx. Structured to
// match that component's loading/processingRef pattern so the two are
// easy to compare, but the actual "open checkout" mechanism is different:
// Paddle's Checkout.open() shows an in-page overlay via Paddle.js:
// NewebPay's Period API has no such overlay — the browser has to do a
// real top-level form POST of {MerchantID, PostData_} straight to
// NewebPay's own hosted /MPG/period page (a full navigation away from
// taiwanleads.com, not a fetch/AJAX call), which is what buildFormAndSubmit
// below does. NewebPay's hosted page takes over from there; the eventual
// redirect back and the async payment notification are handled by
// ReturnURL/NotifyURL (app/api/webhooks/newebpay/route.ts), not by this
// component.
//
// **Not rendered anywhere yet.** Nothing currently imports this component
// into app/(marketing)/pricing/page.tsx (which still only renders the
// Paddle CheckoutButton) — per the standing 2026-09-04 decision, wiring
// this in (and hiding/replacing the Paddle button) is a deliberate later
// step, done only once the whole NewebPay loop is verified against a real
// sandbox account. This file exists so that step is a wiring change, not
// a from-scratch build, when the time comes.

function buildFormAndSubmit(url: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  // No target="_blank" — this is meant to navigate the whole tab away to
  // NewebPay's hosted page, the same way Paddle's overlay takes over the
  // current page, not open a second tab/window the person has to notice.
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

export default function NewebpayCheckoutButton({
  tier,
  label,
  className,
  userId,
}: {
  tier: "pro" | "business";
  label: string;
  className?: string;
  userId: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref, not state, for the same reason CheckoutButton.tsx uses one: a
  // ref is checked synchronously, so a burst of clicks before the first
  // request resolves genuinely can't send a second one.
  const processingRef = useRef(false);

  async function handleClick(cadence: "monthly" | "yearly") {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      if (!userId) {
        router.push("/signup?callbackUrl=/pricing");
        return;
      }

      const res = await fetch("/api/checkout/newebpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cadence }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.url || !data?.postData || !data?.merchantId) {
        setError(data?.error ?? "無法建立訂單，請稍後再試");
        return;
      }

      // Field names match what app/api/webhooks/newebpay/route.ts already
      // expects on the notify side (MerchantID) and what
      // lib/newebpay-api.ts's own comment documents for the request body
      // (PostData_) — kept consistent with those rather than invented
      // fresh here.
      buildFormAndSubmit(data.url, {
        MerchantID: data.merchantId,
        PostData_: data.postData,
      });
      // Deliberately no `finally`-driven reset of loading/processingRef
      // here on the success path: the tab is about to navigate away to
      // NewebPay entirely, so there's no later moment where re-enabling
      // this button would be correct.
    } catch (err) {
      console.error("NewebPay checkout failed:", err);
      setError("無法建立訂單，請稍後再試");
      processingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={loading}
        onClick={() => handleClick("monthly")}
        className={className}
      >
        {loading ? "處理中…" : label}
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => handleClick("yearly")}
        className="block w-full text-center text-xs hover:underline disabled:opacity-50"
        style={{ color: "var(--accent)" }}
      >
        或選擇年繳方案（省 17%）
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

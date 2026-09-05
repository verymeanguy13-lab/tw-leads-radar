"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// 2026-09-04 — NewebPay equivalent of CheckoutButton.tsx. Structured to
// match that component's loading/processingRef pattern so the two are
// easy to compare, but the actual "open checkout" mechanism is different:
// Paddle's Checkout.open() shows an in-page overlay via Paddle.js:
// NewebPay has no such overlay — the browser has to do a real top-level
// form POST straight to NewebPay's own hosted page (a full navigation
// away from taiwanleads.com, not a fetch/AJAX call), which is what
// buildFormAndSubmit below does. NewebPay's hosted page takes over from
// there; the eventual redirect back and the async payment notification
// are handled by ReturnURL/NotifyURL, not by this component.
//
// 2026-09-05: wired into app/(marketing)/pricing/page.tsx and
// app/(app)/account/AccountPageClient.tsx, replacing Paddle's
// CheckoutButton there (see architecture.md's 2026-09-05 "hide Paddle
// from the surface" entry). Also changed that same day: monthly and
// yearly now go through TWO DIFFERENT NewebPay products, not one -
// - monthly: unchanged, the recurring Period API
//   (app/api/checkout/newebpay/route.ts), card-only, POSTs
//   {MerchantID, PostData_}.
// - yearly: NEW, the general one-time MPG checkout
//   (app/api/checkout/newebpay-yearly/route.ts), which is what actually
//   lets the customer pick ATM transfer or 超商代碼 instead of a card on
//   NewebPay's hosted page - Period is credit-card-only, so it could
//   never do this (see architecture.md's 2026-09-05 "correction" entry
//   for why). POSTs {MerchantID, TradeInfo, TradeSha, Version} instead -
//   a different envelope, matching MPG's own convention, not Period's.
//   The real product difference this hides from the UI: a yearly
//   purchase does NOT auto-renew (there's no recurring commitment to
//   renew) - see the yearly route's own header comment.

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

      const endpoint =
        cadence === "monthly" ? "/api/checkout/newebpay" : "/api/checkout/newebpay-yearly";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cadence }),
      });
      const data = await res.json().catch(() => null);

      if (cadence === "monthly") {
        // Field names match what app/api/webhooks/newebpay/route.ts
        // already expects on the notify side (MerchantID) and what
        // lib/newebpay-api.ts's own comment documents for the request
        // body (PostData_).
        if (!res.ok || !data?.url || !data?.postData || !data?.merchantId) {
          setError(data?.error ?? "無法建立訂單，請稍後再試");
          return;
        }
        buildFormAndSubmit(data.url, {
          MerchantID: data.merchantId,
          PostData_: data.postData,
        });
      } else {
        // Yearly's MPG checkout envelope is different from Period's -
        // TradeInfo/TradeSha/Version alongside MerchantID, matching
        // lib/newebpay-api.ts's buildCreateMpgOrderRequest() output and
        // what app/api/webhooks/newebpay-mpg/route.ts expects back on
        // the notify side.
        if (!res.ok || !data?.url || !data?.tradeInfo || !data?.tradeSha || !data?.merchantId) {
          setError(data?.error ?? "無法建立訂單，請稍後再試");
          return;
        }
        buildFormAndSubmit(data.url, {
          MerchantID: data.merchantId,
          TradeInfo: data.tradeInfo,
          TradeSha: data.tradeSha,
          Version: data.version,
        });
      }
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
        或選擇年繳方案（省 17%，可用ATM轉帳／超商代碼付款，不需信用卡）
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

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
// 2026-09-06: added the required "business use" checkbox below, and a
// businessUseConfirmed flag on both checkout POST bodies. This is the
// checkbox app/(marketing)/terms/page.tsx (第一條, 第六條) already
// described as existing at subscription time - the 2026-09-06 site
// completeness audit found the Terms made this claim while no such
// checkbox actually existed anywhere in the product. Wording is drawn
// directly from Terms 第六條's own language so the two can't drift out
// of sync. Both checkout API routes now reject the request outright
// (400, before any row is written) if this isn't true - never trust a
// client-side-only checkbox for something this legally load-bearing.
// See db/schema.sql's business_use_confirmed_at columns (migration:
// scripts/migrate-add-business-use-confirmation.ts) for how the
// confirmation is recorded as evidence, not just gated on.
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
  const [businessUseConfirmed, setBusinessUseConfirmed] = useState(false);
  // Ref, not state, for the same reason CheckoutButton.tsx uses one: a
  // ref is checked synchronously, so a burst of clicks before the first
  // request resolves genuinely can't send a second one.
  const processingRef = useRef(false);

  async function handleClick(cadence: "monthly" | "yearly") {
    if (processingRef.current) return;

    if (!userId) {
      // Not signed in yet - this click isn't "subscribing", it's "go
      // create an account first", so the business-use checkbox (which is
      // about confirming *this specific paid subscription*, per Terms
      // 第六條) doesn't apply here yet. They'll see this same button
      // again, with the checkbox, once they're back on /pricing signed
      // in - see the JSX below, which only requires the checkbox when
      // userId is present.
      router.push("/signup?callbackUrl=/pricing");
      return;
    }

    // Belt-and-suspenders: the button itself is already disabled unless
    // this is true (see the JSX below), but check again here too in case
    // that ever changes - the API routes enforce this for real, this is
    // just to avoid firing a request that's guaranteed to be rejected.
    if (!businessUseConfirmed) return;
    processingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const endpoint =
        cadence === "monthly" ? "/api/checkout/newebpay" : "/api/checkout/newebpay-yearly";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cadence, businessUseConfirmed }),
      });
      const data = await res.json().catch(() => null);

      if (cadence === "monthly") {
        // Field names match what app/api/webhooks/newebpay/route.ts
        // already expects on the notify side (MerchantID) and what
        // lib/newebpay-api.ts's own comment documents for the request
        // body (PostData_).
        if (!res.ok || !data?.url || !data?.postData || !data?.merchantId) {
          // 2026-09-05 fix: found live on taiwanleads.com — this branch
          // used to `return` without resetting `loading`/`processingRef`,
          // which is correct for the *success* path just below (comment
          // preserved there) but was wrong here, since nothing navigates
          // away after a graceful error. The button was getting stuck on
          // "處理中…" forever after ANY non-2xx response (confirmed live:
          // the "已有進行中的訂閱" case, but the same "NewebPay 尚未設定
          // 完成" 503 every fresh signup currently hits would have done
          // the same) — the only recovery was a full page reload. Reset
          // here so the person can actually retry (try yearly instead,
          // fix whatever the error says, etc.) without one.
          setError(data?.error ?? "無法建立訂單，請稍後再試");
          processingRef.current = false;
          setLoading(false);
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
          // Same 2026-09-05 fix as the monthly branch above - see that
          // comment.
          setError(data?.error ?? "無法建立訂單，請稍後再試");
          processingRef.current = false;
          setLoading(false);
          return;
        }
        buildFormAndSubmit(data.url, {
          MerchantID: data.merchantId,
          TradeInfo: data.tradeInfo,
          TradeSha: data.tradeSha,
          Version: data.version,
        });
      }
      // No `finally`-driven reset of loading/processingRef here on the
      // success path (buildFormAndSubmit was called): the tab is about
      // to navigate away to NewebPay entirely, so there's no later
      // moment where re-enabling this button would be correct. Every
      // failure path above now resets explicitly instead - see their
      // own comments.
    } catch (err) {
      console.error("NewebPay checkout failed:", err);
      setError("無法建立訂單，請稍後再試");
      processingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
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
      <button
        type="button"
        disabled={loading || (!!userId && !businessUseConfirmed)}
        onClick={() => handleClick("monthly")}
        className={className}
      >
        {loading ? "處理中…" : label}
      </button>
      <button
        type="button"
        disabled={loading || (!!userId && !businessUseConfirmed)}
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

"use client";
import { useEffect, useState } from "react";
import NewebpayCheckoutButton from "@/components/NewebpayCheckoutButton";

// Session 21 — Account & Billing Settings.
//
// Receives userId as a prop from the server component (page.tsx) rather
// than calling next-auth/react's useSession() — this app has no
// <SessionProvider> anywhere, matching the same approach
// app/(marketing)/pricing/page.tsx already uses. (userEmail was also
// passed here until 2026-09-05 - only needed for Paddle's Checkout.open()
// prefill, which NewebpayCheckoutButton has no equivalent of - removed
// from both this component and page.tsx alongside the checkout switch.)
//
// 2026-09-05: the free-tier "升級方案" checkout buttons below switched
// from Paddle's CheckoutButton to NewebpayCheckoutButton, alongside the
// same swap on app/(marketing)/pricing/page.tsx (see that file's own
// comment for why and its real, immediate consequence: no one can
// actually complete checkout until a real 藍新 merchant account exists).
// The "降級至方案 B"/"升級至方案 C" buttons further down and the
// "更新付款方式" link are UNCHANGED and still Paddle-only (change-plan
// and update-payment-method have no NewebPay equivalent built) - they
// only ever render for an existing paid subscriber (`info.tier !==
// "free"`), which today can only mean a legacy Paddle subscriber, since
// the only reachable new-purchase path is NewebPay now.
//
// Known limitation, not built in this session: there's no "undo
// cancellation" button. Once someone cancels (scheduled for period
// end), this page just shows that it's scheduled — resuming a
// subscription with a pending cancellation isn't a well-documented,
// verified-safe API call for either processor, so rather than guess at
// it for real payment infrastructure, it was left out. If someone
// changes their mind before the period ends, they'd need to contact
// support for now, or simply re-subscribe via checkout once the old
// subscription actually lapses.

interface AccountInfo {
  tier: "free" | "pro" | "business";
  status: string | null;
  currentPeriodEnd: string | null;
  scheduledCancellation: boolean;
  // 2026-09-05: false only for a one-time yearly purchase (the new MPG/
  // ATM-CVS checkout - see app/api/checkout/newebpay-yearly/route.ts).
  // There's no recurring commitment behind it, so no cancel button, no
  // change-plan options, and no "next billing date" - just a plain
  // expiry. True for every other paid case (Paddle and NewebPay-monthly
  // both auto-renew).
  autoRenew: boolean;
  updatePaymentMethodUrl: string | null;
  paddleUnreachable?: boolean;
  vatId: string | null;
}

interface Props {
  userId: string | null;
}

const TIER_LABELS: Record<string, string> = {
  free: "\u514d\u8cbb\u65b9\u6848 A",
  pro: "\u65b9\u6848 B\uff08\u9031\u5831\uff09",
  business: "\u65b9\u6848 C",
};

function formatDate(iso: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" });
}

export default function AccountPageClient({ userId }: Props) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 2026-09-03: 統一編號 (VAT ID) capture-and-store field. Kept as its
  // own input/saving/message state, separate from the plan-management
  // `message` above, so a VAT ID save result doesn't get overwritten by
  // (or overwrite) an unrelated cancel/change-plan message.
  const [vatIdInput, setVatIdInput] = useState("");
  const [vatIdSaving, setVatIdSaving] = useState(false);
  const [vatIdMessage, setVatIdMessage] = useState<string | null>(null);

  async function loadAccount() {
    setLoading(true);
    try {
      const res = await fetch("/api/account");
      if (res.ok) {
        const data: AccountInfo = await res.json();
        setInfo(data);
        setVatIdInput(data.vatId ?? "");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccount();
  }, []);

  async function handleSaveVatId() {
    setVatIdSaving(true);
    setVatIdMessage(null);
    try {
      const res = await fetch("/api/account/vat-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vatId: vatIdInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVatIdMessage(data.error || "儲存失敗，請稍後再試");
      } else {
        setVatIdMessage("已儲存。");
        setVatIdInput(data.vatId ?? "");
        setInfo((prev) => (prev ? { ...prev, vatId: data.vatId ?? null } : prev));
      }
    } finally {
      setVatIdSaving(false);
    }
  }

  async function handleCancel() {
    if (!confirm("\u78ba\u5b9a\u8981\u53d6\u6d88\u8a02\u95b1\u55ce\uff1f\u60a8\u5c07\u53ef\u4f7f\u7528\u81f3\u672c\u671f\u7d50\u675f\u3002")) return;
    setActionPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/account/cancel", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "\u53d6\u6d88\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66");
      } else {
        setMessage("\u5df2\u5b89\u6392\u65bc\u672c\u671f\u7d50\u675f\u6642\u53d6\u6d88\u8a02\u95b1\u3002");
        await loadAccount();
      }
    } finally {
      setActionPending(false);
    }
  }

  async function handleChangePlan(targetTier: "pro" | "business", cadence: "monthly" | "yearly") {
    setActionPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/account/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTier, cadence }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "\u8b8a\u66f4\u65b9\u6848\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66");
      } else {
        setMessage("\u65b9\u6848\u5df2\u66f4\u65b0\u3002");
        await loadAccount();
      }
    } finally {
      setActionPending(false);
    }
  }

  if (loading) {
    return <div className="px-8 py-16 max-w-2xl mx-auto">{"\u8f09\u5165\u4e2d\u2026"}</div>;
  }

  if (!info) {
    return (
      <div className="px-8 py-16 max-w-2xl mx-auto">
        {"\u7121\u6cd5\u8f09\u5165\u5e33\u6236\u8cc7\u8a0a\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u3002"}
      </div>
    );
  }

  return (
    <div className="px-8 py-16 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-8">{"\u5e33\u6236\u8207\u5e33\u55ae"}</h1>

      <div className="border border-default rounded-lg p-6 mb-6">
        <p className="text-sm text-secondary mb-1">{"\u76ee\u524d\u65b9\u6848"}</p>
        <p className="text-xl font-semibold mb-4">{TIER_LABELS[info.tier]}</p>

        {info.tier !== "free" && (
          <>
            <p className="text-sm text-secondary">
              {!info.autoRenew
                ? "\u670d\u52d9\u6709\u6548\u81f3\u4ee5\u4e0b\u65e5\u671f\uff0c\u5c46\u6eff\u5f8c\u5c07\u81ea\u52d5\u8f49\u70ba\u514d\u8cbb\u65b9\u6848\uff08\u4e0d\u6703\u81ea\u52d5\u7e8c\u7d04\uff09\uff1a"
                : info.scheduledCancellation
                ? "\u8a02\u95b1\u5c07\u65bc\u4ee5\u4e0b\u65e5\u671f\u7d50\u675f\uff0c\u4e0d\u6703\u81ea\u52d5\u7e8c\u7d04\uff1a"
                : "\u4e0b\u6b21\u7e8c\u8cbb\u65e5\u671f\uff1a"}
              {" "}
              {formatDate(info.currentPeriodEnd)}
            </p>
            {info.paddleUnreachable && (
              <p className="text-sm text-secondary mt-2">
                {"\uff08\u76ee\u524d\u7121\u6cd5\u53d6\u5f97\u6700\u65b0\u4ed8\u6b3e\u9023\u7d50\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\uff09"}
              </p>
            )}
          </>
        )}
      </div>

      <div className="border border-default rounded-lg p-6 mb-6">
        <p className="text-sm text-secondary mb-1">{"統一編號（選填）"}</p>
        <p className="text-xs text-secondary mb-3">
          {"目前僅供儲存，尚未用於發票或付款流程。"}
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={8}
            value={vatIdInput}
            onChange={(e) => setVatIdInput(e.target.value)}
            placeholder="12345678"
            className="border-default border rounded px-3 py-2 flex-1"
          />
          <button
            type="button"
            disabled={vatIdSaving}
            onClick={handleSaveVatId}
            className="border border-default rounded px-4 py-2 disabled:opacity-50 whitespace-nowrap"
          >
            {vatIdSaving ? "儲存中…" : "儲存"}
          </button>
        </div>
        {vatIdMessage && <p className="text-sm mt-2">{vatIdMessage}</p>}
      </div>

      {message && (
        <div className="border border-default rounded-lg p-4 mb-6 text-sm">{message}</div>
      )}

      {info.tier === "free" && (
        <div className="border border-default rounded-lg p-6 mb-6">
          <p className="font-semibold mb-4">{"\u5347\u7d1a\u65b9\u6848"}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NewebpayCheckoutButton
              tier="pro"
              label={"\u5347\u7d1a\u81f3\u65b9\u6848 B"}
              className="block w-full text-center bg-[var(--accent)] text-white rounded px-4 py-2 font-medium disabled:opacity-50"
              userId={userId}
            />
            <NewebpayCheckoutButton
              tier="business"
              label={"\u5347\u7d1a\u81f3\u65b9\u6848 C"}
              className="block w-full text-center bg-[var(--accent)] text-white rounded px-4 py-2 font-medium disabled:opacity-50"
              userId={userId}
            />
          </div>
        </div>
      )}

      {info.tier === "pro" && info.autoRenew && !info.scheduledCancellation && (
        <div className="border border-default rounded-lg p-6 mb-6">
          <button
            type="button"
            disabled={actionPending}
            onClick={() => handleChangePlan("business", "monthly")}
            className="block w-full text-center border border-default rounded px-4 py-2 disabled:opacity-50"
          >
            {"\u5347\u7d1a\u81f3\u65b9\u6848 C"}
          </button>
        </div>
      )}

      {info.tier === "business" && info.autoRenew && !info.scheduledCancellation && (
        <div className="border border-default rounded-lg p-6 mb-6">
          <button
            type="button"
            disabled={actionPending}
            onClick={() => handleChangePlan("pro", "monthly")}
            className="block w-full text-center border border-default rounded px-4 py-2 disabled:opacity-50"
          >
            {"\u964d\u7d1a\u81f3\u65b9\u6848 B"}
          </button>
        </div>
      )}

      {info.tier !== "free" && !info.autoRenew && (
        // One-time yearly purchase (MPG/ATM-CVS checkout) - no recurring
        // commitment, so no cancel button and no payment-method link.
        // The expiry itself is already shown in the plan card above.
        <div className="border border-default rounded-lg p-6">
          <p className="text-sm text-secondary">
            {"\u6b64\u65b9\u6848\u70ba\u5e74\u7e73\u4e00\u6b21\u6027\u4ed8\u6b3e\uff0c\u5230\u671f\u5f8c\u5c07\u81ea\u52d5\u8f49\u70ba\u514d\u8cbb\u65b9\u6848\u3002\u82e5\u8981\u7e7c\u7e8c\u4f7f\u7528\u4ed8\u8cbb\u529f\u80fd\uff0c\u8acb\u65bc\u5230\u671f\u524d\u91cd\u65b0\u8cfc\u8cb7\u3002"}
          </p>
        </div>
      )}

      {info.tier !== "free" && info.autoRenew && (
        <div className="border border-default rounded-lg p-6 space-y-3">
          {info.updatePaymentMethodUrl && (
            <a
              href={info.updatePaymentMethodUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center border border-default rounded px-4 py-2"
            >
              {"\u66f4\u65b0\u4ed8\u6b3e\u65b9\u5f0f"}
            </a>
          )}
          {!info.scheduledCancellation && (
            <button
              type="button"
              disabled={actionPending}
              onClick={handleCancel}
              className="block w-full text-center text-secondary hover:underline disabled:opacity-50"
            >
              {"\u53d6\u6d88\u8a02\u95b1"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

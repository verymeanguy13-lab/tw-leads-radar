"use client";
import { useEffect, useState } from "react";
import CheckoutButton from "@/components/CheckoutButton";

// Session 21 — Account & Billing Settings.
//
// Receives userId/userEmail as props from the server component
// (page.tsx) rather than calling next-auth/react's useSession() —
// this app has no <SessionProvider> anywhere, matching the same
// approach app/(marketing)/pricing/page.tsx already uses for
// CheckoutButton.
//
// Known limitation, not built in this session: there's no "undo
// cancellation" button. Once someone cancels (scheduled for period
// end), this page just shows that it's scheduled — resuming a
// Paddle Billing subscription that has a pending cancellation isn't a
// well-documented, verified-safe API call the way cancel/change-plan
// are, so rather than guess at it for real payment infrastructure, it
// was left out. If someone changes their mind before the period ends,
// they'd need to contact support for now, or simply re-subscribe via
// checkout once the old subscription actually lapses.

interface AccountInfo {
  tier: "free" | "pro" | "business";
  status: string | null;
  currentPeriodEnd: string | null;
  scheduledCancellation: boolean;
  updatePaymentMethodUrl: string | null;
  paddleUnreachable?: boolean;
}

interface Props {
  userId: string | null;
  userEmail: string | null;
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

export default function AccountPageClient({ userId, userEmail }: Props) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAccount() {
    setLoading(true);
    try {
      const res = await fetch("/api/account");
      if (res.ok) {
        setInfo(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccount();
  }, []);

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
              {info.scheduledCancellation
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

      {message && (
        <div className="border border-default rounded-lg p-4 mb-6 text-sm">{message}</div>
      )}

      {info.tier === "free" && (
        <div className="border border-default rounded-lg p-6 mb-6">
          <p className="font-semibold mb-4">{"\u5347\u7d1a\u65b9\u6848"}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CheckoutButton
              monthlyPriceId={process.env.NEXT_PUBLIC_PADDLE_PRICE_B_MONTHLY || ""}
              yearlyPriceId={process.env.NEXT_PUBLIC_PADDLE_PRICE_B_YEARLY || ""}
              label={"\u5347\u7d1a\u81f3\u65b9\u6848 B"}
              className="block w-full text-center bg-[var(--accent)] text-white rounded px-4 py-2 font-medium disabled:opacity-50"
              userId={userId}
              userEmail={userEmail}
            />
            <CheckoutButton
              monthlyPriceId={process.env.NEXT_PUBLIC_PADDLE_PRICE_C_MONTHLY || ""}
              yearlyPriceId={process.env.NEXT_PUBLIC_PADDLE_PRICE_C_YEARLY || ""}
              label={"\u5347\u7d1a\u81f3\u65b9\u6848 C"}
              className="block w-full text-center bg-[var(--accent)] text-white rounded px-4 py-2 font-medium disabled:opacity-50"
              userId={userId}
              userEmail={userEmail}
            />
          </div>
        </div>
      )}

      {info.tier === "pro" && !info.scheduledCancellation && (
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

      {info.tier === "business" && !info.scheduledCancellation && (
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

      {info.tier !== "free" && (
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

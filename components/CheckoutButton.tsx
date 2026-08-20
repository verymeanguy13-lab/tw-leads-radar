"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: string) => void };
      Initialize: (opts: { token: string }) => void;
      Checkout: { open: (opts: Record<string, unknown>) => void };
    };
  }
}

let paddleScriptPromise: Promise<void> | null = null;

function ensurePaddleLoaded(): Promise<void> {
  if (window.Paddle) return Promise.resolve();
  if (paddleScriptPromise) return paddleScriptPromise;

  paddleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Paddle.js"));
    document.head.appendChild(script);
  });
  return paddleScriptPromise;
}

let paddleInitialized = false;

function initPaddle() {
  if (paddleInitialized || !window.Paddle) return;
  if (process.env.NEXT_PUBLIC_PADDLE_ENV === "sandbox") {
    window.Paddle.Environment.set("sandbox");
  }
  window.Paddle.Initialize({
    token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN || "",
  });
  paddleInitialized = true;
}

export default function CheckoutButton({
  monthlyPriceId,
  yearlyPriceId,
  label,
  className,
  userId,
  userEmail,
}: {
  monthlyPriceId: string;
  yearlyPriceId: string;
  label: string;
  className?: string;
  userId: string | null;
  userEmail: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // A ref, not state - state updates can lag a render behind rapid clicks,
  // a ref is checked synchronously on every call so a burst of clicks
  // before the first one finishes setting up genuinely can't get through.
  const processingRef = useRef(false);

  async function handleClick(priceId: string) {
    if (processingRef.current) return;
    processingRef.current = true;
    setLoading(true);

    try {
      if (!userId) {
        router.push("/signup?callbackUrl=/pricing");
        return;
      }

      await ensurePaddleLoaded();
      initPaddle();

      window.Paddle?.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: userEmail ? { email: userEmail } : undefined,
        customData: { userId },
      });
    } finally {
      // The overlay itself blocks further interaction with this page once
      // open. This delay just covers the moment before it actually
      // appears, so a rapid-click burst can't call Checkout.open() more
      // than once.
      setTimeout(() => {
        processingRef.current = false;
        setLoading(false);
      }, 1500);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={loading}
        onClick={() => handleClick(monthlyPriceId)}
        className={className}
      >
        {loading ? "處理中…" : label}
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => handleClick(yearlyPriceId)}
        className="block w-full text-center text-xs hover:underline disabled:opacity-50"
        style={{ color: "var(--accent)" }}
      >
        或選擇年繳方案（省 17%）
      </button>
    </div>
  );
}
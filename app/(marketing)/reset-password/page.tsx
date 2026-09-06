"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("兩次輸入的密碼不一致。");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => null);
    setSubmitting(false);

    if (!res.ok) {
      setError(data?.error ?? "重設密碼時發生錯誤，請稍後再試。");
      return;
    }

    setSuccess(true);
  }

  if (!token) {
    return (
      <div className="p-8 max-w-sm mx-auto">
        <div className="bg-card border border-default rounded-lg p-6 text-center">
          <p className="text-red-600 text-sm mb-3">重設連結無效，請重新申請。</p>
          <a href="/forgot-password" className="hover:underline text-sm" style={{ color: "var(--accent)" }}>
            重新申請重設密碼
          </a>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="p-8 max-w-sm mx-auto">
        <div className="bg-card border border-default rounded-lg p-6 text-center">
          <h1 className="text-xl font-bold mb-3">密碼已重設</h1>
          <p className="text-secondary text-sm mb-4">請使用新密碼登入。</p>
          <a href="/login" className="hover:underline text-sm" style={{ color: "var(--accent)" }}>
            前往登入
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-sm mx-auto">
      <div className="bg-card border border-default rounded-lg p-6">
        <h1 className="text-xl font-bold mb-6">設定新密碼</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div>
            <label className="block mb-1 font-medium text-sm">新密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-default border rounded px-3 py-2 w-full"
            />
            <p className="text-secondary text-xs mt-1">至少 8 個字元</p>
          </div>

          <div>
            <label className="block mb-1 font-medium text-sm">確認新密碼</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="border-default border rounded px-3 py-2 w-full"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="text-white rounded px-4 py-2 w-full font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {submitting ? "處理中…" : "重設密碼"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading...</p>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

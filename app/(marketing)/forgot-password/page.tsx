"use client";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    // Always show the same confirmation regardless of what the API
    // actually did - see app/api/auth/forgot-password/route.ts's own
    // comment for why (never reveal whether an email has an account, or
    // what kind, to an anonymous caller).
    setSubmitting(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="p-8 max-w-sm mx-auto">
        <div className="bg-card border border-default rounded-lg p-6 text-center">
          <h1 className="text-xl font-bold mb-3">請查看您的電子郵件</h1>
          <p className="text-secondary text-sm">
            若 <span className="font-medium">{email}</span>{" "}
            為已註冊帳號，我們已寄送重設密碼的連結至該信箱（1 小時內有效）。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-sm mx-auto">
      <div className="bg-card border border-default rounded-lg p-6">
        <h1 className="text-xl font-bold mb-2">忘記密碼</h1>
        <p className="text-secondary text-sm mb-6">
          請輸入您註冊時使用的電子郵件，我們將寄送重設密碼的連結給您。
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block mb-1 font-medium text-sm">電子郵件</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-default border rounded px-3 py-2 w-full"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="text-white rounded px-4 py-2 w-full font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {submitting ? "寄送中…" : "寄送重設連結"}
          </button>
        </form>

        <p className="text-secondary text-sm mt-4">
          想起密碼了嗎？{" "}
          <a href="/login" className="hover:underline" style={{ color: "var(--accent)" }}>
            登入
          </a>
        </p>
      </div>
    </div>
  );
}

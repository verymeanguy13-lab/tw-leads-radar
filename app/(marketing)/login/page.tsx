"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "電子郵件或密碼錯誤。",
  OAuthCallback: "登入時發生錯誤，請再試一次。",
  InvalidVerificationLink: "驗證連結無效或已過期，請重新寄送驗證郵件。",
};

function LoginForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/searches";
  const urlError = params.get("error");
  const justVerified = params.get("verified") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    urlError ? ERROR_MESSAGES[urlError] ?? "登入時發生錯誤，請再試一次。" : null
  );
  const [needsVerification, setNeedsVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNeedsVerification(false);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    setSubmitting(false);

    if (result?.error === "EmailNotVerified") {
      setNeedsVerification(true);
      return;
    }
    if (result?.error) {
      setError(ERROR_MESSAGES.CredentialsSignin);
      return;
    }

    window.location.href = result?.url ?? callbackUrl;
  }

  async function handleResend() {
    setResendState("sending");
    await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setResendState("sent");
  }

  return (
    <div className="p-8 max-w-sm mx-auto">
      <div className="bg-card border border-default rounded-lg p-6">
        <h1 className="text-xl font-bold mb-6">登入</h1>

        {justVerified && (
          <p className="text-sm mb-4 text-green-700">電子郵件已驗證，請登入。</p>
        )}

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          className="border-default border rounded px-4 py-2 w-full font-medium mb-4"
        >
          使用 Google 登入
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 border-t border-default" />
          <span className="text-secondary text-sm">或</span>
          <div className="flex-1 border-t border-default" />
        </div>

        {needsVerification ? (
          <div className="text-sm">
            <p className="text-red-600 mb-3">
              此帳號尚未驗證電子郵件，請查看您的收件匣完成驗證。
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState !== "idle"}
              className="hover:underline disabled:opacity-50"
              style={{ color: "var(--accent)" }}
            >
              {resendState === "sent" ? "已重新寄送" : "重新寄送驗證郵件"}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-red-600 text-sm">{error}</p>}

            <div>
              <label className="block mb-1 font-medium text-sm">電子郵件</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-default border rounded px-3 py-2 w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-sm">密碼</label>
                <a
                  href="/forgot-password"
                  className="text-xs hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  忘記密碼？
                </a>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-default border rounded px-3 py-2 w-full"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="text-white rounded px-4 py-2 w-full font-medium disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)" }}
            >
              {submitting ? "登入中…" : "登入"}
            </button>
          </form>
        )}

        <p className="text-secondary text-sm mt-4">
          還沒有帳號？{" "}
          <a href="/signup" className="hover:underline" style={{ color: "var(--accent)" }}>
            註冊
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading...</p>}>
      <LoginForm />
    </Suspense>
  );
}
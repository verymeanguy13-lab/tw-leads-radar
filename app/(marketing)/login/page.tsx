"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "電子郵件或密碼錯誤。",
  OAuthCallback: "登入時發生錯誤，請再試一次。",
};

function LoginForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/searches/new";
  const urlError = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    urlError ? ERROR_MESSAGES[urlError] ?? "登入時發生錯誤，請再試一次。" : null
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    setSubmitting(false);

    if (result?.error) {
      setError(ERROR_MESSAGES.CredentialsSignin);
      return;
    }

    window.location.href = result?.url ?? callbackUrl;
  }

  return (
    <div className="p-8 max-w-sm mx-auto">
      <div className="bg-card border border-default rounded-lg p-6">
        <h1 className="text-xl font-bold mb-6">登入</h1>

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
            <label className="block mb-1 font-medium text-sm">密碼</label>
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
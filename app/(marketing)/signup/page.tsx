"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

const BUSINESS_TYPES = [
  { value: "accounting", label: "會計 / 記帳士事務所" },
  { value: "insurance", label: "保險業" },
  { value: "marketing", label: "行銷 / 廣告代理商" },
  { value: "finance", label: "貸款 / 金融服務" },
  { value: "office_supplies", label: "辦公用品 / 設備供應商" },
  { value: "printing", label: "印刷 / 名片設計" },
  { value: "legal", label: "法律事務所" },
  { value: "other", label: "其他" },
];

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/searches/new";

  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessName, businessType, email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "建立帳號時發生錯誤，請稍後再試。");
      setSubmitting(false);
      return;
    }

    const signInResult = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setSubmitting(false);

    if (signInResult?.error) {
      // Account created but auto-login failed - send them to log in manually.
      router.push("/login");
      return;
    }

    router.push(callbackUrl);
  }

  return (
    <div className="p-8 max-w-sm mx-auto">
      <div className="bg-card border border-default rounded-lg p-6">
        <h1 className="text-xl font-bold mb-6">建立帳號</h1>

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          className="border-default border rounded px-4 py-2 w-full font-medium mb-4"
        >
          使用 Google 註冊
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 border-t border-default" />
          <span className="text-secondary text-sm">或</span>
          <div className="flex-1 border-t border-default" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div>
            <label className="block mb-1 font-medium text-sm">商業名稱</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="border-default border rounded px-3 py-2 w-full"
            />
          </div>

          <div>
            <label className="block mb-1 font-medium text-sm">商業類型</label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="border-default border rounded px-3 py-2 w-full bg-transparent"
            >
              <option value="">請選擇</option>
              {BUSINESS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

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
            <p className="text-secondary text-xs mt-1">至少 8 個字元</p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="text-white rounded px-4 py-2 w-full font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {submitting ? "建立中…" : "建立帳號"}
          </button>
        </form>

        <p className="text-secondary text-sm mt-4">
          已經有帳號了嗎？{" "}
          <a href="/login" className="hover:underline" style={{ color: "var(--accent)" }}>
            登入
          </a>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading...</p>}>
      <SignupForm />
    </Suspense>
  );
}
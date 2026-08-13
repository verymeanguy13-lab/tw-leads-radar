"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

function LoginForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/searches/new";

  return (
    <div className="p-8 max-w-sm">
      <button
        onClick={() => signIn("google", { callbackUrl })}
        className="bg-[var(--accent)] text-white rounded px-4 py-2 w-full mb-3"
      >
        使用 Google 登入
      </button>
      <button
        onClick={() => signIn("facebook", { callbackUrl })}
        className="border-default border rounded px-4 py-2 w-full"
      >
        使用 Facebook 登入
      </button>
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
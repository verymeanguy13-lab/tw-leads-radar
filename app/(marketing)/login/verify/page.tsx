"use client";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token");

  useEffect(() => {
    if (token) {
      signIn("magic-link", { token, callbackUrl: "/searches" });
    }
  }, [token]);

  return <p className="p-8">Logging you in...</p>;
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading...</p>}>
      <VerifyInner />
    </Suspense>
  );
}
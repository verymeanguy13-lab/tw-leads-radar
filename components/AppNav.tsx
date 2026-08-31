"use client";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useState } from "react";

// Shared header for the logged-in app area (/searches, /account, /admin/*).
// Before this, these pages had no navigation between each other at all -
// no way back to /searches from /account or from a search's own results
// page, and no logout control anywhere in the app. This is the fix for
// both, in one shared component so every page under app/(app)/ gets it
// automatically via app/(app)/layout.tsx.
//
// signOut() from next-auth/react works without a <SessionProvider> - same
// as signIn() already being called directly in app/(marketing)/signup's
// SignupForm without one.

export default function AppNav() {
  const [signingOut, setSigningOut] = useState(false);

  return (
    <nav className="border-b border-default px-8 py-4 flex justify-between items-center">
      <Link href="/searches" className="font-bold text-lg">
        新公司快報
      </Link>
      <div className="flex gap-6 items-center text-sm">
        <Link href="/searches">已儲存搜尋</Link>
        <Link href="/account">帳戶</Link>
        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            signOut({ callbackUrl: "/" });
          }}
          className="disabled:opacity-50"
        >
          {signingOut ? "登出中…" : "登出"}
        </button>
      </div>
    </nav>
  );
}

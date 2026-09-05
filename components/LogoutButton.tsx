"use client";
import { signOut } from "next-auth/react";
import { useState } from "react";

// Shared logout control (2026-09-05) — previously this exact
// signOut()-with-a-loading-state logic was written once, inline, inside
// components/AppNav.tsx, and nowhere else. That meant every page under
// app/(app)/ (via AppNav) could log a user out, but every page under
// app/(marketing)/ (home, pricing, the new public /search page, etc.)
// could not — a logged-in visitor browsing marketing pages had no way to
// log out without first navigating into the app section. Pulled out here
// so both app/(marketing)/layout.tsx and AppNav.tsx use the identical
// control, so "can I log out from here" no longer depends on which part
// of the site you're on.
//
// signOut() from next-auth/react works without a <SessionProvider> - same
// as signIn() already being called directly in app/(marketing)/signup's
// SignupForm without one.
export default function LogoutButton({ className }: { className?: string }) {
  const [signingOut, setSigningOut] = useState(false);

  return (
    <button
      type="button"
      disabled={signingOut}
      onClick={() => {
        setSigningOut(true);
        signOut({ callbackUrl: "/" });
      }}
      className={className ?? "disabled:opacity-50"}
    >
      {signingOut ? "登出中…" : "登出"}
    </button>
  );
}

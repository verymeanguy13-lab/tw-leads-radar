"use client";
import Link from "next/link";
import LogoutButton from "./LogoutButton";

// Shared header for the logged-in app area (/searches, /account, /admin/*).
// Before this, these pages had no navigation between each other at all -
// no way back to /searches from /account or from a search's own results
// page, and no logout control anywhere in the app. This is the fix for
// both, in one shared component so every page under app/(app)/ gets it
// automatically via app/(app)/layout.tsx.
//
// 2026-09-05: the actual signOut()-button logic moved into
// components/LogoutButton.tsx so app/(marketing)/layout.tsx can use the
// identical control - see that file's comment for why (a logged-in user
// on a marketing page previously had no way to log out at all).

export default function AppNav() {
  return (
    <nav className="border-b border-default px-8 py-4 flex justify-between items-center">
      <Link href="/searches" className="font-bold text-lg">
        新公司快報
      </Link>
      <div className="flex gap-6 items-center text-sm">
        <Link href="/search">免費查詢</Link>
        <Link href="/searches">已儲存搜尋</Link>
        <Link href="/account">帳戶</Link>
        <LogoutButton />
      </div>
    </nav>
  );
}

import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

// 2026-09-05: added an explicit, always-visible login/logout control to
// every marketing page (home, /pricing, /search, /privacy, /terms, etc.)
// - not just the app section. Before this, a logged-in user browsing any
// marketing page saw only a "已儲存搜尋" button (a link into the app, not
// a logout control) and had no way to log out without first navigating
// into app/(app)/ to reach AppNav's logout button. A logged-out user on
// those same pages did have a working "登入" link already - the gap was
// one-directional. Now every page under this layout shows the correct
// control for whichever state the visitor is actually in.
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const loggedIn = Boolean(session?.user?.email);

  return (
    <div className="flex flex-col min-h-full">
      <nav className="border-b border-default px-8 py-4 flex justify-between items-center">
        <Link href="/" className="font-bold text-lg">
          {"新公司快報"}
        </Link>
        <div className="flex gap-6 items-center text-sm">
          <Link href="/search">{"免費查詢"}</Link>
          <Link href="/pricing">{"定價"}</Link>
          {loggedIn ? (
            <>
              <LogoutButton />
              <Link
                href="/searches"
                className="bg-[var(--accent)] text-white rounded px-4 py-2"
              >
                {"已儲存搜尋"}
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="bg-[var(--accent)] text-white rounded px-4 py-2"
            >
              {"登入"}
            </Link>
          )}
        </div>
      </nav>
      <main className="flex-1">{children}</main>
      <div className="border-t border-default px-8 py-4 flex gap-6 text-xs text-secondary">
        <Link href="/privacy">{"隱私權政策"}</Link>
        <Link href="/terms">{"服務條款"}</Link>
      </div>
    </div>
  );
}

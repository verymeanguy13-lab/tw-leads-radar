import { withAuth } from "next-auth/middleware";
import { NextResponse, NextRequest, NextFetchEvent } from "next/server";

// Session 22 — Maintenance Mode.
//
// HOW TO TURN THIS ON:
//   1. In Vercel's dashboard: Settings > Environment Variables, set
//      MAINTENANCE_MODE=true for the Production environment.
//   2. Redeploy (or use Vercel's instant env var update if your plan
//      supports it without a full redeploy).
//   While active: every route except /maintenance redirects there, and
//   every /api/* route returns a 503 with a small JSON body instead of
//   running normally.
//
// HOW TO TURN THIS OFF:
//   Set MAINTENANCE_MODE=false (or delete the variable) in Vercel and
//   redeploy. The app returns to normal immediately — nothing else to
//   reset, no other state this depends on.
//
// SCOPE — deliberately NOT wired to anything automatic. This is for
// manual use during a risky schema change, a bad deploy, database
// connectivity failure, or an active security incident — not for a
// missed/failed monthly data-ingestion run (see Session 6's source
// monitoring and Session 14's freshness indicator for that instead).
// Locking out paying customers over stale data is a worse outcome than
// the stale data itself.
//
// IMPORTANT — this expands the middleware's matcher to cover the whole
// app (previously it only matched /searches, /account, /admin) so
// maintenance mode can gate every route, including public marketing
// pages. To avoid accidentally forcing a login redirect onto pages that
// were never auth-protected, the auth check below only actually runs
// for the same prefixes it always did (PROTECTED_PREFIXES) — everything
// else just passes through unchanged when maintenance mode is off.

const PROTECTED_PREFIXES = ["/searches", "/account", "/admin"];

const authMiddleware = withAuth({
  pages: { signIn: "/login" },
});

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl;

  if (process.env.MAINTENANCE_MODE === "true") {
    if (pathname === "/maintenance") {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "系統暫時維護中，請稍後再試" },
        { status: 503 }
      );
    }
    return NextResponse.redirect(new URL("/maintenance", req.url));
  }

  if (PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return (authMiddleware as unknown as (req: NextRequest, event: NextFetchEvent) => ReturnType<typeof authMiddleware>)(
      req,
      event
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

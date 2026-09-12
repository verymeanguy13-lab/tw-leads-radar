import { NextRequest, NextResponse } from "next/server";

// 2026-09-12 — fixes the "site logged me out" symptom seen on two
// separate real subscribe attempts today (both monthly Period
// checkouts). Root cause: NewebPay's own official manual confirms its
// ReturnURL mechanism is a cross-site HTML "Form Post" back to the
// merchant ("以 Form Post 方式導回商店頁"), not a simple GET redirect.
// ReturnURL used to point straight at /account?newebpay=return — a page
// that reads the NextAuth session to decide what to show. NextAuth's
// session cookie defaults to SameSite=Lax, and browsers do NOT attach a
// Lax cookie to a cross-site POST (only to a cross-site top-level GET),
// so that incoming POST arrived with no session cookie at all — the page
// rendered as if logged out, matching exactly what was observed.
//
// Fix: ReturnURL (for all three NewebPay checkout-initiation routes —
// monthly Period, yearly MPG, and plan-switch) now points here instead.
// This route needs no session at all; it just immediately redirects the
// browser on to /account. That second navigation is a normal GET issued
// by our own server's redirect, not a cross-site POST from NewebPay, so
// the SameSite=Lax cookie IS attached to it — the standard "bounce
// through a same-site redirect" fix for exactly this class of problem
// (also common for OAuth/payment-gateway callbacks in general).
//
// `dest` distinguishes the monthly/yearly "return" case from the
// plan-switch "switch-return" case — see AccountPageClient.tsx for how
// each ?newebpay= value is displayed. Defaults to "return" if somehow
// missing rather than 500ing on a malformed callback.
function bounce(req: NextRequest) {
  const dest = new URL(req.url).searchParams.get("dest") || "return";
  return NextResponse.redirect(new URL(`/account?newebpay=${dest}`, req.url), 303);
}

export async function POST(req: NextRequest) {
  return bounce(req);
}

// NewebPay's manual only documents the Form Post behavior for Period/MPG
// ReturnURL, but handling GET too costs nothing and guards against any
// flow (or payment method) that turns out to come back via a plain
// redirect instead.
export async function GET(req: NextRequest) {
  return bounce(req);
}

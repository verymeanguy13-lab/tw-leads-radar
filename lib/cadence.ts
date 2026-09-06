import type { Cadence } from "./tiers";

// 2026-09-05 — shared by lib/email/digest.ts (bounding what a digest
// includes) and app/api/searches/[id]/digest-export/route.ts (bounding
// what that digest's own CSV download link reproduces). Split into its
// own file specifically so both can import it without either depending
// on the other - digest.ts is server-only email-sending logic, the
// export route is a public-facing API handler, and neither should have
// to pull in the other's unrelated imports just for this one constant.
//
// Direct instruction from the user: each notification should only ever
// contain data from within its own cadence's own recency window, not
// "everything that hasn't been sent yet regardless of age" (the
// previous behavior - see this file's usage in digest.ts for what
// happens to a match that falls outside this window by the time its
// search becomes due). Lookback lengths deliberately don't exactly
// match CADENCE_DUE_AFTER_DAYS in digest.ts - that constant answers "is
// this search due to be checked again," a scheduling question; this one
// answers "how far back does the content go," a content-freshness
// question - and there's no requirement they move together.
export const CADENCE_LOOKBACK_DAYS: Record<Cadence, number> = {
  daily: 2,
  weekly: 7,
  monthly: 30,
};

// 2026-09-06, direct user instruction: a daily digest should report on
// exactly "yesterday and the day before" - two complete calendar days,
// never a same-day sliver of "today." Checking the actual math behind
// CADENCE_LOOKBACK_DAYS turned up a real off-by-one that predates this
// request: the original window was computed as an inclusive date range
// from `at - lookbackDays*24h` through `at` itself (today, in whatever
// calendar `at`'s own toISOString() happens to fall on). An inclusive
// range spanning exactly `lookbackDays*24h` of raw time covers
// `lookbackDays + 1` distinct calendar dates, not `lookbackDays` - so
// "daily" (2) was actually showing 3 days of registrations, "weekly"
// (7) was showing 8, and "monthly" (30) was showing 31. Not caught
// before now because nobody had counted the actual calendar dates
// against the "last ~N days" comment's stated intent.
//
// Fix, used by both lib/email/digest.ts and
// app/api/searches/[id]/digest-export/route.ts so the CSV link a digest
// email includes always reproduces exactly what that email's own query
// saw: anchor on the Taiwan calendar date `at` falls on (registration_date
// reflects GCIS's own Taiwan-local setup dates, so the boundary should
// be figured in that calendar, not UTC's - the two usually agree given
// this app's cron schedule, but there's no reason to depend on that
// coincidence when Asia/Taipei can just be named explicitly), then build
// a window of exactly `lookbackDays` calendar dates ending the day
// BEFORE that anchor date. For daily that's exactly
// [day-before-yesterday, yesterday] - two dates, never today.
function toTaipeiDateString(d: Date): string {
  // en-CA formats as YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(d);
}

export function getCadenceWindow(
  cadence: Cadence,
  at: Date
): { windowStartDate: string; windowEndDate: string } {
  const lookbackDays = CADENCE_LOOKBACK_DAYS[cadence] ?? CADENCE_LOOKBACK_DAYS.monthly;
  const anchor = new Date(`${toTaipeiDateString(at)}T00:00:00Z`);

  const end = new Date(anchor);
  end.setUTCDate(end.getUTCDate() - 1);

  const start = new Date(anchor);
  start.setUTCDate(start.getUTCDate() - lookbackDays);

  return {
    windowStartDate: start.toISOString().slice(0, 10),
    windowEndDate: end.toISOString().slice(0, 10),
  };
}

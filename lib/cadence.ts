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

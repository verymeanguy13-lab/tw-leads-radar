import { DATASET_SOURCES } from "./ingestion/sources.config";

// Shared by app/(app)/searches/[id]/page.tsx (inline web display),
// app/api/searches/[id]/export/route.ts (CSV header comment), and
// lib/email/digest.ts (digest email) - previously duplicated
// independently in the first two files (with even slightly different
// names - ATTRIBUTION_NAME_ZH vs DATASET_NAME_ZH for the identical
// mapping), which is exactly the kind of drift risk that caused real
// bugs elsewhere in this project (e.g. the stale CADENCE_LABEL map
// found 2026-08-30). Consolidated here 2026-08-30 while also fixing a
// genuine gap: the digest email had no attribution at all, completing
// Session 11's second objective ("attribution appears inline anywhere
// company data is directly displayed") - which was correctly built
// for the web page and CSV export, but never carried through to the
// third and most-directly-seen place company data actually reaches a
// user.
//
// gcis_daily_setup_query is deliberately excluded - it's the live
// per-company GCIS API, not one of the 6 licensed batch datasets this
// project has an open-data attribution obligation for. Same exclusion
// Footer.tsx already applies; flagged in this project's notes as
// unverified against GCIS's own terms and worth a human check.
export const ATTRIBUTION_AGENCY = "經濟部商業發展署";

export const ATTRIBUTION_NAME_ZH: Record<string, string> = Object.fromEntries(
  DATASET_SOURCES.filter((s) => s.id !== "gcis_daily_setup_query").map((s) => [
    s.id,
    s.nameZh,
  ])
);

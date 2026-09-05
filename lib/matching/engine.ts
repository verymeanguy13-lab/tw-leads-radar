import { db } from "../db";

/**
 * Runs one saved_search's filters against companies and upserts any
 * matches into search_matches. Safe to call repeatedly - relies on
 * search_matches' UNIQUE(saved_search_id, company_uniform_id) constraint
 * via ON CONFLICT DO NOTHING, so already-matched rows never error.
 *
 * industry_codes filtering (Session 20b): uses a PostgreSQL array-overlap
 * condition (&&) against the GIN index already defined on
 * companies.industry_codes - a company matches if it holds ANY of the
 * saved_search's selected codes, not all of them. Before Session 20b,
 * every company's industry_codes was always '{}' (no ingestion source
 * populated it), so this filter was deliberately skipped entirely - see
 * Section 11's 2026-08-22 update for why that's no longer true. A saved
 * search created before Session 20b's backfill finished may still
 * return fewer matches than expected for companies not yet enriched -
 * that's a temporary backfill-completeness gap, not a filter bug.
 *
 * No freshness/tier gating here (removed 2026-09-05): a 30-day
 * freshness gate used to sit right here, hiding recent
 * entity_type='company' rows from free-tier matching entirely. The
 * business model changed - free tier and anonymous visitors now see
 * fully CURRENT data everywhere (this matcher, the live /search page,
 * and email digests); the only thing that differs by tier now is
 * whether identifying fields (uniform ID, company name, responsible
 * person) are masked, which is a read-time presentation concern, not a
 * write-time "should this even be matched" concern. See
 * architecture.md's 2026-09-05 "redaction is now the only free-tier
 * gate" entry for the full reasoning, and lib/masking.ts for where
 * masking is actually applied (app/(marketing)/search/page.tsx,
 * app/(app)/searches/[id]/page.tsx, lib/email/digest.ts). This function
 * itself no longer needs a user's tier for anything, so getUserTier()
 * was removed from here entirely.
 *
 * Returns the number of newly-created matches (not total matches).
 *
 * suppressed_at (added 2026-08-28): excludes any company with an
 * approved PDPA data-removal request - see db/schema.sql's comment on
 * data_removal_requests for the full rationale. Checked here (write
 * time) AND at every read point (results page, digest email), same
 * defense-in-depth reasoning the freshness gate used to follow - a
 * company suppressed after it was already matched into search_matches
 * must stop appearing everywhere, not just stop being newly matched.
 */
export async function matchSearch(searchId: string): Promise<number> {
  const sql = db();

  const searches = await sql`
    SELECT user_id, industry_codes, regions, capital_min, capital_max, entity_type, keyword
    FROM saved_searches
    WHERE id = ${searchId}
  `;
  const search = searches[0];
  if (!search) {
    throw new Error(`Saved search ${searchId} not found`);
  }

  const industryCodes = (search.industry_codes ?? []) as string[];
  const regions = (search.regions ?? []) as string[];
  const entityType = search.entity_type as string;
  const keyword = search.keyword as string | null;
  const capitalMin = search.capital_min as number | null;
  const capitalMax = search.capital_max as number | null;
  const keywordPattern = keyword ? `%${keyword}%` : null;

  const matches = await sql`
    SELECT uniform_id
    FROM companies
    WHERE (${regions.length === 0} OR address_region = ANY(${regions}))
      AND (${entityType === "both"} OR entity_type = ${entityType})
      AND (${capitalMin === null} OR capital >= ${capitalMin})
      AND (${capitalMax === null} OR capital <= ${capitalMax})
      AND (${keywordPattern === null} OR name ILIKE ${keywordPattern})
      AND (${industryCodes.length === 0} OR industry_codes && ${industryCodes}::text[])
      AND suppressed_at IS NULL
  `;

  if (matches.length === 0) return 0;

  const uniformIds = matches.map((r) => (r as { uniform_id: string }).uniform_id);

  const inserted = await sql`
    INSERT INTO search_matches (saved_search_id, company_uniform_id)
    SELECT ${searchId}, unnest(${uniformIds}::varchar[])
    ON CONFLICT (saved_search_id, company_uniform_id) DO NOTHING
    RETURNING id
  `;

  return inserted.length;
}

export interface MatchAllResult {
  searchesRun: number;
  searchesSkippedPaused: number;
  totalNewMatches: number;
  failures: { searchId: string; message: string }[];
}

/**
 * Runs matchSearch() for every non-paused saved_search. Meant to be
 * called after ingestion finishes (so newly-ingested companies get
 * matched against everyone's filters promptly) and is what backs the
 * manual per-search "Run now" button's underlying engine (Session 14),
 * though that button itself calls matchSearch() directly for just its
 * one search - this function is for the all-searches case.
 *
 * One search failing (e.g. a bad filter combination) does not stop the
 * others - failures are collected and returned so the caller (a GitHub
 * Actions script) can log them without the whole run aborting.
 *
 * Uses plain db(), not withUserContext - this necessarily needs every
 * user's saved_searches at once, which withUserContext (scoped to one
 * user per call) can't express. RLS is enabled on saved_searches and
 * search_matches, but only via ENABLE ROW LEVEL SECURITY (not FORCE),
 * so it does not restrict the table owner role this connection uses -
 * consistent with matchSearch() already working the same way. This is
 * a deliberate, safe use of db() for a trusted server-side job, not a
 * bypass of anything meant to gate it.
 */
export async function matchAllSearches(): Promise<MatchAllResult> {
  const sql = db();

  const allSearches = await sql`SELECT id, paused FROM saved_searches`;
  const activeSearches = (allSearches as { id: string; paused: boolean }[]).filter(
    (s) => !s.paused
  );
  const skippedCount = allSearches.length - activeSearches.length;

  let totalNewMatches = 0;
  const failures: { searchId: string; message: string }[] = [];

  for (const search of activeSearches) {
    try {
      totalNewMatches += await matchSearch(search.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ searchId: search.id, message });
    }
  }

  return {
    searchesRun: activeSearches.length,
    searchesSkippedPaused: skippedCount,
    totalNewMatches,
    failures,
  };
}
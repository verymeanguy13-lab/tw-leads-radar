import { db } from "../db";

/**
 * Runs one saved_search's filters against companies and upserts any
 * matches into search_matches. Safe to call repeatedly - relies on
 * search_matches' UNIQUE(saved_search_id, company_uniform_id) constraint
 * via ON CONFLICT DO NOTHING, so already-matched rows never error.
 *
 * NOTE: industry_codes is intentionally NOT used as a match filter here.
 * None of the 6 ingestion datasets carry an industry classification code
 * (confirmed in the blueprint's Section 11 corrections log) - every row
 * in companies.industry_codes is always '{}'. Filtering on it would mean
 * any saved_search with industry codes selected silently gets zero
 * matches forever, which is worse than not filtering at all. Revisit
 * only if/when a real industry-code source is integrated.
 *
 * Returns the number of newly-created matches (not total matches).
 */
export async function matchSearch(searchId: string): Promise<number> {
  const sql = db();

  const searches = await sql`
    SELECT regions, capital_min, capital_max, entity_type, keyword
    FROM saved_searches
    WHERE id = ${searchId}
  `;
  const search = searches[0];
  if (!search) {
    throw new Error(`Saved search ${searchId} not found`);
  }

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
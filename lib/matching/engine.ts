import { db } from "../db";
import { getUserTier } from "../tiers";

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
 * Freshness-tier gating (added post-Session 23 QA pass, corrected after
 * an immediate live-test failure - see below): the pricing page promises
 * free-tier users only "30天以上之公司資料" (company data 30+ days old),
 * with an explicit carve-out that this does NOT apply to
 * entity_type='business' (獨資/合夥) rows, since those are still only
 * refreshed monthly for every tier regardless - gating them further
 * would just be confusing, not meaningful. This was never enforced
 * anywhere before now: every tier saw identical results.
 *
 * Gates on companies.registration_date (the government's registration
 * date for the company - a real historical fact), NOT
 * companies.created_at (when OUR system happened to insert the row).
 * The first version of this fix used created_at and immediately zeroed
 * out a real free-tier test search: Session 20b's historical backfill
 * bulk-inserted ~43,599 companies within a single recent window, so
 * nearly every row shares almost the same created_at regardless of how
 * old the actual company is - created_at measures "when we imported
 * this," not "how new this lead is." registration_date is what the
 * pricing promise is actually about: a company's own registration age.
 * Falls back to created_at (cast to date) only when registration_date
 * is NULL (schema allows it - some rows lack a confirmed date), so such
 * rows aren't permanently hidden from free tier over missing data.
 *
 * Returns the number of newly-created matches (not total matches).
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

  const userId = search.user_id as string;
  const industryCodes = (search.industry_codes ?? []) as string[];
  const regions = (search.regions ?? []) as string[];
  const entityType = search.entity_type as string;
  const keyword = search.keyword as string | null;
  const capitalMin = search.capital_min as number | null;
  const capitalMax = search.capital_max as number | null;
  const keywordPattern = keyword ? `%${keyword}%` : null;

  const tier = await getUserTier(userId);
  const isFreeTier = tier === "free";

  const matches = await sql`
    SELECT uniform_id
    FROM companies
    WHERE (${regions.length === 0} OR address_region = ANY(${regions}))
      AND (${entityType === "both"} OR entity_type = ${entityType})
      AND (${capitalMin === null} OR capital >= ${capitalMin})
      AND (${capitalMax === null} OR capital <= ${capitalMax})
      AND (${keywordPattern === null} OR name ILIKE ${keywordPattern})
      AND (${industryCodes.length === 0} OR industry_codes && ${industryCodes}::text[])
      AND (
        entity_type = 'business'
        OR ${!isFreeTier}
        OR COALESCE(registration_date, created_at::date) <= (now() - interval '30 days')::date
      )
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
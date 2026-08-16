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

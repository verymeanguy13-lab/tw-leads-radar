import { neon, neonConfig } from "@neondatabase/serverless";

neonConfig.fetchConnectionCache = true;

const sql = neon(process.env.DATABASE_URL!);

/**
 * Runs a query scoped to a specific user, setting app.current_user_id
 * first so Row Level Security policies apply correctly.
 *
 * RLS depends on this being set on EVERY user-scoped query - never
 * query users/subscriptions/saved_searches/search_matches without
 * going through this helper.
 */
export async function withUserContext<T>(
  userId: string,
  queryFn: (sqlClient: typeof sql) => Promise<T>
): Promise<T> {
  await sql`SELECT set_config('app.current_user_id', ${userId}, true)`;
  return queryFn(sql);
}

/**
 * For queries against tables that are NOT user-owned
 * (companies, ingestion_runs) - no user context needed,
 * these are gated at the app layer instead of RLS.
 */
export function db() {
  return sql;
}
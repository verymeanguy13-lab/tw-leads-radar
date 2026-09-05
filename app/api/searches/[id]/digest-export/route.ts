import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserTier } from "@/lib/tiers";
import { CADENCE_LOOKBACK_DAYS } from "@/lib/cadence";
import { buildMatchesCsv, safeCsvFilename } from "@/lib/csv-export";
import { isNarrowResultSet } from "@/lib/masking";
import type { Company } from "@/types/db";
import type { Cadence } from "@/lib/tiers";

// 2026-09-05 — the "下載本次通知 CSV" link in every digest email
// (lib/email/digest.ts), reached by clicking a link in an inbox, not by
// being logged in. Deliberately unauthenticated for the same reason and
// under the same trust model app/api/searches/[id]/unsubscribe/route.ts
// already documents: saved_searches.id is a gen_random_uuid(), 122 bits
// of randomness, never enumerable, never shown outside this one search's
// own owner and this one search's own emails - the link itself is the
// credential, same as every mainstream mail provider's own one-click
// unsubscribe already assumes for a different action.
//
// This does NOT reuse app/api/searches/[id]/export/route.ts's auth+tier
// gate (require login, paid tier only, unmasked, all-time) - it's a
// genuinely different feature the user asked for directly: each digest
// email's own "no attachment, use a link instead" download, scoped to
// EXACTLY the same window that email's HTML rows were drawn from, and
// available regardless of tier - free-tier links return the SAME masked
// rows that tier's HTML table already shows (never anything less masked
// than the email itself), never gated behind login. Masking is derived
// from the search owner's CURRENT tier looked up server-side via
// getUserTier() - never from anything in the request - specifically so
// a client can't request an unmasked file by editing the URL; the only
// thing the URL controls is WHICH window of data comes back, not whether
// it's masked.
//
// Windowing: `at` is the ISO timestamp of the digest run that generated
// this link (lib/email/digest.ts passes `now` from that same run). The
// window is [at - cadence's own lookback, at], matching
// CADENCE_LOOKBACK_DAYS exactly - so this link always reproduces what
// that specific email actually contained, not "whatever this search
// currently has" (which would drift as new matches accumulate and old
// ones age out of the window on later visits). Does NOT filter by
// surfaced_in_digest - by the time a recipient clicks this, digest.ts
// has already flipped that flag to true for every row it emailed, so
// filtering on it here would return nothing.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const atParam = searchParams.get("at");
  const at = atParam && !Number.isNaN(Date.parse(atParam)) ? new Date(atParam) : new Date();

  const sql = db();

  // No withUserContext/RLS here - deliberately unauthenticated, same as
  // the unsubscribe route. Reads cadence directly off the row rather
  // than trusting anything client-supplied, so the window this returns
  // always matches what this specific search's own digests actually
  // use - a tampered URL can shift `at`, but can't claim a different
  // (longer) cadence than the search actually has.
  const rows = await sql`
    SELECT id, name, cadence, user_id
    FROM saved_searches
    WHERE id = ${id}
  `;
  const search = rows[0] as
    | { id: string; name: string; cadence: Cadence; user_id: string }
    | undefined;

  if (!search) {
    return new NextResponse("找不到此搜尋條件，或連結有誤。", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const lookbackDays = CADENCE_LOOKBACK_DAYS[search.cadence] ?? CADENCE_LOOKBACK_DAYS.monthly;
  const windowStart = new Date(at.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const tier = await getUserTier(search.user_id);
  const mask = tier === "free";

  const matches = (await sql`
    SELECT
      c.uniform_id,
      c.entity_type,
      c.name,
      c.registration_date,
      c.address_region,
      c.address_district,
      c.address_raw,
      c.responsible_person,
      c.status,
      c.status_updated_at,
      c.capital,
      c.source_dataset
    FROM search_matches sm
    JOIN companies c ON c.uniform_id = sm.company_uniform_id
    WHERE sm.saved_search_id = ${search.id}
      AND c.suppressed_at IS NULL
      AND c.registration_date IS NOT NULL
      AND c.registration_date >= ${windowStart.toISOString().slice(0, 10)}
      AND c.registration_date <= ${at.toISOString().slice(0, 10)}
    ORDER BY c.registration_date DESC NULLS LAST
  `) as Company[];

  // Same narrow-result-set floor as the email itself (lib/masking.ts) -
  // only meaningful when mask is also true, matching every other
  // free-tier surface in this app.
  const narrow = mask && isNarrowResultSet(matches.length);

  const flaggedDatasets = Array.from(
    new Set(
      matches
        .filter((r) => r.status === "dissolved" || r.status === "suspended")
        .map((r) => r.source_dataset)
        .filter((d): d is string => !!d)
    )
  );
  const datasetFreshness = new Map<string, string>();
  if (flaggedDatasets.length > 0) {
    const freshRows = await sql`
      SELECT DISTINCT ON (dataset_name) dataset_name, completed_at
      FROM ingestion_runs
      WHERE status = 'success' AND dataset_name = ANY(${flaggedDatasets})
      ORDER BY dataset_name, completed_at DESC
    `;
    for (const r of freshRows as { dataset_name: string; completed_at: string }[]) {
      datasetFreshness.set(r.dataset_name, r.completed_at);
    }
  }

  const csvBody = buildMatchesCsv(matches, { mask, narrow, datasetFreshness });
  const safeName = safeCsvFilename(search.name);

  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-${at
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}

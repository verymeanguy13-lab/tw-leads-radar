import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";
import { canExportCsv } from "@/lib/tiers";
import { buildMatchesCsv, safeCsvFilename } from "@/lib/csv-export";
import type { Company } from "@/types/db";

// Session 20 — CSV Export
// Objectives (blueprint Section 9):
//   - export blocked for free tier at the API level, not just hidden in UI
//   - CSV includes the attribution credit line as a header comment
//   - dissolved/suspended rows carry their own recency note, not just a
//     general "data as of today" line (Section 5 standing principle)
//
// Freshness and attribution logic here deliberately mirror
// app/(app)/searches/[id]/page.tsx's existing patterns (datasetFreshness
// keyed by each row's own source_dataset, attribution scoped to datasets
// actually present) rather than inventing a separate approach.
// Attribution constants now shared via lib/attribution.ts (previously
// duplicated locally here and in the results page, with different
// names for the same mapping - consolidated 2026-08-30).
//
// 2026-09-05: the actual CSV-building (columns, escaping, attribution
// lines, BOM) moved to lib/csv-export.ts's buildMatchesCsv(), shared
// with the new app/api/searches/[id]/digest-export/route.ts (the
// per-notification CSV download link in digest emails). This route's
// own behavior is unchanged by that extraction - still paid-only
// (canExportCsv gate below), still unmasked, still every match this
// search has ever produced, not windowed to any date range.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "找不到使用者。" }, { status: 401 });
  }

  // Tier gating (Session 19 / lib/tiers.ts) — enforced here at the API
  // level, regardless of whether the export button is even rendered
  // client-side.
  const allowed = await canExportCsv(userId);
  if (!allowed) {
    return NextResponse.json(
      { error: "CSV 匯出僅限付費方案使用，請升級方案。" },
      { status: 403 }
    );
  }

  // Ownership check: RLS's saved_searches_isolation policy means this
  // SELECT only returns a row if the search belongs to this user.
  const owned = await withUserContext(userId, (sqlClient) =>
    sqlClient`SELECT id, name FROM saved_searches WHERE id = ${id}`
  );
  const savedSearch = owned[0];
  if (!savedSearch) {
    return NextResponse.json({ error: "找不到此搜尋條件。" }, { status: 404 });
  }

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
    WHERE sm.saved_search_id = ${id}
    ORDER BY c.registration_date DESC NULLS LAST
  `) as Company[];

  // Per-row freshness, sourced from each row's OWN source_dataset - same
  // pattern as the results page. 商業歇業登記清冊 (business_dissolve) runs
  // on a slower cadence than the others (Section 11), so a single blended
  // "as of" date across all rows would overstate how current a
  // dissolved/suspended row's status actually is.
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

  const csvBody = buildMatchesCsv(matches, { datasetFreshness });

  const safeName = safeCsvFilename(savedSearch.name as string);

  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}

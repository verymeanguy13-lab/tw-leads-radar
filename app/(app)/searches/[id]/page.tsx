import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";
import { formatCapital, formatDate } from "@/lib/utils";
import { DATASET_SOURCES } from "@/lib/ingestion/sources.config";
import DataAttribution, { AttributionDataset } from "@/components/DataAttribution";
import RunNowButton from "@/components/RunNowButton";
import type { Company } from "@/types/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const STALE_AFTER_DAYS = 42; // ~6 weeks

type SortKey = "registration_date" | "capital" | "address_region";
type SortOrder = "asc" | "desc";

const STATUS_LABEL: Record<string, string> = {
  active: "??銝?,
  changed: "撌脩??,
  dissolved: "撌脰圾??,
  suspended: "?平銝?,
};

const STATUS_CLASS: Record<string, string> = {
  active: "status-active",
  changed: "status-changed",
  dissolved: "status-dissolved",
  suspended: "status-suspended",
};

// Attribution scope matches components/Footer.tsx's precedent: the 6
// data.gov.tw open-data datasets carry the required ?踹?鞈????璇狡
// credit line. gcis_daily_setup_query is a live GCIS query API, not one
// of those 6 licensed batch datasets, so it's excluded here the same way
// Footer.tsx excludes it - unverified against GCIS's own terms, flagged
// in this session's notes for a human check.
const ATTRIBUTION_NAME_ZH: Record<string, string> = Object.fromEntries(
  DATASET_SOURCES.filter((s) => s.id !== "gcis_daily_setup_query").map((s) => [
    s.id,
    s.nameZh,
  ])
);
const ATTRIBUTION_AGENCY = "蝬??典?璆剔撅蔡";

function parseSort(value: string | undefined): SortKey {
  if (value === "capital" || value === "address_region") return value;
  return "registration_date";
}

function parseOrder(value: string | undefined): SortOrder {
  return value === "asc" ? "asc" : "desc";
}

function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

async function fetchPage(
  sql: ReturnType<typeof db>,
  searchId: string,
  sort: SortKey,
  order: SortOrder,
  limit: number,
  offset: number
) {
  const key = `${sort}_${order}`;
  switch (key) {
    case "registration_date_asc":
      return sql`
        SELECT c.*, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
        ORDER BY c.registration_date ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
    case "capital_desc":
      return sql`
        SELECT c.*, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
        ORDER BY c.capital DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
    case "capital_asc":
      return sql`
        SELECT c.*, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
        ORDER BY c.capital ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
    case "address_region_desc":
      return sql`
        SELECT c.*, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
        ORDER BY c.address_region DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
    case "address_region_asc":
      return sql`
        SELECT c.*, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
        ORDER BY c.address_region ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
    case "registration_date_desc":
    default:
      return sql`
        SELECT c.*, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
        ORDER BY c.registration_date DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
  }
}

function mapsUrl(name: string, address: string | null) {
  const query = encodeURIComponent(`${name} ${address ?? ""}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function sortLink(
  base: string,
  key: SortKey,
  currentSort: SortKey,
  currentOrder: SortOrder,
  label: string
) {
  const nextOrder: SortOrder =
    currentSort === key && currentOrder === "desc" ? "asc" : "desc";
  const indicator =
    currentSort === key ? (currentOrder === "desc" ? " ?? : " ??) : "";
  return (
    <Link
      href={`${base}?sort=${key}&order=${nextOrder}`}
      className="hover:underline whitespace-nowrap"
    >
      {label}
      {indicator}
    </Link>
  );
}

export default async function SearchResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; sort?: string; order?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/login");
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id;
  if (!userId) {
    redirect("/login");
  }

  // RLS (saved_searches_isolation) means this only returns a row if the
  // search actually belongs to the signed-in user.
  const searches = await withUserContext(userId, (sqlClient) =>
    sqlClient`SELECT id, name FROM saved_searches WHERE id = ${id}`
  );
  const savedSearch = searches[0];
  if (!savedSearch) {
    redirect("/searches/new");
  }

  const sort = parseSort(sp.sort);
  const order = parseOrder(sp.order);
  const page = parsePage(sp.page);
  const offset = (page - 1) * PAGE_SIZE;

  const rows = (await fetchPage(
    sql,
    id,
    sort,
    order,
    PAGE_SIZE,
    offset
  )) as (Company & { total_count: string })[];

  const totalMatches = rows[0] ? Number(rows[0].total_count) : 0;
  const totalPages = Math.max(1, Math.ceil(totalMatches / PAGE_SIZE));

  // General "data last updated" line - most recent successful run, any dataset.
  const lastGoodRuns = await sql`
    SELECT completed_at FROM ingestion_runs
    WHERE status = 'success'
    ORDER BY completed_at DESC
    LIMIT 1
  `;
  const lastGoodAt = lastGoodRuns[0]?.completed_at as string | undefined;
  const daysSinceLastGood = lastGoodAt
    ? Math.floor((Date.now() - new Date(lastGoodAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isStale = daysSinceLastGood !== null && daysSinceLastGood > STALE_AFTER_DAYS;

  // Per-row dissolved/suspended badges need their OWN recency, sourced from
  // that row's specific source_dataset - not the general line above, since
  // ?平甇平?餉?皜? runs ~2 months behind the others (see blueprint Section 11).
  const flaggedDatasets = Array.from(
    new Set(
      rows
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

  // Attribution scoped to only the datasets actually represented on this page.
  const displayedDatasetIds = Array.from(
    new Set(rows.map((r) => r.source_dataset).filter((d): d is string => !!d))
  );
  const attributionDatasets: AttributionDataset[] = displayedDatasetIds
    .filter((id) => ATTRIBUTION_NAME_ZH[id])
    .map((id) => ({
      agency: ATTRIBUTION_AGENCY,
      name: ATTRIBUTION_NAME_ZH[id],
      year: new Date().getFullYear().toString(),
    }));

  const basePath = `/searches/${id}`;

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
        <h1 className="text-xl font-bold">{savedSearch.name}</h1>
        <RunNowButton searchId={id} />
      </div>

      <p
        className={`text-xs mb-6 ${isStale ? "status-changed font-medium" : "text-secondary"}`}
      >
        鞈??湔?交?嚗lastGoodAt ? formatDate(lastGoodAt) : "撠鞈?"}
        {isStale && "嚗歇頞????湔?望?嚗???賭??舀??堆?"}
      </p>

      {totalMatches === 0 ? (
        <p className="text-secondary text-sm py-12 text-center">
          ?桀?瘝?蝚血?璇辣????蝔??岫?矽?湔?撠?隞嗚?        </p>
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-default text-left">
                  <th className="py-2 pr-4">?迂</th>
                  <th className="pr-4">蝯曹?蝺刻?</th>
                  <th className="pr-4">
                    {sortLink(basePath, "registration_date", sort, order, "?餉??交?")}
                  </th>
                  <th className="pr-4">
                    {sortLink(basePath, "address_region", sort, order, "?啣?")}
                  </th>
                  <th className="pr-4">鞎痊鈭?/th>
                  <th className="pr-4">
                    {sortLink(basePath, "capital", sort, order, "鞈憿?)}
                  </th>
                  <th className="pr-4">???/th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const freshAt = c.source_dataset
                    ? datasetFreshness.get(c.source_dataset)
                    : undefined;
                  return (
                    <tr key={c.uniform_id} className="border-b border-default align-top">
                      <td className="py-2 pr-4">{c.name}</td>
                      <td className="pr-4 font-numeric">{c.uniform_id}</td>
                      <td className="pr-4 font-numeric">{formatDate(c.registration_date)}</td>
                      <td className="pr-4">
                        {c.address_region ?? "\u2014"}
                        <div className="text-secondary text-xs">{c.address_raw ?? ""}</div>
                      </td>
                      <td className="pr-4">{c.responsible_person ?? "\u2014"}</td>
                      <td className="pr-4 font-numeric">{formatCapital(c.capital)}</td>
                      <td className="pr-4">
                        <span className={STATUS_CLASS[c.status] ?? ""}>
                          {STATUS_LABEL[c.status] ?? c.status}
                        </span>
                        {(c.status === "dissolved" || c.status === "suspended") && freshAt && (
                          <div className="text-secondary text-xs">
                            鞈?靘??湔?潘?{formatDate(freshAt)}
                          </div>
                        )}
                      </td>
                      <td>
                        <a
                          href={mapsUrl(c.name, c.address_raw)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs hover:underline"
                          style={{ color: "var(--accent)" }}
                        >
                          Google ?啣??亥岷
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards, never a horizontally-scrolling table */}
          <div className="md:hidden space-y-3">
            {rows.map((c) => {
              const freshAt = c.source_dataset
                ? datasetFreshness.get(c.source_dataset)
                : undefined;
              return (
                <div
                  key={c.uniform_id}
                  className="bg-card border border-default rounded-lg p-4"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="font-medium">{c.name}</span>
                    <span className={`text-xs whitespace-nowrap ${STATUS_CLASS[c.status] ?? ""}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </div>
                  <div className="text-xs text-secondary space-y-1">
                    <div>蝯曹?蝺刻?嚗c.uniform_id}</div>
                    <div>?餉??交?嚗formatDate(c.registration_date)}</div>
                    <div>
                      ?啣?嚗c.address_region ?? "\u2014"} {c.address_raw ?? ""}
                    </div>
                    <div>鞎痊鈭綽?{c.responsible_person ?? "\u2014"}</div>
                    <div>鞈憿?{formatCapital(c.capital)}</div>
                    {(c.status === "dissolved" || c.status === "suspended") && freshAt && (
                      <div>鞈?靘??湔?潘?{formatDate(freshAt)}</div>
                    )}
                  </div>
                  <a
                    href={mapsUrl(c.name, c.address_raw)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs hover:underline mt-2 inline-block"
                    style={{ color: "var(--accent)" }}
                  >
                    Google ?啣??亥岷
                  </a>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-6 text-sm">
            <span className="text-secondary">
              蝚?{page} ????{totalPages} ??{totalMatches} 蝑???
            </span>
            <div className="flex gap-3">
              {page > 1 && (
                <Link
                  href={`${basePath}?page=${page - 1}&sort=${sort}&order=${order}`}
                  className="hover:underline"
                >
                  銝???                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`${basePath}?page=${page + 1}&sort=${sort}&order=${order}`}
                  className="hover:underline"
                >
                  銝???                </Link>
              )}
            </div>
          </div>
        </>
      )}

      {attributionDatasets.length > 0 && (
        <div className="mt-8 pt-4 border-t border-default">
          <DataAttribution datasets={attributionDatasets} />
        </div>
      )}
    </div>
  );
}

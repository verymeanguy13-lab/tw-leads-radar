import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";
import { formatCapital, formatDate } from "@/lib/utils";
import { ATTRIBUTION_AGENCY, ATTRIBUTION_NAME_ZH } from "@/lib/attribution";
import DataAttribution, { AttributionDataset } from "@/components/DataAttribution";
import RunNowButton from "@/components/RunNowButton";
import ExportCsvButton from "@/components/ExportCsvButton";
import DeleteSearchButton from "@/components/DeleteSearchButton";
import PauseSearchButton from "@/components/PauseSearchButton";
import { getUserTier } from "@/lib/tiers";
import type { Company } from "@/types/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const STALE_AFTER_DAYS = 42; // ~6 weeks

type SortKey = "registration_date" | "capital" | "address_region";
type SortOrder = "asc" | "desc";

const STATUS_LABEL: Record<string, string> = {
  active: "營運中",
  changed: "已異動",
  dissolved: "已解散",
  suspended: "停業中",
};

const STATUS_CLASS: Record<string, string> = {
  active: "status-active",
  changed: "status-changed",
  dissolved: "status-dissolved",
  suspended: "status-suspended",
};

// Attribution constants now shared via lib/attribution.ts (see that
// file's comment - this used to be defined locally here, duplicated
// with slightly different naming in the CSV export route, until
// consolidated 2026-08-30).

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

// Freshness-tier gating (same rule and rationale as
// lib/matching/engine.ts's matchSearch(): free tier only sees
// entity_type='company' rows once companies.created_at is 30+ days old;
// entity_type='business' rows are exempt since they're monthly-cadence
// for every tier already. matchSearch() only ever INSERTS into
// search_matches (ON CONFLICT DO NOTHING) and never deletes, so a row
// that matched before this gate existed - or before a user's tier
// changed - can still be sitting in search_matches. This read-time
// condition is the actual enforcement boundary for what a user sees;
// the write-time gate in matchSearch() just keeps that table from
// growing rows a free user should never see in the first place.
async function fetchPage(
  sql: ReturnType<typeof db>,
  searchId: string,
  isFreeTier: boolean,
  sort: SortKey,
  order: SortOrder,
  limit: number,
  offset: number
) {
  const gated = isFreeTier;
  const key = `${sort}_${order}`;
  switch (key) {
    case "registration_date_asc":
      return sql`
        SELECT c.*, sm.matched_at, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
          AND (c.entity_type = 'business' OR ${!gated} OR COALESCE(c.registration_date, c.created_at::date) <= (now() - interval '30 days')::date)
          AND c.suppressed_at IS NULL
        ORDER BY c.registration_date ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
    case "capital_desc":
      return sql`
        SELECT c.*, sm.matched_at, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
          AND (c.entity_type = 'business' OR ${!gated} OR COALESCE(c.registration_date, c.created_at::date) <= (now() - interval '30 days')::date)
          AND c.suppressed_at IS NULL
        ORDER BY c.capital DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
    case "capital_asc":
      return sql`
        SELECT c.*, sm.matched_at, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
          AND (c.entity_type = 'business' OR ${!gated} OR COALESCE(c.registration_date, c.created_at::date) <= (now() - interval '30 days')::date)
          AND c.suppressed_at IS NULL
        ORDER BY c.capital ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
    case "address_region_desc":
      return sql`
        SELECT c.*, sm.matched_at, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
          AND (c.entity_type = 'business' OR ${!gated} OR COALESCE(c.registration_date, c.created_at::date) <= (now() - interval '30 days')::date)
          AND c.suppressed_at IS NULL
        ORDER BY c.address_region DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
    case "address_region_asc":
      return sql`
        SELECT c.*, sm.matched_at, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
          AND (c.entity_type = 'business' OR ${!gated} OR COALESCE(c.registration_date, c.created_at::date) <= (now() - interval '30 days')::date)
          AND c.suppressed_at IS NULL
        ORDER BY c.address_region ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
    case "registration_date_desc":
    default:
      return sql`
        SELECT c.*, sm.matched_at, count(*) OVER() AS total_count
        FROM search_matches sm
        JOIN companies c ON c.uniform_id = sm.company_uniform_id
        WHERE sm.saved_search_id = ${searchId}
          AND (c.entity_type = 'business' OR ${!gated} OR COALESCE(c.registration_date, c.created_at::date) <= (now() - interval '30 days')::date)
          AND c.suppressed_at IS NULL
        ORDER BY c.registration_date DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `;
  }
}

function mapsUrl(name: string, address: string | null) {
  const query = encodeURIComponent(`${name} ${address ?? ""}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

// Session 17: flags a company whose status has changed to dissolved or
// changed AFTER it first matched this saved_search - i.e. it looked
// different (usually active) when the user first saw it. Distinct from
// the existing dissolved/suspended freshness note above, which is about
// data-source recency, not "this changed since you started tracking it."
function isChangedSinceMatched(c: Company & { matched_at: string }): boolean {
  if (c.status !== "dissolved" && c.status !== "changed") return false;
  if (!c.status_updated_at || !c.matched_at) return false;
  return new Date(c.status_updated_at) > new Date(c.matched_at);
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
    currentSort === key ? (currentOrder === "desc" ? " ▼" : " ▲") : "";
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
    sqlClient`SELECT id, name, industry_codes, paused FROM saved_searches WHERE id = ${id}`
  );
  const savedSearch = searches[0];
  if (!savedSearch) {
    redirect("/searches/new");
  }

  const sort = parseSort(sp.sort);
  const order = parseOrder(sp.order);
  const page = parsePage(sp.page);
  const offset = (page - 1) * PAGE_SIZE;

  const tier = await getUserTier(userId);
  const isFreeTier = tier === "free";

  const rows = (await fetchPage(
    sql,
    id,
    isFreeTier,
    sort,
    order,
    PAGE_SIZE,
    offset
  )) as (Company & { total_count: string; matched_at: string })[];

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
  // 商業歇業登記清冊 runs ~2 months behind the others (see blueprint Section 11).
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
        <ExportCsvButton searchId={id} />
        <PauseSearchButton searchId={id} paused={savedSearch.paused} />
        <DeleteSearchButton searchId={id} searchName={savedSearch.name} />
      </div>

      <p
        className={`text-xs mb-6 ${isStale ? "status-changed font-medium" : "text-secondary"}`}
      >
        資料更新日期：{lastGoodAt ? formatDate(lastGoodAt) : "尚無資料"}
        {isStale && "（已超過預期更新週期，資料可能不是最新）"}
      </p>

      {savedSearch.industry_codes && savedSearch.industry_codes.length > 0 && (
        <p className="text-xs text-secondary mb-6">
          {"提醒：少數較舊、尚未完成行業別分類之公司資料，將隨後續資料更新逐步補齊，暫時不會出現在此篩選結果中。"}
        </p>
      )}

      {/* 2026-09-03: reworded from a generic "no results, try adjusting
          your criteria" message. Creating a saved search (POST
          /api/searches) never itself runs matchSearch() - a brand new
          search sits at zero rows in search_matches until the user
          clicks "立即執行" or the next scheduled matchAllSearches() run,
          so the old wording was actively misleading for the single most
          common way to land here (right after creating a search) - it
          implied the filters themselves were the problem. There's no
          column yet distinguishing "never matched" from "matched, truly
          zero" (would need e.g. a last_matched_at on saved_searches), so
          this can't branch on that - the new wording is just written to
          be true and actionable either way. */}
      {totalMatches === 0 ? (
        <p className="text-secondary text-sm py-12 text-center">
          目前沒有符合條件的結果。若這是剛建立的搜尋條件，請點擊上方「立即執行」按鈕進行比對；系統也會在每次資料更新時自動為您比對。
        </p>
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-default text-left">
                  <th className="py-2 pr-4">名稱</th>
                  <th className="pr-4">統一編號</th>
                  <th className="pr-4">
                    {sortLink(basePath, "registration_date", sort, order, "登記日期")}
                  </th>
                  <th className="pr-4">
                    {sortLink(basePath, "address_region", sort, order, "地址")}
                  </th>
                  <th className="pr-4">負責人</th>
                  <th className="pr-4">
                    {sortLink(basePath, "capital", sort, order, "資本額")}
                  </th>
                  <th className="pr-4">狀態</th>
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
                            資料來源更新於：{formatDate(freshAt)}
                          </div>
                        )}
                        {isChangedSinceMatched(c) && (
                          <div className="status-changed text-xs font-medium mt-0.5">
                            ⚠ 狀態自加入追蹤後已變更
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
                          Google 地圖查詢
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
                  {isChangedSinceMatched(c) && (
                    <div className="status-changed text-xs font-medium mb-2">
                      ⚠ 狀態自加入追蹤後已變更
                    </div>
                  )}
                  <div className="text-xs text-secondary space-y-1">
                    <div>統一編號：{c.uniform_id}</div>
                    <div>登記日期：{formatDate(c.registration_date)}</div>
                    <div>
                      地址：{c.address_region ?? "\u2014"} {c.address_raw ?? ""}
                    </div>
                    <div>負責人：{c.responsible_person ?? "\u2014"}</div>
                    <div>資本額：{formatCapital(c.capital)}</div>
                    {(c.status === "dissolved" || c.status === "suspended") && freshAt && (
                      <div>資料來源更新於：{formatDate(freshAt)}</div>
                    )}
                  </div>
                  <a
                    href={mapsUrl(c.name, c.address_raw)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs hover:underline mt-2 inline-block"
                    style={{ color: "var(--accent)" }}
                  >
                    Google 地圖查詢
                  </a>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-6 text-sm">
            <span className="text-secondary">
              第 {page} 頁，共 {totalPages} 頁（{totalMatches} 筆結果）
            </span>
            <div className="flex gap-3">
              {page > 1 && (
                <Link
                  href={`${basePath}?page=${page - 1}&sort=${sort}&order=${order}`}
                  className="hover:underline"
                >
                  上一頁
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`${basePath}?page=${page + 1}&sort=${sort}&order=${order}`}
                  className="hover:underline"
                >
                  下一頁
                </Link>
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
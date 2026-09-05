import Link from "next/link";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUserTier } from "@/lib/tiers";
import { checkSearchRateLimit } from "@/lib/rate-limit";
import { formatCapital, formatDate } from "@/lib/utils";
import { maskUniformId, maskCompanyName, maskPersonName } from "@/lib/masking";
import SaveSearchButton from "@/components/SaveSearchButton";
import type { Company } from "@/types/db";

export const dynamic = "force-dynamic";

const REGIONS = [
  "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
  "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
  "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
  "臺東縣", "澎湖縣", "金門縣", "連江縣",
];

// Same 11-category GCIS taxonomy as app/(app)/searches/new/page.tsx -
// duplicated here rather than imported, matching how REGIONS is already
// duplicated across this codebase (that file, this one, and the admin
// prospects page each keep their own copy).
const INDUSTRY_CODES = [
  { code: "A", label: "農、林、漁、牧業" },
  { code: "B", label: "礦業及土石採取業" },
  { code: "C", label: "製造業" },
  { code: "D", label: "水電燃氣業" },
  { code: "E", label: "營造及工程業" },
  { code: "F", label: "零售、批發及餐飲業" },
  { code: "G", label: "運輸、倉儲及通信業" },
  { code: "H", label: "金融、保險及不動產業" },
  { code: "I", label: "專業、科學及技術服務業" },
  { code: "J", label: "文化、運動、休閒及其他服務業" },
  { code: "Z", label: "其他未分類業" },
];

const ENTITY_TYPE_OPTIONS = [
  { value: "both", label: "不限" },
  { value: "company", label: "僅公司" },
  { value: "business", label: "僅商業（獨資合夥）" },
];

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

interface Filters {
  keyword: string;
  regions: string[];
  industryCodes: string[];
  capitalMin: number | null;
  capitalMax: number | null;
  entityType: "company" | "business" | "both";
}

// Public search, open to anyone - no login required. Revised several
// times the same day after user feedback; this is the current shape:
//
//   1. Tier-based, not login-based, masking: anonymous visitors AND
//      free-tier logged-in accounts both see masked results; pro/
//      business accounts see complete, unmasked results. Mirrors the
//      tier check every other read path already does
//      (lib/matching/engine.ts's matchSearch(), searches/[id]'s
//      fetchPage()).
//   2. IP-based rate limiting (lib/rate-limit.ts) for anonymous
//      requests only - logged-in visitors of any tier are exempt,
//      already accountable via their account.
//   3. 2026-09-05, same day: this page originally only had two filters
//      (keyword + a single region), while the authenticated saved-
//      search form (/searches/new) has five (industry codes, regions
//      plural, capital min/max, entity type, keyword). The user pointed
//      out anonymous visitors should be able to "set conditions like
//      everyone else" - so this page's filter set now matches
//      /searches/new's exactly, and the underlying query mirrors
//      lib/matching/engine.ts's matchSearch() field-for-field (industry
//      overlap via &&, regions via ANY, capital range, entity type,
//      keyword ILIKE) instead of the old two-field version.
//   4. Also added the same day: a "儲存此搜尋條件，每月通知我" button,
//      visible only when logged in (any tier), that POSTs the exact
//      filters just searched to POST /api/searches with cadence=
//      "monthly" and redirects to the new saved search's results page.
//      This is the bridge the user asked for - "free tier users has to
//      log in to get free monthly notifications" - without duplicating
//      the full /searches/new form here. Anonymous visitors see a plain
//      login/signup prompt instead, since there's no account to attach
//      a saved search to.
//
// Unchanged since earlier versions:
//   - No saved_searches / search_matches read here - this function is a
//     direct, capped SELECT against companies. Saving (above) goes
//     through the existing POST /api/searches route, not a new one.
//   - At least one filter must be set (keyword of 2+ characters, a
//     region, an industry code, or a capital bound) before the query
//     runs at all - an empty form renders only the form, never a
//     "browse everything" listing.
//   - Hard-capped at 20 rows, no pagination.
//   - Freshness gate mirrors the tier exactly: entity_type='company'
//     rows need registration_date 30+ days old UNLESS the visitor is on
//     a paid tier; entity_type='business' is exempt at every tier.
//   - suppressed_at IS NULL always, regardless of tier.
//   - Masking is applied only when NOT on a paid tier, inside this same
//     Server Component, before the row is ever put into the returned
//     markup. There's no separate API route that could be called to
//     fetch the unmasked row directly.
async function runSearch(filters: Filters, gated: boolean) {
  const sql = db();
  const keywordPattern = filters.keyword.length >= 2 ? `%${filters.keyword}%` : null;

  const rows = await sql`
    SELECT uniform_id, entity_type, name, capital, address_region,
           responsible_person, registration_date, status
    FROM companies
    WHERE (${filters.regions.length === 0} OR address_region = ANY(${filters.regions}))
      AND (${filters.entityType === "both"} OR entity_type = ${filters.entityType})
      AND (${filters.capitalMin === null} OR capital >= ${filters.capitalMin})
      AND (${filters.capitalMax === null} OR capital <= ${filters.capitalMax})
      AND (${keywordPattern === null} OR name ILIKE ${keywordPattern})
      AND (${filters.industryCodes.length === 0} OR industry_codes && ${filters.industryCodes}::text[])
      AND (
        entity_type = 'business'
        OR ${!gated}
        OR COALESCE(registration_date, created_at::date) <= (now() - interval '30 days')::date
      )
      AND suppressed_at IS NULL
    ORDER BY registration_date DESC NULLS LAST
    LIMIT 20
  `;

  return rows as unknown as Pick<
    Company,
    | "uniform_id"
    | "entity_type"
    | "name"
    | "capital"
    | "address_region"
    | "responsible_person"
    | "registration_date"
    | "status"
  >[];
}

interface ViewerState {
  isLoggedIn: boolean;
  isPaid: boolean;
}

async function resolveViewerState(): Promise<ViewerState> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { isLoggedIn: false, isPaid: false };

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) return { isLoggedIn: true, isPaid: false };

  const tier = await getUserTier(userId);
  return { isLoggedIn: true, isPaid: tier === "pro" || tier === "business" };
}

// Vercel (and most reverse proxies) set x-forwarded-for to a comma-
// separated list, client IP first, when they forward a request - see
// https://vercel.com/docs/edge-network/headers#x-forwarded-for. Falls
// back to x-real-ip, then to a literal "unknown" that
// checkSearchRateLimit() treats as fail-open rather than block-everyone.
async function resolveClientIp(): Promise<string> {
  const hdrs = await headers();
  const forwardedFor = hdrs.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return hdrs.get("x-real-ip") ?? "unknown";
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toNullableNumber(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default async function PublicSearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    regions?: string | string[];
    industry_codes?: string | string[];
    capital_min?: string;
    capital_max?: string;
    entity_type?: string;
  }>;
}) {
  const sp = await searchParams;

  const filters: Filters = {
    keyword: sp.q?.trim() ?? "",
    regions: toArray(sp.regions),
    industryCodes: toArray(sp.industry_codes),
    capitalMin: toNullableNumber(sp.capital_min),
    capitalMax: toNullableNumber(sp.capital_max),
    entityType:
      sp.entity_type === "company" || sp.entity_type === "business" ? sp.entity_type : "both",
  };

  const hasFilters =
    filters.keyword.length >= 2 ||
    filters.regions.length > 0 ||
    filters.industryCodes.length > 0 ||
    filters.capitalMin !== null ||
    filters.capitalMax !== null;

  const { isLoggedIn, isPaid } = await resolveViewerState();

  let results: Awaited<ReturnType<typeof runSearch>> = [];
  let rateLimited = false;
  let retryAfterMinutes = 0;

  if (hasFilters) {
    if (isLoggedIn) {
      // Accountable via their own account already - no IP check needed.
      results = await runSearch(filters, !isPaid);
    } else {
      const ip = await resolveClientIp();
      const rateLimit = await checkSearchRateLimit(ip);
      if (rateLimit.allowed) {
        results = await runSearch(filters, true);
      } else {
        rateLimited = true;
        retryAfterMinutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
      }
    }
  }

  // Auto-generated name for a search saved from this page - there's no
  // "name this search" field here (adding one would mean asking for it
  // before showing results, which defeats the point of a quick ad hoc
  // search). Falls back to a date-stamped placeholder when nothing
  // distinguishing was entered; either way it can only be renamed by
  // deleting and recreating the search today, same limitation the
  // authenticated /searches/new form already has.
  const savedSearchName =
    filters.keyword ||
    (filters.regions.length > 0 ? filters.regions.join("、") : "") ||
    `未命名搜尋 ${new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}`;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-2">查詢公司登記資料</h1>
      {isPaid ? (
        <p className="text-sm text-secondary mb-6">不需登入即可查詢。您的帳號為付費方案，以下顯示完整未遮蔽資料。</p>
      ) : (
        <p className="text-sm text-secondary mb-6">
          {
            "不需登入即可查詢，篩選條件與付費會員相同——為保護當事人隱私，搜尋結果中的統一編號、公司名稱與負責人姓名會部分遮蔽。升級"
          }
          <Link href="/pricing" className="underline">
            {"付費方案"}
          </Link>
          {"即可看到完整資料。"}
        </p>
      )}

      <form method="get" className="space-y-4 mb-6 border-b border-default pb-6">
        <div>
          <label className="block text-xs text-secondary mb-1">公司名稱關鍵字</label>
          <input
            type="text"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="選填，至少 2 個字才會套用"
            className="w-full max-w-sm border rounded px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          />
        </div>

        <div>
          <label className="block text-xs text-secondary mb-1">行業別</label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-sm">
            {INDUSTRY_CODES.map((ind) => (
              <label key={ind.code} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="industry_codes"
                  value={ind.code}
                  defaultChecked={filters.industryCodes.includes(ind.code)}
                />
                {ind.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-secondary mb-1">地區</label>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-1 text-sm max-h-40 overflow-y-auto">
            {REGIONS.map((r) => (
              <label key={r} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="regions"
                  value={r}
                  defaultChecked={filters.regions.includes(r)}
                />
                {r}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <div>
            <label className="block text-xs text-secondary mb-1">最低資本額</label>
            <input
              type="number"
              min={0}
              name="capital_min"
              defaultValue={sp.capital_min ?? ""}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">最高資本額</label>
            <input
              type="number"
              min={0}
              name="capital_max"
              defaultValue={sp.capital_max ?? ""}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-secondary mb-1">公司／商業類型</label>
          <div className="flex gap-4 text-sm">
            {ENTITY_TYPE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="entity_type"
                  value={opt.value}
                  defaultChecked={filters.entityType === opt.value}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="px-4 py-2 rounded text-sm text-white"
          style={{ backgroundColor: "var(--accent)" }}
        >
          查詢
        </button>
      </form>

      {!hasFilters && (
        <p className="text-sm text-secondary">請至少輸入關鍵字（2 個字以上）或選擇一項篩選條件以開始查詢。</p>
      )}

      {hasFilters && rateLimited && (
        <p className="text-sm text-secondary">
          {`查詢次數過多，請約 ${retryAfterMinutes} 分鐘後再試。`}
          <Link href="/signup" className="underline">
            {"免費註冊"}
          </Link>
          {"登入後可不受此限制繼續查詢。"}
        </p>
      )}

      {hasFilters && !rateLimited && results.length === 0 && (
        <p className="text-sm text-secondary">找不到符合條件的公司。</p>
      )}

      {hasFilters && !rateLimited && results.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                  <th className="py-2 pr-4">統一編號</th>
                  <th className="py-2 pr-4">公司名稱</th>
                  <th className="py-2 pr-4">縣市</th>
                  <th className="py-2 pr-4">負責人</th>
                  <th className="py-2 pr-4">資本額</th>
                  <th className="py-2 pr-4">登記日期</th>
                  <th className="py-2 pr-4">狀態</th>
                </tr>
              </thead>
              <tbody>
                {results.map((c) => (
                  <tr key={c.uniform_id} className="border-b" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2 pr-4 font-mono">
                      {isPaid ? c.uniform_id : maskUniformId(c.uniform_id)}
                    </td>
                    <td className="py-2 pr-4">{isPaid ? c.name : maskCompanyName(c.name)}</td>
                    <td className="py-2 pr-4">{c.address_region ?? "-"}</td>
                    <td className="py-2 pr-4">
                      {(isPaid ? c.responsible_person : maskPersonName(c.responsible_person)) ?? "-"}
                    </td>
                    <td className="py-2 pr-4">{formatCapital(c.capital)}</td>
                    <td className="py-2 pr-4">{formatDate(c.registration_date)}</td>
                    <td className={`py-2 pr-4 ${STATUS_CLASS[c.status] ?? ""}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            {isLoggedIn ? (
              <SaveSearchButton
                filters={{
                  name: savedSearchName.slice(0, 100),
                  industry_codes: filters.industryCodes,
                  regions: filters.regions,
                  capital_min: filters.capitalMin,
                  capital_max: filters.capitalMax,
                  entity_type: filters.entityType,
                  keyword: filters.keyword,
                }}
              />
            ) : (
              <p className="text-xs text-secondary">
                {"想在有新公司符合這些條件時收到通知？"}
                <Link href="/login" className="underline">
                  {"登入"}
                </Link>
                {"或"}
                <Link href="/signup" className="underline">
                  {"免費註冊"}
                </Link>
                {"後即可儲存此搜尋條件，每月為您寄送摘要。"}
              </p>
            )}
          </div>

          {!isPaid && (
            <p className="text-xs text-secondary mt-2">
              {"僅顯示前 20 筆結果。升級"}
              <Link href="/pricing" className="underline">
                {"付費方案"}
              </Link>
              {"可查看完整未遮蔽資料、儲存多組搜尋條件、匯出 CSV，並選擇更頻繁的通知頻率。"}
            </p>
          )}
        </>
      )}
    </div>
  );
}

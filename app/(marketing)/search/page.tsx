import Link from "next/link";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUserTier } from "@/lib/tiers";
import { checkSearchRateLimit } from "@/lib/rate-limit";
import { formatCapital, formatDate } from "@/lib/utils";
import { maskUniformId, maskCompanyName, maskPersonName } from "@/lib/masking";
import type { Company } from "@/types/db";

export const dynamic = "force-dynamic";

const REGIONS = [
  "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
  "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
  "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
  "臺東縣", "澎湖縣", "金門縣", "連江縣",
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

// Public search, open to anyone - no login required (2026-09-05, per
// user request to make the site "more open"). Revised twice the same
// day after user feedback:
//
//   1. First version always masked every visitor regardless of who they
//      were. Fixed - the actual requirement is tier-based, not
//      login-based: anonymous visitors AND free-tier logged-in accounts
//      both see masked results; pro/business accounts see complete,
//      unmasked results, on this exact page. Mirrors the tier check
//      every other read path already does (lib/matching/engine.ts's
//      matchSearch(), searches/[id]'s fetchPage()).
//   2. This page had no rate-limiting at all - the only anti-scraping
//      controls were the 2-character minimum and the 20-row cap. Added
//      lib/rate-limit.ts, an IP-based limit backed by a Postgres table
//      (see that file's comment for why DB-backed, not in-memory).
//      Logged-in visitors of any tier are exempt from this IP check -
//      they're already accountable via their account, and the point is
//      to slow down anonymous scraping specifically, not to throttle a
//      paying customer testing their own searches.
//
// Other rules, unchanged since the first version:
//   - No saved_searches / search_matches involved - this is a direct,
//     capped SELECT against companies, not the saved/monitored-search
//     feature (that stays exactly as it was, unaffected by this page).
//   - Requires a keyword of at least 2 characters before querying at all
//     - an empty or 1-character query renders the form only, never a
//     "browse everything" listing.
//   - Freshness gate mirrors the tier exactly: entity_type='company'
//     rows need registration_date 30+ days old UNLESS the visitor is on
//     a paid tier; entity_type='business' is exempt at every tier, same
//     carve-out as everywhere else.
//   - suppressed_at IS NULL always, regardless of tier.
//   - Masking (lib/masking.ts) is applied only when the visitor is NOT
//     on a paid tier, inside this same Server Component, before the row
//     is ever put into the returned markup. There's no separate API
//     route that could be called to fetch the unmasked row directly.
async function runSearch(keyword: string, region: string | null, gated: boolean) {
  const sql = db();
  const pattern = `%${keyword}%`;

  const rows = await sql`
    SELECT uniform_id, entity_type, name, capital, address_region,
           responsible_person, registration_date, status
    FROM companies
    WHERE name ILIKE ${pattern}
      AND (${region === null} OR address_region = ${region})
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

export default async function PublicSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; region?: string }>;
}) {
  const sp = await searchParams;
  const keyword = sp.q?.trim() ?? "";
  const region = sp.region?.trim() || null;
  const hasQuery = keyword.length >= 2;

  const { isLoggedIn, isPaid } = await resolveViewerState();

  let results: Awaited<ReturnType<typeof runSearch>> = [];
  let rateLimited = false;
  let retryAfterMinutes = 0;

  if (hasQuery) {
    if (isLoggedIn) {
      // Accountable via their own account already - no IP check needed.
      results = await runSearch(keyword, region, !isPaid);
    } else {
      const ip = await resolveClientIp();
      const rateLimit = await checkSearchRateLimit(ip);
      if (rateLimit.allowed) {
        results = await runSearch(keyword, region, true);
      } else {
        rateLimited = true;
        retryAfterMinutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
      }
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-2">查詢公司登記資料</h1>
      {isPaid ? (
        <p className="text-sm text-secondary mb-6">不需登入即可查詢。您的帳號為付費方案，以下顯示完整未遮蔽資料。</p>
      ) : (
        <p className="text-sm text-secondary mb-6">
          {
            "不需登入即可查詢。為保護當事人隱私，搜尋結果中的統一編號、公司名稱與負責人姓名會部分遮蔽——升級"
          }
          <Link href="/pricing" className="underline">
            {"付費方案"}
          </Link>
          {"即可看到完整資料。"}
        </p>
      )}

      <form method="get" className="flex flex-wrap items-end gap-4 mb-6">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-secondary mb-1">公司名稱關鍵字</label>
          <input
            type="text"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="至少輸入 2 個字"
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          />
        </div>
        <div>
          <label className="block text-xs text-secondary mb-1">縣市</label>
          <select
            name="region"
            defaultValue={region ?? ""}
            className="border rounded px-2 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">全部</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded text-sm text-white"
          style={{ backgroundColor: "var(--accent)" }}
        >
          查詢
        </button>
      </form>

      {!hasQuery && (
        <p className="text-sm text-secondary">請輸入至少 2 個字的公司名稱關鍵字以開始查詢。</p>
      )}

      {hasQuery && rateLimited && (
        <p className="text-sm text-secondary">
          {`查詢次數過多，請約 ${retryAfterMinutes} 分鐘後再試。`}
          <Link href="/signup" className="underline">
            {"免費註冊"}
          </Link>
          {"登入後可不受此限制繼續查詢。"}
        </p>
      )}

      {hasQuery && !rateLimited && results.length === 0 && (
        <p className="text-sm text-secondary">找不到符合條件的公司。</p>
      )}

      {hasQuery && !rateLimited && results.length > 0 && (
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
          {!isPaid && (
            <p className="text-xs text-secondary mt-4">
              {"僅顯示前 20 筆結果。升級"}
              <Link href="/pricing" className="underline">
                {"付費方案"}
              </Link>
              {"可查看完整未遮蔽資料、儲存搜尋條件、匯出 CSV，並在有新公司符合條件時收到通知。"}
            </p>
          )}
        </>
      )}
    </div>
  );
}

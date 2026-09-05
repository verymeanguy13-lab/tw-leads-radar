import Link from "next/link";
import { db } from "@/lib/db";
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

// Public, no-login preview search (added 2026-09-05, per user request to
// make the site "more open" - see architecture.md's 2026-09-05 entry).
//
// This page is deliberately NOT the authenticated /searches experience
// wired down to a lower tier - it's a separate, much narrower read path:
//
//   - No saved_searches / search_matches involved at all. Every request
//     just re-runs one direct, capped SELECT against companies.
//   - Requires a keyword of at least 2 characters before querying at all -
//     an empty or 1-character query renders the form only, never a
//     "browse everything" listing. This is the main anti-scraping control
//     available without adding new infrastructure (no rate-limiter exists
//     anywhere else in this codebase yet - see the LIMIT below as the
//     other half of that mitigation).
//   - Hard-capped at 20 rows, no pagination. A signed-up user (even free
//     tier) already gets a saved, re-run, paginated, CSV-exportable
//     version of this - this page is a taste, not a replacement.
//   - Always applies the SAME freshness gate the free tier gets
//     (entity_type='company' rows restricted to registration_date 30+
//     days old; entity_type='business' exempt, matching
///    lib/matching/engine.ts's matchSearch() and the searches/[id] results
//     page) - anonymous visitors never see data fresher than what a free
//     signed-up account already sees, so this doesn't undercut the
//     free-vs-paid freshness pitch. It only ever ADDS a restriction on
//     top of that (masking), never removes one.
//   - suppressed_at IS NULL, same as every other read path - a company
//     with an approved PDPA removal request must never resurface here.
//   - Masks uniform_id, name, and responsible_person via lib/masking.ts
//     BEFORE the row is ever put in this Server Component's returned
//     markup. There is no client-side masking step and no API route that
//     could be called directly for the unmasked row - the only server
//     boundary here is this page itself.
async function runSearch(keyword: string, region: string | null) {
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

export default async function PublicSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; region?: string }>;
}) {
  const sp = await searchParams;
  const keyword = sp.q?.trim() ?? "";
  const region = sp.region?.trim() || null;
  const hasQuery = keyword.length >= 2;

  const results = hasQuery ? await runSearch(keyword, region) : [];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-2">免費查詢公司登記資料</h1>
      <p className="text-sm text-secondary mb-6">
        {
          "不需登入即可查詢。為保護當事人隱私，搜尋結果中的統一編號、公司名稱與負責人姓名會部分遮蔽——"
        }
        <Link href="/signup" className="underline">
          {"免費註冊"}
        </Link>
        {"即可看到完整資料，並可建立自動追蹤與定期通知。"}
      </p>

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

      {hasQuery && results.length === 0 && (
        <p className="text-sm text-secondary">找不到符合條件的公司。</p>
      )}

      {hasQuery && results.length > 0 && (
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
                    <td className="py-2 pr-4 font-mono">{maskUniformId(c.uniform_id)}</td>
                    <td className="py-2 pr-4">{maskCompanyName(c.name)}</td>
                    <td className="py-2 pr-4">{c.address_region ?? "-"}</td>
                    <td className="py-2 pr-4">{maskPersonName(c.responsible_person) ?? "-"}</td>
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
          <p className="text-xs text-secondary mt-4">
            {"僅顯示前 20 筆結果。"}
            <Link href="/signup" className="underline">
              {"免費註冊"}
            </Link>
            {"可查看完整未遮蔽資料、儲存搜尋條件、匯出 CSV，並在有新公司符合條件時收到通知。"}
          </p>
        </>
      )}
    </div>
  );
}

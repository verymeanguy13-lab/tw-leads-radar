import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";
import { getUserTier, canCreateSavedSearch } from "@/lib/tiers";
import { formatDate } from "@/lib/utils";
import DeleteSearchButton from "@/components/DeleteSearchButton";
import PauseSearchButton from "@/components/PauseSearchButton";

export const dynamic = "force-dynamic";

const CADENCE_LABEL: Record<string, string> = {
  weekly: "每週",
  monthly: "每月",
  daily: "每日",
};

// This page did not exist before - /searches (the login redirect target,
// and the natural place to browse back to an existing saved search) had
// no route at all, only /searches/new and /searches/[id]. The only way
// to reach an existing search's results page was the one-time redirect
// right after creating it, or a link in a digest email if one had been
// sent. Every user, free or paid, was affected equally by this - it's
// not specific to the tier-limit case that surfaced it.
export default async function SearchesListPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/login");
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) {
    redirect("/login");
  }

  const [searches, tier, limitCheck] = await Promise.all([
    withUserContext(userId, (sqlClient) =>
      sqlClient`
        SELECT
          ss.id, ss.name, ss.cadence, ss.paused, ss.created_at,
          count(sm.id) AS match_count
        FROM saved_searches ss
        LEFT JOIN search_matches sm ON sm.saved_search_id = ss.id
        WHERE ss.user_id = ${userId}
        GROUP BY ss.id
        ORDER BY ss.created_at DESC
      `
    ),
    getUserTier(userId),
    canCreateSavedSearch(userId),
  ]);

  const rows = searches as {
    id: string;
    name: string;
    cadence: string;
    paused: boolean;
    created_at: string;
    match_count: string;
  }[];

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-xl font-bold">已儲存的搜尋條件</h1>
        {limitCheck.allowed ? (
          <Link
            href="/searches/new"
            className="px-4 py-2 rounded text-white text-sm"
            style={{ backgroundColor: "var(--accent)" }}
          >
            + 新增搜尋條件
          </Link>
        ) : (
          <div className="text-right">
            <span className="px-4 py-2 rounded text-sm text-secondary inline-block opacity-60">
              + 新增搜尋條件
            </span>
            <p className="text-xs text-secondary mt-1">
              {limitCheck.reason}
              {tier === "free" && (
                <>
                  {" "}
                  <Link href="/pricing" className="underline">
                    查看方案
                  </Link>
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-secondary text-sm">
          {"尚未建立任何搜尋條件。"}
          <Link href="/searches/new" className="underline ml-1">
            立即建立第一組搜尋條件
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-start justify-between gap-3 border rounded p-4 hover:bg-black/5 transition-colors"
              style={{ borderColor: "var(--border)" }}
            >
              <Link href={`/searches/${s.id}`} className="flex-1 min-w-[200px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  {s.paused && (
                    <span className="text-xs status-changed font-medium">已暫停</span>
                  )}
                </div>
                <p className="text-xs text-secondary mt-1">
                  {CADENCE_LABEL[s.cadence] ?? s.cadence}通知　
                  {"共 "}
                  {s.match_count}
                  {" 筆符合結果　建立於 "}
                  {formatDate(s.created_at)}
                </p>
              </Link>
              <PauseSearchButton searchId={s.id} paused={s.paused} />
              <DeleteSearchButton searchId={s.id} searchName={s.name} />
            </li>
          ))}
        </ul>
      )}

      {session.user.email === process.env.ADMIN_EMAIL && (
        <div className="mt-10 pt-6 border-t" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold text-secondary mb-2">管理員工具</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/admin/ingestion" className="underline">
              資料匯入狀態
            </Link>
            <Link href="/admin/data-removal-requests" className="underline">
              資料移除請求審核
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

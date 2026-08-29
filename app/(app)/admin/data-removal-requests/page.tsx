import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import RemovalRequestActions from "@/components/RemovalRequestActions";

export const dynamic = "force-dynamic";

// Admin-only review queue for PDPA data-removal requests submitted via
// the public /data-removal form. See db/schema.sql's comment on
// data_removal_requests for why approval is manual rather than
// automatic (abuse prevention - a competitor could otherwise suppress
// a rival's visibility just by filling in the public form).
export default async function DataRemovalAdminPage() {
  const session = await getServerSession(authOptions);
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || session.user.email !== adminEmail) {
    redirect("/login");
  }

  const sql = db();

  const pending = await sql`
    SELECT id, uniform_id, company_name_submitted, requester_email, reason, created_at
    FROM data_removal_requests
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `;

  const recentlyReviewed = await sql`
    SELECT id, uniform_id, company_name_submitted, requester_email, status, reviewed_at
    FROM data_removal_requests
    WHERE status != 'pending'
    ORDER BY reviewed_at DESC
    LIMIT 20
  `;

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold mb-6">資料移除請求審核</h1>

      <section className="mb-10">
        <h2 className="font-semibold mb-3">待審核（{pending.length}）</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-secondary">目前沒有待審核的請求。</p>
        ) : (
          <div className="flex flex-col gap-4">
            {(pending as any[]).map((r) => (
              <div
                key={r.id}
                className="border rounded p-4 flex flex-wrap items-start justify-between gap-4"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="text-sm">
                  <p className="font-medium">{r.company_name_submitted}</p>
                  <p className="text-secondary">
                    提交之統一編號：{r.uniform_id ?? "（未提供）"}
                  </p>
                  <p className="text-secondary">聯絡信箱：{r.requester_email}</p>
                  {r.reason && <p className="text-secondary">備註：{r.reason}</p>}
                  <p className="text-secondary text-xs mt-1">
                    提交於 {formatDate(r.created_at)}
                  </p>
                </div>
                <RemovalRequestActions
                  requestId={r.id}
                  submittedUniformId={r.uniform_id}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-3">最近已審核（最多20筆）</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-default text-left">
              <th className="py-2 pr-4">公司名稱</th>
              <th className="pr-4">統一編號</th>
              <th className="pr-4">聯絡信箱</th>
              <th className="pr-4">結果</th>
              <th>審核時間</th>
            </tr>
          </thead>
          <tbody>
            {(recentlyReviewed as any[]).map((r) => (
              <tr key={r.id} className="border-b border-default">
                <td className="py-2 pr-4">{r.company_name_submitted}</td>
                <td className="pr-4">{r.uniform_id ?? "\u2014"}</td>
                <td className="pr-4">{r.requester_email}</td>
                <td className={"pr-4 " + (r.status === "approved" ? "status-active" : "status-dissolved")}>
                  {r.status === "approved" ? "已核准並隱藏" : "已駁回"}
                </td>
                <td>{r.reviewed_at ? formatDate(r.reviewed_at) : "\u2014"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

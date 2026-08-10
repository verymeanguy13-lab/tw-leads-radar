import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DATASET_SOURCES } from "@/lib/ingestion/sources.config";

export const dynamic = "force-dynamic";

export default async function IngestionAdminPage() {
  const session = await getServerSession(authOptions);
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || session.user.email !== adminEmail) {
    redirect("/login");
  }

  const sql = db();

  const allRuns = await sql`
    SELECT id, dataset_name, source_month, row_count, new_count, updated_count,
           parse_failures, encoding_detected, status, error_log, started_at, completed_at
    FROM ingestion_runs
    ORDER BY started_at DESC
    LIMIT 100
  `;

  const lastGoodRows = await sql`
    SELECT DISTINCT ON (dataset_name) dataset_name, source_month, completed_at
    FROM ingestion_runs
    WHERE status = 'success'
    ORDER BY dataset_name, completed_at DESC
  `;
  const lastGoodMap = new Map(lastGoodRows.map((r: any) => [r.dataset_name, r]));

  const now = Date.now();

  const datasetSummaries = DATASET_SOURCES.map((source) => {
    const lastGood = lastGoodMap.get(source.id);
    const daysSince = lastGood
      ? Math.floor((now - new Date(lastGood.completed_at).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const isStale = daysSince === null || daysSince > source.expectedCadenceDays;
    return {
      id: source.id,
      nameZh: source.nameZh,
      lastGoodMonth: lastGood?.source_month ?? null,
      daysSince,
      isStale,
    };
  });

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold mb-6">Ingestion Admin</h1>

      <section className="mb-8">
        <h2 className="font-semibold mb-3">Dataset Freshness</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-default text-left">
              <th className="py-2 pr-4">Dataset</th>
              <th className="pr-4">Last Known-Good Month</th>
              <th className="pr-4">Days Since</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {datasetSummaries.map((d) => (
              <tr key={d.id} className="border-b border-default">
                <td className="py-2 pr-4">{d.nameZh}</td>
                <td className="pr-4">{d.lastGoodMonth ?? "\u2014"}</td>
                <td className="pr-4">{d.daysSince ?? "\u2014"}</td>
                <td className={d.isStale ? "status-dissolved" : "status-active"}>
                  {d.isStale ? "\u26a0 STALE" : "\u2713 OK"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Recent Runs (last 100)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-default text-left">
                <th className="py-2 pr-4">Dataset</th>
                <th className="pr-4">Month</th>
                <th className="pr-4">Status</th>
                <th className="pr-4">Rows</th>
                <th className="pr-4">New</th>
                <th className="pr-4">Updated</th>
                <th className="pr-4">Failures</th>
                <th className="pr-4">Started</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {allRuns.map((run: any) => (
                <tr key={run.id} className="border-b border-default">
                  <td className="py-2 pr-4">{run.dataset_name}</td>
                  <td className="pr-4">{run.source_month ?? "\u2014"}</td>
                  <td
                    className={
                      "pr-4 " +
                      (run.status === "success"
                        ? "status-active"
                        : run.status === "failed"
                        ? "status-dissolved"
                        : "status-changed")
                    }
                  >
                    {run.status}
                  </td>
                  <td className="pr-4">{run.row_count ?? "\u2014"}</td>
                  <td className="pr-4">{run.new_count ?? "\u2014"}</td>
                  <td className="pr-4">{run.updated_count ?? "\u2014"}</td>
                  <td className="pr-4">{run.parse_failures ?? 0}</td>
                  <td className="pr-4">{new Date(run.started_at).toLocaleString("zh-TW")}</td>
                  <td className="max-w-xs truncate" title={run.error_log ?? ""}>
                    {run.error_log ?? "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { db } from "../db";
import { discoverLatestFile } from "./discover";
import { runMonitorChecks } from "./monitor";
import { DATASET_SOURCES, type DatasetSource } from "./sources.config";

export interface FetchResult {
  source: DatasetSource;
  filePath: string;
  monthLabel: string;
  sourceUrl: string;
  ingestionRunId: string;
}

export class NoNewDataError extends Error {}

export async function fetchDataset(source: DatasetSource): Promise<FetchResult> {
  const sql = db();

  const priorRuns = await sql`
    SELECT source_month, completed_at, row_count
    FROM ingestion_runs
    WHERE dataset_name = ${source.id} AND status = ${"success"}
    ORDER BY completed_at DESC
    LIMIT 5
  `;
  const lastGood = priorRuns[0] ?? null;
  const typicalRowCount = priorRuns.length > 0
    ? Math.round(priorRuns.reduce((sum: number, r: any) => sum + (r.row_count ?? 0), 0) / priorRuns.length)
    : null;

  const runRows = await sql`
    INSERT INTO ingestion_runs (dataset_name, status, started_at)
    VALUES (${source.id}, ${"running"}, now())
    RETURNING id
  `;
  const ingestionRunId = runRows[0].id;

  try {
    const discovered = await discoverLatestFile(source.pageUrl);

    const monitorResult = runMonitorChecks({
      source,
      discoveredMonth: discovered.monthLabel,
      lastKnownGoodMonth: lastGood ? lastGood.source_month : null,
      lastKnownGoodAt: lastGood ? lastGood.completed_at : null,
      rowCount: 0,
      typicalRowCount,
    });

    if (monitorResult.outcome === "no_new_data") {
      await sql`
        UPDATE ingestion_runs
        SET status = ${"no_new_data"}, source_month = ${discovered.monthLabel}, source_url = ${discovered.url},
            error_log = ${monitorResult.reason}, completed_at = now()
        WHERE id = ${ingestionRunId}
      `;
      throw new NoNewDataError(monitorResult.reason);
    }

    if (monitorResult.outcome === "flagged") {
      await sql`
        UPDATE ingestion_runs
        SET status = ${"partial"}, source_month = ${discovered.monthLabel}, source_url = ${discovered.url},
            error_log = ${monitorResult.reason}, completed_at = now()
        WHERE id = ${ingestionRunId}
      `;
      throw new Error(monitorResult.reason);
    }

    const res = await fetch(discovered.url);
    if (!res.ok) {
      throw new Error(`fetch.ts: download failed for ${source.nameZh} (status ${res.status})`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const scratchDir = path.join(os.tmpdir(), "tw-leads-radar-ingestion");
    fs.mkdirSync(scratchDir, { recursive: true });
    const filePath = path.join(scratchDir, `${source.id}.csv`);
    fs.writeFileSync(filePath, buffer);

    await sql`
      UPDATE ingestion_runs
      SET status = ${'success'}, source_month = ${discovered.monthLabel}, source_url = ${discovered.url}, completed_at = now()
      WHERE id = ${ingestionRunId}
    `;

    return { source, filePath, monthLabel: discovered.monthLabel, sourceUrl: discovered.url, ingestionRunId };
  } catch (err) {
    if (err instanceof NoNewDataError) throw err;

    const message = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE ingestion_runs
      SET status = ${"failed"}, error_log = ${message}, completed_at = now()
      WHERE id = ${ingestionRunId} AND status = ${"running"}
    `;
    throw err;
  }
}

export async function fetchAllDatasets(): Promise<{ results: FetchResult[]; failures: string[] }> {
  const results: FetchResult[] = [];
  const failures: string[] = [];

  for (const source of DATASET_SOURCES) {
    try {
      results.push(await fetchDataset(source));
    } catch (err) {
      if (err instanceof NoNewDataError) {
        console.log(`[no_new_data] ${source.nameZh}: ${err.message}`);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[failed] ${source.nameZh}: ${message}`);
      failures.push(`${source.nameZh}: ${message}`);
    }
  }

  return { results, failures };
}
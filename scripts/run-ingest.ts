import { fetchDataset, NoNewDataError } from "../lib/ingestion/fetch";
import { normalizeFile } from "../lib/ingestion/normalize";
import { upsertRows } from "../lib/ingestion/upsert";
import { DATASET_SOURCES } from "../lib/ingestion/sources.config";
import { db } from "../lib/db";

async function main() {
  console.log("Starting ingestion run...");
  const sql = db();

  let successCount = 0;
  const failures: string[] = [];

  for (const source of DATASET_SOURCES) {
    // gcis_daily_setup_query is a live filterable API endpoint (GCIS
    // $filter=Company_Setup_Date), not a data.gov.tw CSV dataset — it
    // belongs in DATASET_SOURCES because the admin dashboard and this
    // page's attribution logic both need it there, but it must NOT be
    // fetched by this monthly CSV-scraping loop. It's handled entirely
    // by the separate scripts/run-ingest-daily.ts.
    if (source.id === "gcis_daily_setup_query") continue;

    let fetchResult;
    try {
      fetchResult = await fetchDataset(source);
    } catch (err) {
      if (err instanceof NoNewDataError) {
        console.log(`  SKIP ${source.nameZh}: ${err.message}`);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  FAIL ${source.nameZh} (fetch stage): ${message}`);
        failures.push(`${source.nameZh}: ${message}`);
      }
      continue;
    }

    try {
      const normalized = await normalizeFile(fetchResult.filePath, source.id, fetchResult.ingestionRunId);
      const summary = await upsertRows(normalized.rows, fetchResult.monthLabel);

      await sql`
        UPDATE ingestion_runs
        SET new_count = ${summary.inserted}, updated_count = ${summary.updated}
        WHERE id = ${fetchResult.ingestionRunId}
      `;

      console.log(
        `  OK ${source.nameZh} - ${fetchResult.monthLabel}: ${normalized.rows.length} rows, ` +
        `${summary.inserted} new, ${summary.updated} updated, ${normalized.failures.length} parse failures`
      );
      successCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${source.nameZh} (normalize/upsert stage): ${message}`);
      await sql`
        UPDATE ingestion_runs
        SET status = ${"failed"}, error_log = ${message}, completed_at = now()
        WHERE id = ${fetchResult.ingestionRunId}
      `;
      failures.push(`${source.nameZh}: ${message}`);
    }
  }

  console.log(`\nCompleted: ${successCount} succeeded, ${failures.length} failed.`);

  if (failures.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error in run-ingest.ts:", err);
  process.exit(1);
});
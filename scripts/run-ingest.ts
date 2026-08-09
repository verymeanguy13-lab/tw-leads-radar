import { fetchAllDatasets } from "../lib/ingestion/fetch";

async function main() {
  console.log("Starting ingestion run...");
  const { results, failures } = await fetchAllDatasets();

  console.log(`\nCompleted: ${results.length} succeeded, ${failures.length} failed.`);
  results.forEach((r) => console.log(`  OK ${r.source.nameZh} - ${r.monthLabel}`));

  if (failures.length > 0) {
    console.error("\nFailures:");
    failures.forEach((f) => console.error(`  FAIL ${f}`));
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error in run-ingest.ts:", err);
  process.exit(1);
});
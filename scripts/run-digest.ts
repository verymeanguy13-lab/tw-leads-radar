import { getDueSavedSearches, sendDigestForSearch } from "../lib/email/digest";
import { db } from "../lib/db";

async function main() {
  const startedAt = new Date();
  console.log("Starting digest run...");

  let status: "success" | "partial" | "failed" = "success";
  let errorLog: string | null = null;
  let sentCount = 0;
  let skippedCount = 0;
  const failures: string[] = [];

  try {
    const dueSearches = await getDueSavedSearches();
    console.log(`${dueSearches.length} saved_search(es) due for their cadence.`);

    for (const search of dueSearches) {
      const result = await sendDigestForSearch(search);

      if (result.error) {
        console.error(`  FAIL "${result.searchName}" (${result.searchId}): ${result.error}`);
        failures.push(`${result.searchId}: ${result.error}`);
      } else if (result.sent) {
        console.log(
          `  OK "${result.searchName}": sent, ${result.matchCount} new match(es), ` +
          `${result.statusChangedCount} status change(s)`
        );
        sentCount++;
      } else {
        console.log(`  SKIP "${result.searchName}": nothing new to report`);
        skippedCount++;
      }
    }

    if (failures.length > 0) {
      status = "partial";
      errorLog = failures.join("\n");
    }
  } catch (err) {
    status = "failed";
    errorLog = String(err);
    console.error("Digest run crashed:", err);
  }

  // 2026-09-03: log a digest_runs row every time this script actually
  // executes to completion — success, partial, or a caught crash. This
  // is what a separate watchdog job (.github/workflows/digest-watchdog.yml
  // + scripts/check-digest-ran.ts) checks for: it runs independently a
  // few hours after digest.yml's own schedule and looks for a recent row
  // here. digest.yml's own `if: failure()` alert step can only fire when
  // this workflow actually runs and then fails — it can never catch the
  // OTHER failure mode this project already hit for real (2026-09-01 to
  // 09-02): GitHub Actions silently not triggering the scheduled workflow
  // at all, with no run object ever existing for that alert step to
  // attach to. Wrapped in its own try/catch so a logging failure can
  // never mask (or crash out of) the real result of the run above.
  try {
    const sql = db();
    await sql`
      INSERT INTO digest_runs (
        status, sent_count, skipped_count, failed_count, error_log, started_at, completed_at
      ) VALUES (
        ${status}, ${sentCount}, ${skippedCount}, ${failures.length}, ${errorLog},
        ${startedAt.toISOString()}, now()
      )
    `;
  } catch (logErr) {
    console.error("Failed to write digest_runs log row (run result above is unaffected):", logErr);
  }

  console.log(
    `\nCompleted: ${sentCount} sent, ${skippedCount} skipped (nothing new), ${failures.length} failed.`
  );

  if (status !== "success") {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Digest run crashed:", err);
  process.exit(1);
});
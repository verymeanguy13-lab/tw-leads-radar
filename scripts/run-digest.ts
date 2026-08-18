import { getDueSavedSearches, sendDigestForSearch } from "../lib/email/digest";

async function main() {
  console.log("Starting digest run...");

  const dueSearches = await getDueSavedSearches();
  console.log(`${dueSearches.length} saved_search(es) due for their cadence.`);

  let sentCount = 0;
  let skippedCount = 0;
  const failures: string[] = [];

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

  console.log(
    `\nCompleted: ${sentCount} sent, ${skippedCount} skipped (nothing new), ${failures.length} failed.`
  );

  if (failures.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Digest run crashed:", err);
  process.exit(1);
});
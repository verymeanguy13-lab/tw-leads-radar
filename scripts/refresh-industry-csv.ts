import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

// Session 20b (revised again, 2026-08-23) — fully automated CSV refresh.
//
// The GCIS site's download button is a JavaScript-triggered action
// (href="javascript:void(0)"), not a plain link — there is no static
// URL for a dataset's file embedded in the page source. Rather than
// manually harvesting each file's dynamic oid once (fragile if GCIS
// ever changes them), this script drives a real (headless) browser to
// click through each dataset page itself, every time it runs. This is
// slower per-run than a plain HTTP fetch would be, but it needs no
// pre-harvested oid list and keeps working even if GCIS changes how
// file oids are generated.
//
// Requires one-time setup: npm install playwright, then
// npx playwright install chromium — see the setup instructions
// given alongside this file.

const DATASETS_FILE = join(__dirname, "..", "data", "industry-csv-datasets.json");
const OUTPUT_DIR = join(__dirname, "..", "data", "industry-csv");
const FAILURES_FILE = join(__dirname, "..", "data", "industry-csv-refresh-failures.json");

interface DatasetEntry {
  id: number;
  dataset_name: string;
  dataset_page_url: string;
}

interface RefreshResult {
  dataset_name: string;
  status: "success" | "failed";
  error?: string;
  savedAs?: string;
}

async function downloadOne(
  browser: import("playwright").Browser,
  entry: DatasetEntry
): Promise<RefreshResult> {
  const page = await browser.newPage();
  try {
    await page.goto(entry.dataset_page_url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // The CSV button opens a license-confirmation popup first.
    const csvButton = page.getByText("CSV", { exact: true }).first();
    await csvButton.click({ timeout: 10000 });

    // Wait for the popup's confirm button ("下載檔案") and the actual
    // file download together.
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.getByText("下載檔案", { exact: true }).click({ timeout: 10000 });
    const download = await downloadPromise;

    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const savePath = join(OUTPUT_DIR, `${entry.dataset_name}.csv`);
    await download.saveAs(savePath);

    return { dataset_name: entry.dataset_name, status: "success", savedAs: savePath };
  } catch (err) {
    return { dataset_name: entry.dataset_name, status: "failed", error: String(err) };
  } finally {
    await page.close();
  }
}

async function main() {
  const datasets: DatasetEntry[] = JSON.parse(readFileSync(DATASETS_FILE, "utf-8"));
  console.log(`Refreshing ${datasets.length} industry CSV datasets...`);

  const browser = await chromium.launch({ headless: true });
  const results: RefreshResult[] = [];

  for (const entry of datasets) {
    const result = await downloadOne(browser, entry);
    results.push(result);
    const marker = result.status === "success" ? "OK" : "FAILED";
    console.log(`[${entry.id}/${datasets.length}] ${marker}: ${entry.dataset_name}`);
    if (result.status === "failed") {
      console.error(`  -> ${result.error}`);
    }
  }

  await browser.close();

  const failures = results.filter((r) => r.status === "failed");
  const succeeded = results.length - failures.length;

  console.log("Done.");
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed:    ${failures.length}`);

  // Write failures (even an empty list) so the alerting step has a
  // definite file to check, rather than inferring success from a
  // missing file.
  writeFileSync(FAILURES_FILE, JSON.stringify(failures, null, 2), "utf-8");

  if (failures.length > 0) {
    console.error(`${failures.length} dataset(s) failed — see ${FAILURES_FILE}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Refresh script crashed:", err);
  process.exit(1);
});

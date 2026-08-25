import { neon } from "@neondatabase/serverless";
import { readdirSync } from "fs";
import { join } from "path";
import { parseIndustryCsv } from "../lib/ingestion/parse-industry-csv";

// Session 20b (revised, 2026-08-23) — one-time historical backfill.
//
// Reads every .csv file in CSV_DIR (each one a downloaded 公司登記混搭 CSV
// file), builds one combined 統一編號 -> industry codes map, then updates
// every entity_type='company' row in `companies` whose industry_codes is
// still '{}' and whose 統一編號 is found in that map.
//
// This does NOT call any live GCIS API and needs no IP registration — see
// the 2026-08-23 corrections-log entry in the blueprint.
//
// entity_type='business' rows are explicitly untouched by this script —
// that enrichment is deferred, see the same corrections-log entry.

const CSV_DIR = join(__dirname, "..", "data", "industry-csv");
const PROGRESS_LOG_INTERVAL = 500;

const sql = neon(process.env.DATABASE_URL!);

function loadCombinedMap(): {
  combined: Map<string, string[]>;
  filesLoaded: number;
  filesFailed: number;
} {
  const files = readdirSync(CSV_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));

  if (files.length === 0) {
    throw new Error(
      `No .csv files found in ${CSV_DIR}. Download at least one file from ` +
        `data.gcis.nat.gov.tw/od/datacategory (公司登記混搭 CSV) into this folder first.`
    );
  }

  const combined = new Map<string, string[]>();
  let filesLoaded = 0;
  let filesFailed = 0;

  for (const file of files) {
    const fullPath = join(CSV_DIR, file);
    try {
      const perFile = parseIndustryCsv(fullPath);
      for (const [uniformId, codes] of perFile) {
        // Files are scoped to non-overlapping city/letter combinations, so
        // collisions shouldn't happen in practice. If one does, keep the
        // first value seen and note it rather than silently overwriting.
        if (!combined.has(uniformId)) {
          combined.set(uniformId, codes);
        }
      }
      filesLoaded++;
      console.log(`Loaded ${file}: ${perFile.size} rows`);
    } catch (err) {
      filesFailed++;
      console.error(`Failed to parse ${file}:`, err);
    }
  }

  return { combined, filesLoaded, filesFailed };
}

async function main() {
  console.log(`Reading CSV files from ${CSV_DIR}...`);
  const { combined, filesLoaded, filesFailed } = loadCombinedMap();
  console.log(
    `Loaded ${filesLoaded} file(s) (${filesFailed} failed to parse), ${combined.size} total 統一編號 entries.`
  );

  console.log("Fetching companies still needing industry codes...");
  const pending = await sql`
    SELECT uniform_id FROM companies
    WHERE entity_type = 'company' AND industry_codes = '{}'
  `;
  console.log(`${pending.length} entity_type='company' rows currently have empty industry_codes.`);

  let matchedNonEmpty = 0;
  let matchedButEmpty = 0;
  let notFoundInAnyFile = 0;
  let processed = 0;

  for (const row of pending) {
    const uniformId = row.uniform_id as string;
    const codes = combined.get(uniformId);

    if (codes === undefined) {
      notFoundInAnyFile++;
    } else if (codes.length === 0) {
      // The CSV had a row for this company, but its 行業代號 field was
      // genuinely blank. Still worth writing — an empty array is a
      // different, more informative state than "never checked", and
      // matches how parse-industry-csv.ts's own contract distinguishes
      // "found with zero codes" from "not found at all".
      await sql`
        UPDATE companies SET industry_codes = ${codes}::text[]
        WHERE uniform_id = ${uniformId}
      `;
      matchedButEmpty++;
    } else {
      await sql`
        UPDATE companies SET industry_codes = ${codes}::text[]
        WHERE uniform_id = ${uniformId}
      `;
      matchedNonEmpty++;
    }

    processed++;
    if (processed % PROGRESS_LOG_INTERVAL === 0) {
      console.log(
        `...${processed}/${pending.length} processed (${matchedNonEmpty} matched, ${matchedButEmpty} matched-but-empty, ${notFoundInAnyFile} not found yet)`
      );
    }
  }

  console.log("Done.");
  console.log(`  Matched with real codes:     ${matchedNonEmpty}`);
  console.log(`  Matched but genuinely empty: ${matchedButEmpty}`);
  console.log(`  Not found in any loaded file: ${notFoundInAnyFile} (re-run after downloading more files, or a later CSV refresh, to pick these up)`);
  console.log(`  CSV files that failed to parse: ${filesFailed}`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

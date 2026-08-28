import { neon } from "@neondatabase/serverless";
import { readdirSync } from "fs";
import { join } from "path";
import { parseIndustryCsv, IndustryCsvRow } from "../lib/ingestion/parse-industry-csv";

// Session 20b (revised, 2026-08-23) — one-time historical backfill.
// UPDATED 2026-08-25/26 (Session 23 QA Pass bug fix): now also extracts
// and appends each file's GCIS letter category (A-J, Z) to every
// company's industry_codes, not just the fine-grained numeric codes —
// see parse-industry-csv.ts's updated doc comment for why this was
// broken before (matchSearch() could never match a letter-based filter
// against an array that only ever held numeric codes).
//
// Also changed to reprocess EVERY entity_type='company' row every run,
// not just ones with industry_codes = '{}' — needed this one time to
// backfill the missing letter into the ~9,543 rows the original
// (letter-less) run had already populated, and going forward this also
// keeps data correctly current if GCIS ever reclassifies a company,
// at negligible extra cost (parsing 110 files and updating ~43,599 rows
// is still fast — this is CPU-bound file parsing, not rate-limited API
// calls).
//
// Reads every .csv file in CSV_DIR (each one a downloaded 公司登記混搭 CSV
// file), builds one combined 統一編號 -> industry codes map, then updates
// every entity_type='company' row in `companies` whose 統一編號 is found
// in that map.
//
// This does NOT call any live GCIS API and needs no IP registration — see
// the 2026-08-23 corrections-log entry in the blueprint.
//
// entity_type='business' rows are explicitly untouched by this script —
// that enrichment is deferred, see the same corrections-log entry.
//
// UPDATE (2026-08-27): also backfills companies.registration_date from
// each file's 核准設立日期 column (see parse-industry-csv.ts's updated
// doc comment for the full story). Only fills it in when currently
// NULL - never overwrites an existing date, same COALESCE convention
// lib/ingestion/upsert.ts already uses.

const CSV_DIR = join(__dirname, "..", "data", "industry-csv");
const PROGRESS_LOG_INTERVAL = 500;

const sql = neon(process.env.DATABASE_URL!);

// Filenames always follow ${region}公司登記資料-${letter}${categoryName}.csv
// (see data/industry-csv-datasets.json's dataset_name values) — the
// letter is always the single character right after "資料-".
function extractLetterFromFilename(filename: string): string | undefined {
  const match = filename.match(/資料-([A-JZ])/);
  return match ? match[1] : undefined;
}

function loadCombinedMap(): {
  combined: Map<string, IndustryCsvRow>;
  filesLoaded: number;
  filesFailed: number;
} {
  const files = readdirSync(CSV_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));

  if (files.length === 0) {
    throw new Error(
      `No .csv files found in ${CSV_DIR}. Run scripts/refresh-industry-csv.ts first to download them.`
    );
  }

  const combined = new Map<string, IndustryCsvRow>();
  let filesLoaded = 0;
  let filesFailed = 0;

  for (const file of files) {
    const fullPath = join(CSV_DIR, file);
    const letter = extractLetterFromFilename(file);
    if (!letter) {
      console.warn(`Could not extract a letter category from filename "${file}" — codes from this file won't include a letter.`);
    }
    try {
      const perFile = parseIndustryCsv(fullPath, letter);
      for (const [uniformId, row] of perFile) {
        // Files are scoped to non-overlapping city/letter combinations, so
        // collisions shouldn't happen in practice. If one does, keep the
        // first value seen and note it rather than silently overwriting.
        if (!combined.has(uniformId)) {
          combined.set(uniformId, row);
        }
      }
      filesLoaded++;
      console.log(`Loaded ${file} (letter: ${letter ?? "unknown"}): ${perFile.size} rows`);
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

  console.log("Fetching all entity_type='company' rows...");
  const pending = await sql`
    SELECT uniform_id, registration_date FROM companies
    WHERE entity_type = 'company'
  `;
  console.log(`${pending.length} entity_type='company' rows to check.`);

  let matchedNonEmpty = 0;
  let matchedButEmpty = 0;
  let notFoundInAnyFile = 0;
  let registrationDatesFilled = 0;
  let processed = 0;

  for (const row of pending) {
    const uniformId = row.uniform_id as string;
    const hadRegistrationDate = row.registration_date !== null;
    const csvRow = combined.get(uniformId);

    if (csvRow === undefined) {
      notFoundInAnyFile++;
    } else {
      const { codes, registrationDate } = csvRow;
      // registration_date uses COALESCE, same convention as
      // lib/ingestion/upsert.ts's ON CONFLICT clause: never overwrite an
      // already-known date, and only fill it in when currently NULL.
      // industry_codes is NOT coalesced - a fresh CSV re-run should
      // always win there, matching the existing (pre-2026-08-27)
      // behavior this script has always had for that column.
      await sql`
        UPDATE companies
        SET
          industry_codes = ${codes}::text[],
          registration_date = COALESCE(registration_date, ${registrationDate}::date)
        WHERE uniform_id = ${uniformId}
      `;
      if (!hadRegistrationDate && registrationDate !== null) {
        registrationDatesFilled++;
      }
      if (codes.length === 0) {
        matchedButEmpty++;
      } else {
        matchedNonEmpty++;
      }
    }

    processed++;
    if (processed % PROGRESS_LOG_INTERVAL === 0) {
      console.log(
        `...${processed}/${pending.length} processed (${matchedNonEmpty} matched, ${matchedButEmpty} matched-but-empty, ${notFoundInAnyFile} not found yet, ${registrationDatesFilled} registration_date filled so far)`
      );
    }
  }

  console.log("Done.");
  console.log(`  Matched with real codes:     ${matchedNonEmpty}`);
  console.log(`  Matched but genuinely empty: ${matchedButEmpty}`);
  console.log(`  Not found in any loaded file: ${notFoundInAnyFile} (re-run after downloading more files, or a later CSV refresh, to pick these up)`);
  console.log(`  registration_date newly filled: ${registrationDatesFilled} (rows that previously had no registration date at all)`);
  console.log(`  CSV files that failed to parse: ${filesFailed}`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

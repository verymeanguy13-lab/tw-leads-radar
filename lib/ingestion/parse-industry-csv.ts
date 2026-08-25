import { readFileSync } from "fs";

// Session 20b (revised, 2026-08-23) — Industry Code Enrichment via bulk CSV.
//
// Parses one downloaded 公司登記混搭 CSV file (data.gcis.nat.gov.tw, dataset
// category "公司登記混搭 CSV") into a map of 統一編號 -> industry codes.
//
// This replaces the original per-company live-API plan entirely for
// entity_type='company'. See the 2026-08-23 corrections-log entry in the
// blueprint for why: no IP registration required for file downloads (only
// for the live 系統介接API), and the CSV already carries the same
// multi-code granularity the live API would have returned.
//
// Column names as confirmed against a real downloaded file
// (台北市公司登記資料-A農、林、漁、牧業.csv, oid DB2DBDDA-420E-4F41-BC75-6F90F55AD190):
//   統一編號, 公司名稱, 公司地址, 資本總額, 實收資本額, 在境內營運資金,
//   核准設立日期, 登記狀態, 營業地址（財政資訊中心匯入）,
//   行業代號（財政資訊中心匯入）, 財政資訊中心匯入日期,
//   股票代號（金融監督管理委員會匯入）, 產業別（金融監督管理委員會匯入）,
//   金融監督管理委員會匯入日期, 商標資料（智慧財產局匯入）, 智慧財產局匯入日期

const UNIFORM_ID_COLUMN = "統一編號";
const INDUSTRY_CODES_COLUMN = "行業代號（財政資訊中心匯入）";

/**
 * Minimal RFC4180-style CSV line splitter. Handles double-quoted fields,
 * commas inside quotes, and "" as an escaped quote. Government open-data
 * exports like this one are simple (no embedded newlines observed in
 * sampled data), so this does not attempt to handle a quoted field that
 * spans multiple lines.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Reads one 公司登記混搭 CSV file and returns a map of 統一編號 to its
 * industry codes.
 *
 * A uniform ID present in the map with an empty array means the CSV row
 * existed but 行業代號 was genuinely blank for that company. A uniform ID
 * absent from the map entirely means this file didn't contain a row for
 * it at all (it may be too new for this file's refresh cycle, or simply
 * belongs to a different city/industry-letter file). Callers combining
 * multiple files' maps should treat these two cases differently — see
 * scripts/backfill-industry-codes.ts and scripts/sync-industry-codes.ts.
 */
export function parseIndustryCsv(filePath: string): Map<string, string[]> {
  let content = readFileSync(filePath, "utf-8");

  // Strip UTF-8 BOM if present — Node does not do this automatically,
  // and these government exports are consistently saved with one (same
  // issue and fix as Session 7).
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const lines = content.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return new Map();
  }

  const header = parseCsvLine(lines[0]);
  const uniformIdIndex = header.indexOf(UNIFORM_ID_COLUMN);
  const industryCodesIndex = header.indexOf(INDUSTRY_CODES_COLUMN);

  if (uniformIdIndex === -1 || industryCodesIndex === -1) {
    throw new Error(
      `${filePath}: expected columns "${UNIFORM_ID_COLUMN}" and "${INDUSTRY_CODES_COLUMN}" not found in header: ${header.join(", ")}`
    );
  }

  const result = new Map<string, string[]>();

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const uniformId = fields[uniformIdIndex]?.trim();
    if (!uniformId) continue;

    const rawCodes = fields[industryCodesIndex] ?? "";
    // Real data looks like "011999,639099,723000," — split on comma and
    // drop empty entries (the trailing comma, and any accidental blanks).
    const codes = rawCodes
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code.length > 0);

    result.set(uniformId, codes);
  }

  return result;
}
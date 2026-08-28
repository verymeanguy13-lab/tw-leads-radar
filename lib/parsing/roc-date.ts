/**
 * Converts a Republic of China (Minguo/ROC) calendar date string into an
 * ISO (Gregorian) date string ("YYYY-MM-DD"), or null if unparseable.
 *
 * Extracted from lib/ingestion/normalize.ts (where it was a private,
 * unexported function only handling the compact all-digit format) so it
 * can also be used by lib/ingestion/parse-industry-csv.ts for the
 * 核准設立日期 (approved registration date) column - see
 * scripts/backfill-industry-codes.ts's 2026-08-27 update for why that
 * column needed parsing at all (it was being read from the CSV but
 * silently discarded, leaving most established companies with a NULL
 * registration_date and no way for the free-tier freshness gate in
 * lib/matching/engine.ts to work correctly).
 *
 * Handles two formats seen across GCIS / data.gov.tw exports:
 *   - Compact all-digit: "1120315" or "990315" (ROC year + MM + DD,
 *     5-7 digits total depending on year length) - the format used by
 *     the company_new/change/dissolve monthly datasets.
 *   - Separated: "112/03/15", "112-03-15", "112.03.15" - not confirmed
 *     against a real 公司登記混搭 CSV file at the time this was written
 *     (files are downloaded fresh each run via Playwright and not
 *     committed to the repo - see data/industry-csv/ in .gitignore), so
 *     this format is supported defensively. If a real file's actual
 *     separator or field order differs from both patterns here, dates
 *     from that file will silently return null (the same failure mode
 *     normalize.ts already logs to ingestion_runs.error_log) rather
 *     than throwing - check that log after the next run.
 *
 * ROC year 0 = 1911 AD, so ROC year N = N + 1911.
 */
export function convertRocDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const separatedMatch = trimmed.match(/^(\d{2,3})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (separatedMatch) {
    const rocYear = parseInt(separatedMatch[1], 10);
    const mm = parseInt(separatedMatch[2], 10);
    const dd = parseInt(separatedMatch[3], 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${rocYear + 1911}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  if (!/^\d{5,7}$/.test(trimmed)) return null;
  const mmdd = trimmed.slice(-4);
  const yearPart = trimmed.slice(0, -4);
  const rocYear = parseInt(yearPart, 10);
  const month = mmdd.slice(0, 2);
  const day = mmdd.slice(2, 4);
  if (isNaN(rocYear)) return null;
  const mm = parseInt(month, 10);
  const dd = parseInt(day, 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${rocYear + 1911}-${month}-${day}`;
}

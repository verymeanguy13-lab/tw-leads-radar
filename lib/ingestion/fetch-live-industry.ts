// Session 23 QA Pass follow-up (2026-08-26) — live per-company industry
// classification for SAME-DAY enrichment of newly-discovered companies.
//
// This is a live GCIS API call (公司登記基本資料-應用三, oid
// 236EE382-4942-41A9-BD03-CA0709025E7C), NOT the bulk CSV approach —
// see the important distinction below.
//
// WHY THIS EXISTS ALONGSIDE THE CSV APPROACH, NOT INSTEAD OF IT:
// The original per-company-API plan (pre-2026-08-23) was abandoned for
// the ~43,599-company HISTORICAL BACKFILL specifically because that
// volume of calls in a short window triggered GCIS's abnormal-access
// block, requiring formal IP registration. This function is NOT for
// bulk backfill — it's called only for the small number of NEWLY
// DISCOVERED companies each day (same order of magnitude, ~80-150/day,
// as the existing fetchProfile() call in run-ingest-daily.ts, which
// already makes this same class of call successfully every day without
// issue). If this ever needs to run against historical data again, do
// NOT reuse this function in a loop over thousands of existing rows —
// that's exactly the pattern that triggered the original block.
//
// WHY THIS API'S CODES DIFFER FROM THE CSV'S CODES:
// This API's Business_Item codes (e.g. "I301010") are a DIFFERENT GCIS
// code scheme from the CSV's 行業代號（財政資訊中心匯入）column (e.g.
// "011999") — confirmed live on 2026-08-26 against a real company
// (統編 62118503, registered 2026-08-25, the CSV had nothing for it,
// this API returned full classification same-day). This API's codes
// conveniently embed the top-level letter category as their first
// character (I301010 -> I), so unlike the CSV path, no separate
// filename-derived letter is needed — it's extracted directly from
// each code.
//
// FAILURE SEMANTICS — same null-vs-empty-array discipline as the
// original (pre-CSV-pivot) design, because a real bug already happened
// once from conflating the two: this function returns null on ANY
// failure (bad HTTP status, unparseable response, network error) and
// only a real string[] (possibly empty) when the lookup genuinely
// succeeded. Callers must NEVER treat null the same as a successful
// empty result.

const INDUSTRY_API =
  "https://data.gcis.nat.gov.tw/od/data/api/236EE382-4942-41A9-BD03-CA0709025E7C";

interface CmpBusinessRow {
  Business_Seq_NO: string;
  Business_Item: string;
  Business_Item_Desc: string;
}

interface IndustryApiRow {
  Business_Accounting_NO: string;
  Cmp_Business?: CmpBusinessRow[];
}

/**
 * Fetches live industry classification for one company. Returns null on
 * any failure — see the failure-semantics note above. Returns codes
 * with the top-level letter extracted from each Business_Item and
 * appended too (deduped), matching the same array shape
 * lib/ingestion/parse-industry-csv.ts produces from the CSV path, so
 * matchSearch()'s existing letter-based filtering works identically
 * regardless of which source populated a given company's row.
 */
export async function fetchLiveIndustryCodes(uniformId: string): Promise<string[] | null> {
  try {
    const url = `${INDUSTRY_API}?$format=json&$filter=Business_Accounting_NO%20eq%20${uniformId}`;
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const text = await res.text();
    if (!text) {
      return null;
    }
    const rows = JSON.parse(text) as IndustryApiRow[];
    const businessItems = rows[0]?.Cmp_Business ?? [];

    const codes = businessItems.map((b) => b.Business_Item);
    const letters = new Set<string>();
    for (const code of codes) {
      const letter = code.charAt(0);
      if (letter) letters.add(letter);
    }

    return Array.from(new Set([...codes, ...letters]));
  } catch (err) {
    console.error(`fetchLiveIndustryCodes failed for ${uniformId}:`, err);
    return null;
  }
}

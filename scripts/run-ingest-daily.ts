import { neon } from "@neondatabase/serverless";
import { parseAddress } from "../lib/parsing/address";
import { fetchLiveIndustryCodes } from "../lib/ingestion/fetch-live-industry";
import { matchAllSearches } from "../lib/matching/engine";

const DISCOVERY_API =
  "https://data.gcis.nat.gov.tw/od/data/api/467E8A3A-72C6-4663-9557-D9D74C597E14";
const PROFILE_API =
  "https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6";

const PAGE_SIZE = 50;
const PROFILE_FETCH_DELAY_MS = 150;

function mapStatus(profile: ProfileRow): string {
  if (profile.Revoke_App_Date && profile.Revoke_App_Date.trim() !== "") {
    return "dissolved";
  }
  if (
    profile.Sus_Beg_Date &&
    profile.Sus_Beg_Date.trim() !== "" &&
    (!profile.Sus_End_Date || profile.Sus_End_Date.trim() === "")
  ) {
    return "suspended";
  }
  return "active";
}

const sql = neon(process.env.DATABASE_URL!);

interface DiscoveryRow {
  Business_Accounting_NO: string;
  Company_Name: string;
}

interface ProfileRow {
  Business_Accounting_NO: string;
  Company_Status_Desc: string;
  Company_Name: string;
  Capital_Stock_Amount: number;
  Responsible_Name: string;
  Company_Location: string;
  Company_Setup_Date: string;
  Revoke_App_Date: string;
  Sus_Beg_Date: string;
  Sus_End_Date: string;
}

// 2026-09-06: generalized from the old separate todayRocDate() /
// yesterdayRocDate() pair so main() can look back further than just
// "yesterday and today" - see DISCOVERY_LOOKBACK_DAYS below for why.
function rocDateForOffset(daysAgo: number): string {
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000);
  const rocYear = taipei.getUTCFullYear() - 1911;
  const mm = String(taipei.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(taipei.getUTCDate()).padStart(2, "0");
  return `${rocYear}${mm}${dd}`;
}

function rocDateToYearMonthLabel(roc: string): string {
  const rocYear = parseInt(roc.slice(0, roc.length - 4), 10);
  const mm = roc.slice(-4, -2);
  return `${rocYear + 1911}\u5e74${mm}\u6708`;
}

// 2026-09-03: retry-with-backoff for transient GCIS API failures
// (502/503/504 gateway errors, 429 rate-limiting, and network-level
// failures like fetch timeouts or connection resets). Added after realizing a single
// Discovery API 504 for one date threw straight out of fetchAllForDate()
// uncaught — which killed ingestDate() for BOTH dates in that run, since
// the for-of loop over `dates` in main() had no per-date recovery either
// (see that change further down). Since main() only ever looks at
// "yesterday" and "today", a failure on yesterday's date was never
// revisited by any later run — that date's newly-registered companies
// would be permanently missed, not just delayed. Retrying a handful of
// times with exponential backoff turns most single-day GCIS hiccups into
// a same-run recovery instead of a silent, permanent gap.
const MAX_FETCH_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 2000; // 2s, 4s, 8s (only 3 delays between 4 attempts)

function isRetryableStatus(status: number): boolean {
  // 429 (rate limited) and 5xx (server/gateway errors, including the 504s
  // this was built for) are worth retrying — they're typically transient.
  // Other 4xx codes usually mean the request itself is malformed in some
  // way that retrying won't fix, so those still fail immediately.
  return status === 429 || (status >= 500 && status < 600);
}

async function fetchWithRetry(url: string, context: string): Promise<string> {
  let lastErrorMessage = "unknown error";
  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url);
    } catch (err) {
      // Network-level failure (timeout, DNS, connection reset, etc.) —
      // always worth retrying.
      lastErrorMessage = err instanceof Error ? err.message : String(err);
    }

    if (res) {
      if (res.ok) {
        return await res.text();
      }
      if (!isRetryableStatus(res.status)) {
        // Not transient — retrying won't help, fail immediately.
        throw new Error(`${context}: HTTP ${res.status} (not retryable)`);
      }
      lastErrorMessage = `HTTP ${res.status}`;
    }

    if (attempt < MAX_FETCH_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `${context}: attempt ${attempt}/${MAX_FETCH_RETRIES} failed (${lastErrorMessage}), retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }
  throw new Error(`${context}: failed after ${MAX_FETCH_RETRIES} attempts (${lastErrorMessage})`);
}

async function fetchDiscoveryPage(rocDate: string, skip: number): Promise<DiscoveryRow[]> {
  const url = `${DISCOVERY_API}?$format=json&$filter=Company_Setup_Date%20eq%20${rocDate}&$skip=${skip}&$top=${PAGE_SIZE}`;
  const text = await fetchWithRetry(url, `Discovery API for ${rocDate} skip=${skip}`);
  if (!text) return [];
  return JSON.parse(text) as DiscoveryRow[];
}

async function fetchAllForDate(rocDate: string): Promise<DiscoveryRow[]> {
  const all: DiscoveryRow[] = [];
  let skip = 0;
  while (true) {
    const page = await fetchDiscoveryPage(rocDate, skip);
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return all;
}

async function fetchProfile(uniformId: string): Promise<ProfileRow | null> {
  const url = `${PROFILE_API}?$format=json&$filter=Business_Accounting_NO%20eq%20${uniformId}&$skip=0&$top=1`;
  const text = await fetchWithRetry(url, `Profile API for ${uniformId}`);
  if (!text) return null;
  const rows = JSON.parse(text) as ProfileRow[];
  return rows[0] ?? null;
}

function rocDateToIso(roc: string): string {
  const rocYear = parseInt(roc.slice(0, roc.length - 4), 10);
  const mm = roc.slice(-4, -2);
  const dd = roc.slice(-2);
  return `${rocYear + 1911}-${mm}-${dd}`;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 2026-08-30: self-healing retry for recently-discovered companies
// still missing address_region and/or industry_codes. Added after
// finding a real 6-day incident (2026-08-18 to 2026-08-25) where the
// live industry API silently failed for ~100% of that window's
// companies, and — since this daily job previously only ever looked
// at "yesterday" and "today" — those companies were NEVER retried
// again by anything, permanently. This closes that gap: every run
// re-attempts any gcis_daily_setup_query company from the last 14 days
// that's still missing either field, so a multi-day outage like the
// one already found self-heals automatically within a few days of
// GCIS (or whatever failed) recovering, with no one needing to notice
// an alert and manually intervene.
//
// Scoped to source_dataset = 'gcis_daily_setup_query' only (not CSV-
// sourced or entity_type='business' rows) — those have their own
// separate monthly backfill path already. Capped at RETRY_CAP per run
// to keep this a bounded catch-up operation, not an open-ended one —
// if a much larger backlog ever accumulated than this cap can clear in
// one run, it will simply take a few more days to fully catch up
// rather than blowing up a single run's duration or API call volume.
// Deliberately kept in the same range as the already-proven-safe daily
// discovery volume (~80-150/day, see fetch-live-industry.ts's header
// comment on the bulk-backfill wall) rather than pushed higher just to
// clear a backlog faster — GCIS's exact rate-limit thresholds aren't
// documented anywhere accessible, so staying well clear of anything
// resembling the volume that triggered the original wall is safer than
// optimizing for catch-up speed.
const RETRY_CAP = 100;

async function retryRecentGaps(runStats: {
  retryAttempts: number;
  retrySuccesses: number;
}) {
  const gaps = await sql`
    SELECT uniform_id
    FROM companies
    WHERE entity_type = 'company'
      AND source_dataset = 'gcis_daily_setup_query'
      AND registration_date >= (CURRENT_DATE - INTERVAL '14 days')
      AND (
        address_region IS NULL OR address_region = ''
        OR industry_codes IS NULL OR array_length(industry_codes, 1) IS NULL
      )
    ORDER BY registration_date ASC
    LIMIT ${RETRY_CAP}
  `;

  if (gaps.length === 0) {
    console.log("retryRecentGaps: no gaps found in the last 14 days.");
    return;
  }
  console.log(`retryRecentGaps: attempting ${gaps.length} companies with missing fields...`);

  for (const row of gaps) {
    const uniformId = row.uniform_id as string;
    runStats.retryAttempts++;
    try {
      const profile = await fetchProfile(uniformId);
      await sleep(PROFILE_FETCH_DELAY_MS);
      const liveIndustryCodesResult = await fetchLiveIndustryCodes(uniformId);
      await sleep(PROFILE_FETCH_DELAY_MS);

      const { region, district } = parseAddress(profile?.Company_Location ?? "");
      const industryCodes = liveIndustryCodesResult ?? [];

      if (!region && industryCodes.length === 0) {
        continue; // still no improvement this time, leave as-is for a future run
      }

      await sql`
        UPDATE companies
        SET
          address_region = COALESCE(NULLIF(address_region, ''), ${region}),
          address_district = COALESCE(address_district, ${district}),
          industry_codes = CASE
            WHEN COALESCE(cardinality(industry_codes), 0) = 0 AND ${industryCodes}::text[] != '{}'
              THEN ${industryCodes}::text[]
            ELSE industry_codes
          END
        WHERE uniform_id = ${uniformId}
      `;
      runStats.retrySuccesses++;
    } catch (err) {
      console.error(`retryRecentGaps failed on ${uniformId}:`, err);
    }
  }

  console.log(
    `retryRecentGaps: ${runStats.retrySuccesses}/${runStats.retryAttempts} improved.`
  );
}

async function ingestDate(rocDate: string, runStats: {
  rowCount: number;
  newCount: number;
  // 2026-09-06: repurposed, not renamed, to avoid an ingestion_runs
  // schema migration for this fix. This job used to fetch+re-upsert
  // every already-known company it saw again (hence "updated"); now it
  // skips already-known companies outright (see the `existing` check
  // below) rather than re-fetching them, so this now counts "already
  // known, skipped" rather than "profile data refreshed." Same column
  // in ingestion_runs, different meaning - a run where this number is
  // large just means the lookback window re-discovered a lot of
  // already-captured companies, not that anything was updated.
  updatedCount: number;
  parseFailures: number;
  industryCodeAttempts: number;
  industryCodeSuccesses: number;
  regionAttempts: number;
  regionSuccesses: number;
}) {
  const discovered = await fetchAllForDate(rocDate);
  console.log(`${rocDate}: ${discovered.length} companies from discovery API`);
  const sourceMonthLabel = rocDateToYearMonthLabel(rocDate);

  for (const row of discovered) {
    runStats.rowCount++;
    try {
      // 2026-09-06: check whether we already have this company BEFORE
      // spending two GCIS API calls (profile + industry) on it. Added
      // alongside DISCOVERY_LOOKBACK_DAYS below specifically so that
      // widening the lookback window doesn't multiply this job's GCIS
      // call volume by however many days it now re-checks - a company
      // discovered again on day+3 of the lookback almost always already
      // exists in `companies` from day+0's run, and re-fetching its
      // profile/industry data here would be pure waste (retryRecentGaps()
      // above already re-attempts any company still missing those fields
      // within the last 14 days, so this loop doesn't need to also try).
      // This makes the lookback window's real cost proportional to how
      // many companies GCIS was actually slow to index (the thing this
      // change exists to catch), not to lookbackDays x daily volume.
      const existing = await sql`
        SELECT uniform_id FROM companies WHERE uniform_id = ${row.Business_Accounting_NO}
      `;
      const isNew = existing.length === 0;

      if (!isNew) {
        runStats.updatedCount++;
        continue;
      }

      const profile = await fetchProfile(row.Business_Accounting_NO);
      await sleep(PROFILE_FETCH_DELAY_MS);

      // Session 23 QA Pass follow-up (2026-08-26): call the live
      // per-company industry API for same-day classification. This is
      // safe daily-discovery volume (~80-150/day), NOT the bulk
      // historical pattern that triggered GCIS's registration wall
      // before (see fetch-live-industry.ts's header comment for the
      // distinction). liveIndustryCodesResult is null on ANY failure
      // (never treat null as "confirmed empty" -- same discipline as
      // the original, since-superseded per-company-API design, whose
      // first version had a real bug from conflating the two).
      const liveIndustryCodesResult = await fetchLiveIndustryCodes(row.Business_Accounting_NO);
      await sleep(PROFILE_FETCH_DELAY_MS);
      const industryCodes = liveIndustryCodesResult ?? [];
      // If the live lookup failed, leave industry_codes untouched
      // (still '{}' by column default) so the monthly CSV refresh
      // remains the fallback -- this daily live call is a same-day
      // improvement layered on top of that existing safety net, not a
      // replacement for it.

      // 2026-08-30: track same-day success rate for BOTH industry
      // codes and address_region separately from parseFailures (which
      // only counts hard exceptions). A real 6-day incident happened
      // where fetchLiveIndustryCodes() silently returned null for
      // ~100% of that day's companies every single day, but every run
      // still reported overall "success" -- ingestDate() never threw,
      // parseFailures stayed 0, and the resulting empty arrays are
      // indistinguishable downstream from a company genuinely having
      // no classified business items yet. These counters let main()
      // check the aggregate rate after processing and flag a run as
      // degraded even though no individual call ever threw.
      // (Only counted for genuinely new companies now, since 2026-09-06 -
      // already-known companies short-circuit above and never reach here,
      // so they no longer dilute this rate.)
      runStats.industryCodeAttempts++;
      if (liveIndustryCodesResult !== null && liveIndustryCodesResult.length > 0) {
        runStats.industryCodeSuccesses++;
      }
      runStats.regionAttempts++;
      const { region, district } = parseAddress(profile?.Company_Location ?? "");
      if (region) runStats.regionSuccesses++;

      const registrationDate = rocDateToIso(rocDate);
      const rawAddress = profile?.Company_Location ?? null;

      await sql`
        INSERT INTO companies (
          uniform_id, entity_type, name, capital, address_raw,
          address_region, address_district, responsible_person,
          registration_date, status, status_updated_at,
          industry_codes,
          source_dataset, source_month
        ) VALUES (
          ${row.Business_Accounting_NO},
          'company',
          ${profile?.Company_Name ?? row.Company_Name},
          ${profile?.Capital_Stock_Amount ?? null},
          ${rawAddress},
          ${region},
          ${district},
          ${profile?.Responsible_Name ?? null},
          ${registrationDate},
          ${profile ? mapStatus(profile) : "active"},
          now(),
          ${industryCodes}::text[],
          'gcis_daily_setup_query',
          ${sourceMonthLabel}
        )
        ON CONFLICT (uniform_id) DO UPDATE SET
          name = EXCLUDED.name,
          capital = EXCLUDED.capital,
          address_raw = EXCLUDED.address_raw,
          address_region = EXCLUDED.address_region,
          address_district = EXCLUDED.address_district,
          responsible_person = EXCLUDED.responsible_person,
          status = EXCLUDED.status,
          status_updated_at = CASE
            WHEN EXCLUDED.status <> companies.status THEN now()
            ELSE companies.status_updated_at
          END,
          industry_codes = CASE
            WHEN cardinality(EXCLUDED.industry_codes) > 0 THEN EXCLUDED.industry_codes
            ELSE companies.industry_codes
          END,
          source_month = EXCLUDED.source_month
      `;
      // industry_codes is included in both INSERT and ON CONFLICT now
      // (2026-08-26, Session 23 QA Pass follow-up) -- the ON CONFLICT
      // CASE means re-ingesting an existing company on a later day can
      // never overwrite already-populated industry_codes (from either
      // this live call on an earlier day, or the monthly CSV refresh)
      // with an empty result from a failed live lookup. The ON CONFLICT
      // branch itself should no longer normally fire at all as of
      // 2026-09-06 (the `existing` check above already skips this whole
      // block for a company we already have) -- kept only as a safety
      // net for the rare race between that SELECT and this INSERT
      // (e.g. two overlapping manual runs), not as the expected path.

      runStats.newCount++;
    } catch (err) {
      runStats.parseFailures++;
      console.error(`Failed on ${row.Business_Accounting_NO} (${row.Company_Name}):`, err);
    }
  }
}

// A run is "degraded" when a large share of a day's companies came
// back with no industry codes or no region at all — the exact,
// invisible-until-now failure mode found on 2026-08-30. Threshold is
// deliberately generous (50%) to avoid false alarms from ordinary
// day-to-day variance; the real incident this was built to catch sat
// at 0% for six straight days, nowhere near this line.
const DEGRADED_THRESHOLD = 0.5;

// 2026-09-06: widened from just [yesterday, today]. Root cause found
// while sizing a real, measured gap for 方案C (daily-cadence)
// subscribers - scripts/check-gcis-live-recount.ts proved GCIS's own
// live Company_Setup_Date index keeps filling in more of a day's
// registrations for days afterward (captured-on-day averaged 99.8 vs.
// live-count-weeks-later averaged 156.2 across six test dates - roughly
// 36% of a day's eventual registrations aren't visible yet the next
// morning). Since the daily digest's own cadence window is only 2
// calendar days wide (a direct, deliberate user instruction - see
// lib/cadence.ts - not something this change should touch), a
// registration GCIS is slow to index can age out of that window before
// this job ever discovers it, if this job only ever checks "yesterday"
// and "today" once each. scripts/check-silently-dropped-matches.ts's
// refined run measured this precisely: 57.1% of daily-cadence matches
// that WERE captured within a reasonable time of their real
// registration_date still got silently dropped instead of emailed.
//
// Fix: re-check the last DISCOVERY_LOOKBACK_DAYS days' worth of
// Company_Setup_Date every run, not just the two most recent. Chosen
// as a middle ground - comfortably inside the TIMELY_MATCH_DAYS (7)
// window that diagnostic script already treated as "a genuine
// near-real-time capture," while not trying to chase GCIS's index all
// the way out to the multi-week tail the recount script observed
// (that tail is still covered by the existing monthly bulk pipeline,
// same as before this change). Re-checking the same date on multiple
// consecutive days is only cheap because of the `existing` check added
// to ingestDate() alongside this change - see its comment for why this
// doesn't multiply this job's GCIS call volume by DISCOVERY_LOOKBACK_DAYS.
const DISCOVERY_LOOKBACK_DAYS = 5;

async function main() {
  const startedAt = new Date();
  const manualDate = process.env.ROC_DATE;
  const dates = manualDate
    ? [manualDate]
    : Array.from({ length: DISCOVERY_LOOKBACK_DAYS + 1 }, (_, daysAgo) =>
        rocDateForOffset(daysAgo)
      );

  const runStats = {
    rowCount: 0,
    newCount: 0,
    updatedCount: 0,
    parseFailures: 0,
    industryCodeAttempts: 0,
    industryCodeSuccesses: 0,
    regionAttempts: 0,
    regionSuccesses: 0,
  };
  const retryStats = { retryAttempts: 0, retrySuccesses: 0 };
  let status: "success" | "failed" | "partial" = "success";
  let errorLog: string | null = null;

  try {
    // 2026-09-03: each date now gets its own try/catch. Previously, if
    // fetchAllForDate() for the FIRST date (e.g. "yesterday") ran out of
    // fetchWithRetry attempts and threw, the whole for-of loop stopped —
    // the second date ("today") was never even attempted, and neither was
    // retryRecentGaps() or matchAllSearches() below, since those sit
    // after this loop in the same try block. One bad date no longer takes
    // the other date, or the rest of the run, down with it.
    for (const rocDate of dates) {
      try {
        await ingestDate(rocDate, runStats);
      } catch (err) {
        status = "failed";
        const dateErrorMsg = `ingestDate(${rocDate}) failed: ${String(err)}`;
        errorLog = errorLog ? `${errorLog}\n${dateErrorMsg}` : dateErrorMsg;
        console.error(dateErrorMsg);
      }
    }
    if (runStats.parseFailures > 0 && status !== "failed") status = "partial";

    const industryRate =
      runStats.industryCodeAttempts > 0
        ? runStats.industryCodeSuccesses / runStats.industryCodeAttempts
        : 1;
    const regionRate =
      runStats.regionAttempts > 0 ? runStats.regionSuccesses / runStats.regionAttempts : 1;

    if (industryRate < DEGRADED_THRESHOLD || regionRate < DEGRADED_THRESHOLD) {
      status = "failed";
      // 2026-09-03: append rather than overwrite — a per-date failure
      // above (fetchWithRetry exhausted) and a degraded rate here can
      // both be true in the same run, and both are worth keeping in the
      // logged error_log rather than the second one silently discarding
      // the first.
      const degradedMsg =
        `Degraded run: industry_codes success rate ${(industryRate * 100).toFixed(0)}% ` +
        `(${runStats.industryCodeSuccesses}/${runStats.industryCodeAttempts}), ` +
        `address_region success rate ${(regionRate * 100).toFixed(0)}% ` +
        `(${runStats.regionSuccesses}/${runStats.regionAttempts}). ` +
        `Companies were still discovered and stored, just missing these fields — ` +
        `they will be automatically retried by retryRecentGaps() on subsequent runs ` +
        `for up to 14 days without any manual action needed.`;
      errorLog = errorLog ? `${errorLog}\n${degradedMsg}` : degradedMsg;
      console.error(degradedMsg);
    }

    // Runs regardless of today's degraded status — this is what
    // actually closes historical gaps like the 2026-08-18 to 08-25
    // incident, not just flags new ones.
    await retryRecentGaps(retryStats);

    // 2026-08-30: CRITICAL fix found during a coherence re-check of the
    // daily-cadence work above. This script previously never called
    // matchAllSearches() at all — only the MONTHLY bulk ingestion
    // (scripts/run-ingest.ts) did. That meant every day's newly
    // discovered companies were inserted into `companies` but never
    // actually matched against anyone's saved searches until either:
    // (a) a user manually clicked "Run Now" themselves, or (b) the next
    // monthly bulk run, up to ~45 days later. This silently undermined
    // EVERY cadence's core promise, not just the new 'daily' one being
    // built today — a "weekly" digest customer would only ever see
    // matches that existed at the time they last manually ran their
    // search, since nothing was automatically keeping search_matches
    // current in between. Only queries this project's own database
    // (matchSearch() has no external API calls), so there is no
    // GCIS rate-limit concern running this daily, unlike the live
    // profile/industry fetches above.
    console.log("Re-matching all saved searches against today's updated companies table...");
    const matchResult = await matchAllSearches();
    console.log(
      `matchAllSearches: ${matchResult.searchesRun} searches run, ` +
        `${matchResult.searchesSkippedPaused} paused/skipped, ` +
        `${matchResult.totalNewMatches} new match(es) total, ` +
        `${matchResult.failures.length} failure(s).`
    );
    if (matchResult.failures.length > 0) {
      for (const f of matchResult.failures) {
        console.error(`  matchSearch failed for ${f.searchId}: ${f.message}`);
      }
    }
  } catch (err) {
    status = "failed";
    errorLog = String(err);
    console.error("Ingestion run failed:", err);
  }

  await sql`
    INSERT INTO ingestion_runs (
      dataset_name, source_month, row_count, new_count, updated_count,
      parse_failures, status, error_log, started_at, completed_at
    ) VALUES (
      'gcis_daily_setup_query',
      ${dates.map(rocDateToYearMonthLabel).join(",")},
      ${runStats.rowCount},
      ${runStats.newCount},
      ${runStats.updatedCount},
      ${runStats.parseFailures},
      ${status},
      ${errorLog},
      ${startedAt.toISOString()},
      now()
    )
  `;

  console.log(
    `Done. ${runStats.rowCount} seen, ${runStats.newCount} new, ${runStats.updatedCount} already known (skipped), ${runStats.parseFailures} failures. ` +
      `Retry: ${retryStats.retrySuccesses}/${retryStats.retryAttempts} gaps improved. Status: ${status}`
  );

  if (status === "failed") process.exit(1);
}

main();

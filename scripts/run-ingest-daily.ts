/**
 * scripts/run-ingest-daily.ts
 *
 * Standalone entrypoint, run via GitHub Actions on a daily cron
 * (.github/workflows/ingest-daily.yml).
 *
 * Pulls companies approved for setup on a given ROC date from GCIS's
 * open API (confirmed working unauthenticated — see blueprint
 * Section 11, "Session 13 pre-work, 2026-08-12" correction entry),
 * enriches each one with the full-profile endpoint, and upserts into
 * the `companies` table.
 *
 * Queries BOTH yesterday and today's date every run, not just today.
 * Reasons:
 *   1. T-0 (same-day) freshness is unconfirmed as of this writing —
 *      querying yesterday too guarantees no day is silently skipped
 *      if today's batch isn't fully processed by GCIS yet at 06:00 Taipei.
 *   2. The upsert is idempotent (ON CONFLICT DO UPDATE keyed on
 *      uniform_id), so re-querying a date we already have is harmless —
 *      it just re-confirms/updates existing rows, never duplicates.
 *
 * Run manually for a backfill:
 *   ROC_DATE=1150801 npx tsx scripts/run-ingest-daily.ts
 */

import { neon } from "@neondatabase/serverless";

const DISCOVERY_API =
  "https://data.gcis.nat.gov.tw/od/data/api/467E8A3A-72C6-4663-9557-D9D74C597E14";
const PROFILE_API =
  "https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6";

const PAGE_SIZE = 50; // confirmed working value from manual testing; raise later if needed
const PROFILE_FETCH_DELAY_MS = 150; // gentle pacing across the N profile calls — see note at bottom

const sql = neon(process.env.NEON_DATABASE_URL!);

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
  Company_Setup_Date: string; // ROC yyy MM dd, e.g. "1150811"
}

function todayRocDate(): string {
  const now = new Date();
  // Taipei is UTC+8, no DST — shift explicitly rather than trusting the
  // runner's local timezone (GitHub Actions runners are UTC).
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const rocYear = taipei.getUTCFullYear() - 1911;
  const mm = String(taipei.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(taipei.getUTCDate()).padStart(2, "0");
  return `${rocYear}${mm}${dd}`;
}

function yesterdayRocDate(): string {
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  const rocYear = taipei.getUTCFullYear() - 1911;
  const mm = String(taipei.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(taipei.getUTCDate()).padStart(2, "0");
  return `${rocYear}${mm}${dd}`;
}

async function fetchDiscoveryPage(rocDate: string, skip: number): Promise<DiscoveryRow[]> {
  const url = `${DISCOVERY_API}?$format=json&$filter=Company_Setup_Date%20eq%20${rocDate}&$skip=${skip}&$top=${PAGE_SIZE}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Discovery API ${res.status} for ${rocDate} skip=${skip}`);
  }
  const text = await res.text();
  if (!text) return []; // empty body = no more results (e.g. weekend, or end of page range)
  return JSON.parse(text) as DiscoveryRow[];
}

async function fetchAllForDate(rocDate: string): Promise<DiscoveryRow[]> {
  const all: DiscoveryRow[] = [];
  let skip = 0;
  while (true) {
    const page = await fetchDiscoveryPage(rocDate, skip);
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break; // last page
    skip += PAGE_SIZE;
  }
  return all;
}

async function fetchProfile(uniformId: string): Promise<ProfileRow | null> {
  const url = `${PROFILE_API}?$format=json&$filter=Business_Accounting_NO%20eq%20${uniformId}&$skip=0&$top=1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Profile API ${res.status} for ${uniformId}`);
  }
  const text = await res.text();
  if (!text) return null;
  const rows = JSON.parse(text) as ProfileRow[];
  return rows[0] ?? null;
}

function rocDateToIso(roc: string): string {
  // "1150811" -> "2026-08-11"
  const rocYear = parseInt(roc.slice(0, roc.length - 4), 10);
  const mm = roc.slice(-4, -2);
  const dd = roc.slice(-2);
  return `${rocYear + 1911}-${mm}-${dd}`;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ingestDate(rocDate: string, runStats: {
  rowCount: number;
  newCount: number;
  updatedCount: number;
  parseFailures: number;
}) {
  const discovered = await fetchAllForDate(rocDate);
  console.log(`${rocDate}: ${discovered.length} companies from discovery API`);

  for (const row of discovered) {
    runStats.rowCount++;
    try {
      const profile = await fetchProfile(row.Business_Accounting_NO);
      await sleep(PROFILE_FETCH_DELAY_MS);

      const registrationDate = rocDateToIso(rocDate);

      const existing = await sql`
        SELECT uniform_id FROM companies WHERE uniform_id = ${row.Business_Accounting_NO}
      `;
      const isNew = existing.length === 0;

      await sql`
        INSERT INTO companies (
          uniform_id, entity_type, name, capital, address_raw,
          responsible_person, registration_date, status, status_updated_at,
          source_dataset
        ) VALUES (
          ${row.Business_Accounting_NO},
          'company',
          ${profile?.Company_Name ?? row.Company_Name},
          ${profile?.Capital_Stock_Amount ?? null},
          ${profile?.Company_Location ?? null},
          ${profile?.Responsible_Name ?? null},
          ${registrationDate},
          ${profile?.Company_Status_Desc ?? 'active'},
          now(),
          'gcis_daily_setup_query'
        )
        ON CONFLICT (uniform_id) DO UPDATE SET
          name = EXCLUDED.name,
          capital = EXCLUDED.capital,
          address_raw = EXCLUDED.address_raw,
          responsible_person = EXCLUDED.responsible_person,
          status = EXCLUDED.status,
          status_updated_at = now()
      `;
      // NOTE: address_region / address_district are intentionally left
      // for the Address Parser (blueprint Session 8) to populate from
      // address_raw in a separate pass — not duplicated here.

      if (isNew) runStats.newCount++;
      else runStats.updatedCount++;
    } catch (err) {
      runStats.parseFailures++;
      console.error(`Failed on ${row.Business_Accounting_NO} (${row.Company_Name}):`, err);
    }
  }
}

async function main() {
  const startedAt = new Date();
  const manualDate = process.env.ROC_DATE;
  const dates = manualDate ? [manualDate] : [yesterdayRocDate(), todayRocDate()];

  const runStats = { rowCount: 0, newCount: 0, updatedCount: 0, parseFailures: 0 };
  let status: "success" | "failed" | "partial" = "success";
  let errorLog: string | null = null;

  try {
    for (const rocDate of dates) {
      await ingestDate(rocDate, runStats);
    }
    if (runStats.parseFailures > 0) status = "partial";
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
      ${dates.join(",")},
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
    `Done. ${runStats.rowCount} seen, ${runStats.newCount} new, ${runStats.updatedCount} updated, ${runStats.parseFailures} failures. Status: ${status}`
  );

  if (status === "failed") process.exit(1);
}

main();

/**
 * REVIEW BEFORE RELYING ON THIS IN PRODUCTION:
 *
 * 1. Rate limiting is unconfirmed. This script makes one discovery call
 *    plus one profile call PER COMPANY, per day. On a busy weekday that
 *    could be several hundred profile calls in one run. PROFILE_FETCH_DELAY_MS
 *    adds light pacing, but GCIS's actual tolerance has not been tested
 *    at this volume — only single manual requests have been confirmed
 *    working. Watch the first few real runs' logs for errors before
 *    trusting this unattended.
 *
 * 2. industry_codes is not populated here — no industry-code field came
 *    back from either endpoint tested so far. If that turns out to require
 *    a separate API, wire it in as its own enrichment step.
 *
 * 3. entity_type is hardcoded to 'company' — this script only calls the
 *    company-side APIs (公司資料設立查詢). 商業 (sole proprietorship/
 *    partnership) entities need a separate discovery mechanism if you
 *    want them too — no equivalent "設立查詢"-by-date API was found for
 *    商業 in this project's research so far.
 */

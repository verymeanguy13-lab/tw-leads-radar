import { neon } from "@neondatabase/serverless";
import { parseAddress } from "../lib/parsing/address";
import { fetchLiveIndustryCodes } from "../lib/ingestion/fetch-live-industry";

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

function todayRocDate(): string {
  const now = new Date();
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

function rocDateToYearMonthLabel(roc: string): string {
  const rocYear = parseInt(roc.slice(0, roc.length - 4), 10);
  const mm = roc.slice(-4, -2);
  return `${rocYear + 1911}\u5e74${mm}\u6708`;
}

async function fetchDiscoveryPage(rocDate: string, skip: number): Promise<DiscoveryRow[]> {
  const url = `${DISCOVERY_API}?$format=json&$filter=Company_Setup_Date%20eq%20${rocDate}&$skip=${skip}&$top=${PAGE_SIZE}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Discovery API ${res.status} for ${rocDate} skip=${skip}`);
  }
  const text = await res.text();
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
  const sourceMonthLabel = rocDateToYearMonthLabel(rocDate);

  for (const row of discovered) {
    runStats.rowCount++;
    try {
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

      const registrationDate = rocDateToIso(rocDate);
      const rawAddress = profile?.Company_Location ?? null;
      const { region, district } = parseAddress(rawAddress || "");

      const existing = await sql`
        SELECT uniform_id FROM companies WHERE uniform_id = ${row.Business_Accounting_NO}
      `;
      const isNew = existing.length === 0;

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
      // with an empty result from a failed live lookup.

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
    `Done. ${runStats.rowCount} seen, ${runStats.newCount} new, ${runStats.updatedCount} updated, ${runStats.parseFailures} failures. Status: ${status}`
  );

  if (status === "failed") process.exit(1);
}

main();

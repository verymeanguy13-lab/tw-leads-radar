import { neon } from "@neondatabase/serverless";
import { chromium } from "playwright";
import {
  BOOKKEEPER_ASSOCIATIONS,
  NATIONAL_FEDERATION,
  type AssociationSource,
} from "../lib/prospecting/associations.config";
import { fetchStatic, fetchRendered, extractPhone, extractEmail, extractAddress } from "../lib/prospecting/extract-contact";
import { upsertProspectContact } from "../lib/prospecting/upsert";

// Session 25 - Prospect Directory: Bookkeeper Scraper.
//
// Populates prospect_contacts with (a) one row per regional 記帳士公會
// (bookkeeper association) office, and (b) for 台北市 specifically - the
// only association confirmed to expose a full per-member directory -
// one row per individual member.
//
// Idempotent: re-running updates existing rows (matched on name +
// firm_name + region, prospect_contacts' UNIQUE key) rather than
// duplicating them, and never touches a row's do_not_contact or
// outreach_status - see lib/prospecting/upsert.ts.
//
// Performance note: 台北市's directory has ~812 members, and each one
// needs its own detail-page fetch (the listing itself only exposes
// 會員編號/姓名/事務所名稱, no contact info - see Session 25 Step 2). With a
// politeness delay between requests, expect a full run to take on the
// order of 30-60+ minutes. Run this as a background/manual job, not
// something to wait on interactively.
//
// IMPORTANT, per the blueprint's explicit scope boundary: this script
// only builds an organized, traceable contact list for manual outreach.
// It does not send anything to anyone. Do not add bulk-email sending
// on top of this without a separate, deliberate decision - see the
// blueprint's Session 25 prompt for why.

const sql = neon(process.env.DATABASE_URL!);
const DETAIL_FETCH_DELAY_MS = 400;

interface RunSummary {
  processed: number;
  warnings: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertNationalFederation(summary: RunSummary): Promise<void> {
  await upsertProspectContact(sql, {
    contact_type: "bookkeeper_association",
    name: NATIONAL_FEDERATION.name,
    firm_name: NATIONAL_FEDERATION.name,
    region: NATIONAL_FEDERATION.region,
    phone: NATIONAL_FEDERATION.phone,
    email: NATIONAL_FEDERATION.email,
    website: NATIONAL_FEDERATION.url,
    source_url: NATIONAL_FEDERATION.url,
    source_association: NATIONAL_FEDERATION.name,
  });
  summary.processed++;
  console.log(`[OK] ${NATIONAL_FEDERATION.name} (national federation)`);
}

async function applyFederationFallback(
  assoc: AssociationSource,
  reason: string,
  summary: RunSummary
): Promise<void> {
  if (!assoc.federationFallback) {
    console.warn(`[WARN] ${assoc.region} ${assoc.name}: ${reason}, no fallback available - skipping`);
    summary.warnings.push(`${assoc.region} ${assoc.name}: ${reason}, skipped (no fallback)`);
    return;
  }
  console.log(`[INFO] ${assoc.region} ${assoc.name}: ${reason} - using national federation directory fallback`);
  await upsertProspectContact(sql, {
    contact_type: "bookkeeper_association",
    name: assoc.name,
    firm_name: assoc.name,
    region: assoc.region,
    phone: assoc.federationFallback.phone,
    source_url: NATIONAL_FEDERATION.directoryUrl,
    source_association: NATIONAL_FEDERATION.name,
    notes: `${reason}；聯絡資訊取自全國聯合會官網公告之地方公會名冊，非該公會自有網站。${
      assoc.federationFallback.fax ? `傳真：${assoc.federationFallback.fax}` : ""
    }`,
  });
  summary.processed++;
}

async function scrapeAssociationOffice(
  browser: import("playwright").Browser,
  assoc: AssociationSource,
  summary: RunSummary
): Promise<void> {
  if (assoc.knownUnreachable) {
    await applyFederationFallback(assoc, "official domain known unreachable/hijacked", summary);
    return;
  }
  if (!assoc.url) {
    await applyFederationFallback(assoc, "no official site found", summary);
    return;
  }

  let fetched = await fetchStatic(assoc.url);
  let phone = fetched ? extractPhone(fetched.text) : undefined;
  let email = fetched ? extractEmail(fetched.text) : undefined;
  let address = fetched ? extractAddress(fetched.text) : undefined;

  if (!phone && !email) {
    // Static fetch found nothing usable - could be a JS-rendered SPA
    // (confirmed for at least one association this session). Retry
    // with a real browser render before giving up.
    fetched = await fetchRendered(browser, assoc.url);
    if (fetched) {
      phone = extractPhone(fetched.text);
      email = extractEmail(fetched.text);
      address = extractAddress(fetched.text);
    }
  }

  if (!phone && !email) {
    await applyFederationFallback(assoc, "site reachable but no contact info could be extracted", summary);
    return;
  }

  await upsertProspectContact(sql, {
    contact_type: "bookkeeper_association",
    name: assoc.name,
    firm_name: assoc.name,
    region: assoc.region,
    phone,
    email,
    website: assoc.url,
    source_url: assoc.url,
    source_association: assoc.name,
    notes: address ? `地址：${address}` : undefined,
  });
  summary.processed++;
  console.log(`[OK] ${assoc.region} ${assoc.name}`);
}

interface TaipeiRow {
  memberId: string;
  name: string;
  firmName: string;
  detailHref: string | null;
}

async function scrapeTaipeiDirectory(
  browser: import("playwright").Browser,
  assoc: AssociationSource,
  summary: RunSummary
): Promise<void> {
  if (!assoc.url) return;
  const page = await browser.newPage();

  // Districts confirmed 2026-09-05: type_id/parent_id 1-13, one per
  // Taipei district (松山, 信義, 大安, 中山, 中正, 大同, 萬華, 文山, 南港,
  // 內湖, 士林, 北投, plus an "其他區域" catch-all as #13).
  const DISTRICT_COUNT = 13;

  try {
    for (let districtId = 1; districtId <= DISTRICT_COUNT; districtId++) {
      const districtUrl = `${assoc.url}?type_id=${districtId}&parent_id=${districtId}&top=0`;
      try {
        await page.goto(districtUrl, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1500);

        // Listing columns confirmed 2026-09-05: 會員編號, 會員姓名, 事務所名稱.
        // No phone/email column here - never assumed, only looked for on
        // the per-member detail page below (Session 25 Step 2).
        const rows: TaipeiRow[] = await page.evaluate(() => {
          const trs = Array.from(document.querySelectorAll("table tr"));
          return trs
            .map((tr) => {
              const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "");
              if (cells.length < 3) return null;
              const link = tr.querySelector("a");
              return {
                memberId: cells[0],
                name: cells[1],
                firmName: cells[2],
                detailHref: link?.getAttribute("href") ?? null,
              };
            })
            .filter(
              (r): r is TaipeiRow => r !== null && r.memberId !== "" && r.memberId !== "會員編號"
            );
        });

        if (rows.length === 0) {
          console.warn(
            `[WARN] 台北市記帳士公會 district ${districtId}: no member rows rendered - page structure may have changed, or this district is genuinely empty`
          );
          summary.warnings.push(`台北市 district ${districtId}: no rows rendered`);
          continue;
        }

        for (const row of rows) {
          if (!row.name || !row.firmName) continue;

          let phone: string | undefined;
          let email: string | undefined;
          let detailUrl: string | undefined;

          if (row.detailHref) {
            try {
              detailUrl = new URL(row.detailHref, districtUrl).toString();
              const detail = await fetchRendered(browser, detailUrl);
              if (detail) {
                phone = extractPhone(detail.text);
                email = extractEmail(detail.text);
              }
            } catch {
              // Bad/unparseable href - fall through with no detail data
              // rather than failing the whole member row.
              detailUrl = undefined;
            }
            await sleep(DETAIL_FETCH_DELAY_MS);
          }

          await upsertProspectContact(sql, {
            contact_type: "bookkeeper",
            name: row.name,
            firm_name: row.firmName,
            region: "台北市",
            phone,
            email,
            source_url: detailUrl ?? districtUrl,
            source_association: assoc.name,
            notes:
              !phone && !email
                ? "會員詳情頁未提供電話或電子郵件欄位（未確認過此頁面結構，非擷取失敗）"
                : undefined,
          });
          summary.processed++;
        }

        console.log(`[OK] 台北市記帳士公會 district ${districtId}: ${rows.length} members processed`);
      } catch (err) {
        console.warn(`[WARN] 台北市記帳士公會 district ${districtId}: failed - ${String(err)}`);
        summary.warnings.push(`台北市 district ${districtId}: fetch failed - ${String(err)}`);
      }
    }
  } finally {
    await page.close();
  }
}

async function main() {
  const summary: RunSummary = { processed: 0, warnings: [] };

  console.log("Upserting national federation contact...");
  await upsertNationalFederation(summary);

  const browser = await chromium.launch({ headless: true });

  try {
    for (const assoc of BOOKKEEPER_ASSOCIATIONS) {
      if (assoc.hasMemberDirectory) {
        console.log(`Scraping full member directory for ${assoc.region} ${assoc.name}...`);
        await scrapeTaipeiDirectory(browser, assoc, summary);
      } else {
        await scrapeAssociationOffice(browser, assoc, summary);
      }
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== Session 25 scrape summary ===");
  console.log(`Rows inserted/updated: ${summary.processed}`);
  console.log(`Warnings: ${summary.warnings.length}`);
  for (const w of summary.warnings) {
    console.log(`  - ${w}`);
  }
}

main().catch((err) => {
  console.error("scrape-bookkeepers.ts failed:", err);
  process.exit(1);
});

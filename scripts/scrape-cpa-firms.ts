import { neon } from "@neondatabase/serverless";
import { CPA_FIRMS, type CpaFirmBranch } from "../lib/prospecting/cpa-firms.config";
import { fetchStatic, fetchRendered, extractPhone, extractEmail, extractAddress } from "../lib/prospecting/extract-contact";
import { upsertProspectContact } from "../lib/prospecting/upsert";

// Session 26 - Prospect Directory: CPA Firm Contacts.
//
// Populates prospect_contacts with contact_type = 'cpa_firm' rows from
// the curated seed list in lib/prospecting/cpa-firms.config.ts (see
// that file for why 和繼會計師事務所 is excluded). Each firm's own
// official contact page is fetched live here - the seed list only
// records which firms/branches to look for, not their contact values,
// per Session 26 Step 1 ("pull only what the firm itself publishes").
//
// "Firms already present from Session 25 are matched and not
// duplicated" (Session 26 objective): satisfied by construction, not
// by an explicit dedup check - Session 25 only ever writes
// contact_type IN ('bookkeeper', 'bookkeeper_association') rows keyed
// on association/member names, which live in a completely separate
// name space from these firm names, so prospect_contacts' own
// (name, firm_name, region) UNIQUE key can't collide across the two
// scripts. Re-running this script IS idempotent against itself, same
// mechanism as Session 25 - see lib/prospecting/upsert.ts.

const sql = neon(process.env.DATABASE_URL!);

interface RunSummary {
  processed: number;
  warnings: string[];
}

// Finds the text window belonging to one branch on a contact page that
// lists several branches together: from the branch label's first
// occurrence up to the next recognized branch label (or a fixed cap),
// so extractPhone/extractEmail/extractAddress run against just that
// branch's own text rather than the whole page.
function branchWindow(fullText: string, branch: CpaFirmBranch, allBranches: CpaFirmBranch[]): string | undefined {
  const startIdx = fullText.indexOf(branch.label);
  if (startIdx === -1) return undefined;

  const searchFrom = startIdx + branch.label.length;
  let endIdx = fullText.length;
  for (const other of allBranches) {
    if (other.label === branch.label) continue;
    const otherIdx = fullText.indexOf(other.label, searchFrom);
    if (otherIdx !== -1 && otherIdx < endIdx) endIdx = otherIdx;
  }
  // Cap the window even with no next-label match, so a mis-set/missing
  // boundary can't pull in unrelated page content far below.
  endIdx = Math.min(endIdx, searchFrom + 400);

  return fullText.slice(startIdx, endIdx);
}

async function processFirm(
  browser: import("playwright").Browser,
  firm: (typeof CPA_FIRMS)[number],
  summary: RunSummary
): Promise<void> {
  let fetched = await fetchStatic(firm.contactPageUrl);
  if (!fetched || (!extractPhone(fetched.text) && !extractEmail(fetched.text))) {
    const rendered = await fetchRendered(browser, firm.contactPageUrl);
    if (rendered) fetched = rendered;
  }

  if (!fetched) {
    console.warn(`[WARN] ${firm.firmName}: contact page unreachable (${firm.contactPageUrl}) - skipping all branches`);
    summary.warnings.push(`${firm.firmName}: contact page unreachable, all branches skipped`);
    return;
  }

  const pageWidePhone = extractPhone(fetched.text);
  const pageWideEmail = extractEmail(fetched.text);

  for (const branch of firm.branches) {
    const window = branchWindow(fetched.text, branch, firm.branches);

    let phone = window ? extractPhone(window) : undefined;
    let email = window ? extractEmail(window) : undefined;
    const address = window ? extractAddress(window) : undefined;

    let lowConfidence = false;
    if (!phone && !email && (pageWidePhone || pageWideEmail)) {
      // Couldn't isolate this specific branch's own contact block - fall
      // back to whatever the page has firm-wide rather than leaving it
      // fully blank, but say so plainly in `notes` (Session 26 Step 4
      // spirit: don't silently present a lower-confidence match as if
      // it were branch-specific).
      phone = pageWidePhone;
      email = pageWideEmail;
      lowConfidence = true;
    }

    const contactMethod = !phone && !email ? "form_only" : undefined;

    await upsertProspectContact(sql, {
      contact_type: "cpa_firm",
      name: `${firm.firmName}（${branch.label}）`,
      firm_name: firm.firmName,
      region: branch.region,
      phone,
      email,
      website: firm.contactPageUrl,
      source_url: firm.contactPageUrl,
      seed_source: firm.seedSource,
      contact_method: contactMethod,
      notes: [
        address ? `地址：${address}` : null,
        lowConfidence ? "無法精確定位此分所專屬聯絡資訊，已使用該事務所頁面整體聯絡資訊代替" : null,
        contactMethod === "form_only" ? "官網僅提供聯絡表單，未見公開電話或電子郵件" : null,
      ]
        .filter(Boolean)
        .join("；") || undefined,
    });
    summary.processed++;
    console.log(`[OK] ${firm.firmName}（${branch.label}）${contactMethod === "form_only" ? "- form_only" : ""}`);
  }
}

async function main() {
  const summary: RunSummary = { processed: 0, warnings: [] };
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    for (const firm of CPA_FIRMS) {
      await processFirm(browser, firm, summary);
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== Session 26 scrape summary ===");
  console.log(`Rows inserted/updated: ${summary.processed}`);
  console.log(`Warnings: ${summary.warnings.length}`);
  for (const w of summary.warnings) {
    console.log(`  - ${w}`);
  }
}

main().catch((err) => {
  console.error("scrape-cpa-firms.ts failed:", err);
  process.exit(1);
});

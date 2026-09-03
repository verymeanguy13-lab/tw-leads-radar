import { Resend } from "resend";
import { db } from "../db";
import { formatCapital, formatDate } from "../utils";
import { getUserTier } from "../tiers";
import { ATTRIBUTION_AGENCY, ATTRIBUTION_NAME_ZH } from "../attribution";
import type { Company } from "../../types/db";

const resend = new Resend(process.env.RESEND_API_KEY!);

const STATUS_LABEL: Record<string, string> = {
  active: "營運中",
  changed: "已異動",
  dissolved: "已解散",
  suspended: "停業中",
};

// "Due" is derived rather than read off a column - there is no
// last_sent_at on saved_searches, it's computed per search from
// search_matches.surfaced_at (see the query below). See the 2026-08-30
// comment further down for why every cadence now uses a real
// day-since-last-sent threshold, not just monthly.
//
// Thresholds are set slightly BELOW their nominal period (0.9 days for
// "daily" instead of exactly 1.0, 6.5 instead of exactly 7 for
// "weekly") to tolerate normal GitHub Actions cron jitter - scheduled
// runs aren't guaranteed to fire at the exact second every day, and a
// strict >= 1.0 threshold could occasionally compute a gap of e.g.
// 0.998 days on a slightly-early run and wrongly skip that day's send
// entirely. The buffer is small enough that it still can't cause two
// sends within the same real day if the workflow were somehow
// triggered twice (scheduled + a manual workflow_dispatch), since
// that gap would be a small fraction of a day, nowhere near 0.9.
const CADENCE_DUE_AFTER_DAYS: Record<string, number> = {
  daily: 0.9,
  weekly: 6.5,
  monthly: 28,
};

export interface DueSearch {
  id: string;
  name: string;
  cadence: string;
  userId: string;
  userEmail: string;
}

export interface DigestSendResult {
  searchId: string;
  searchName: string;
  sent: boolean;
  matchCount: number;
  statusChangedCount: number;
  error?: string;
}

export async function getDueSavedSearches(): Promise<DueSearch[]> {
  const sql = db();

  const rows = await sql`
    SELECT
      ss.id,
      ss.name,
      ss.cadence,
      u.id AS user_id,
      u.email AS user_email,
      (
        SELECT MAX(sm.surfaced_at)
        FROM search_matches sm
        WHERE sm.saved_search_id = ss.id AND sm.surfaced_in_digest = true
      ) AS last_sent_at
    FROM saved_searches ss
    JOIN users u ON u.id = ss.user_id
    WHERE ss.paused = false
  `;

  const due: DueSearch[] = [];
  for (const r of rows as {
    id: string;
    name: string;
    cadence: string;
    user_id: string;
    user_email: string;
    last_sent_at: string | null;
  }[]) {
    // 2026-08-30: rewritten to use real day-since-last-sent thresholds
    // for EVERY cadence, not just monthly. Previously 'weekly' was
    // unconditionally "always due" - this only produced correct
    // once-a-week behavior because digest.yml's cron itself only ran
    // once a week. Now that digest.yml runs daily (needed for 'daily'
    // cadence to be deliverable at all - see the workflow's own
    // comment), an unconditional "always due" for weekly would have
    // sent weekly-tier customers a digest every single day instead of
    // once a week. This function is now cadence-frequency-agnostic:
    // adding a new cadence in the future just means adding one entry
    // to CADENCE_DUE_AFTER_DAYS, no branching logic to duplicate.
    const dueAfterDays = CADENCE_DUE_AFTER_DAYS[r.cadence];
    if (dueAfterDays === undefined) {
      console.error(`Unknown cadence "${r.cadence}" on saved_search ${r.id} - skipping.`);
      continue;
    }

    if (!r.last_sent_at) {
      due.push({
        id: r.id,
        name: r.name,
        cadence: r.cadence,
        userId: r.user_id,
        userEmail: r.user_email,
      });
      continue;
    }

    const daysSinceLastSent =
      (Date.now() - new Date(r.last_sent_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastSent >= dueAfterDays) {
      due.push({
        id: r.id,
        name: r.name,
        cadence: r.cadence,
        userId: r.user_id,
        userEmail: r.user_email,
      });
    }
  }
  return due;
}

async function getDatasetFreshness(
  datasetNames: string[]
): Promise<Map<string, string>> {
  const freshness = new Map<string, string>();
  if (datasetNames.length === 0) return freshness;

  const sql = db();
  const rows = await sql`
    SELECT DISTINCT ON (dataset_name) dataset_name, completed_at
    FROM ingestion_runs
    WHERE status = 'success' AND dataset_name = ANY(${datasetNames})
    ORDER BY dataset_name, completed_at DESC
  `;
  for (const r of rows as { dataset_name: string; completed_at: string }[]) {
    freshness.set(r.dataset_name, r.completed_at);
  }
  return freshness;
}

function mapsUrl(name: string, address: string | null) {
  const query = encodeURIComponent(`${name} ${address ?? ""}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function renderCompanyRow(
  c: Company,
  freshness: Map<string, string>,
  options: { statusChangeNotice?: boolean } = {}
): string {
  const statusLabel = STATUS_LABEL[c.status] ?? c.status;
  const freshAt = c.source_dataset ? freshness.get(c.source_dataset) : undefined;
  const freshnessNote =
    (c.status === "dissolved" || c.status === "suspended") && freshAt
      ? `<br/><span style="color:#6b7280;font-size:12px;">資料來源更新於：${formatDate(freshAt)}</span>`
      : "";
  // Session 17: a distinct notice for rows in the "status changed" section,
  // separate from the dissolved/suspended data-source freshness note above -
  // this answers a different question (this changed since you started
  // tracking it, not how fresh the source data is).
  const changeNotice = options.statusChangeNotice
    ? `<br/><span style="color:#b45309;font-size:12px;font-weight:600;">⚠ 狀態自加入追蹤後已變更</span>`
    : "";

  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e2e5ea;">
        <div style="font-weight:600;">${c.name}</div>
        <div style="color:#6b7280;font-size:13px;">
          統一編號：${c.uniform_id}　登記日期：${formatDate(c.registration_date)}
        </div>
        <div style="color:#6b7280;font-size:13px;">
          ${c.address_region ?? "-"}　${c.address_raw ?? ""}
        </div>
        <div style="color:#6b7280;font-size:13px;">
          負責人：${c.responsible_person ?? "-"}
        </div>
        <div style="color:#6b7280;font-size:13px;">
          資本額：${formatCapital(c.capital)}　狀態：${statusLabel}${freshnessNote}${changeNotice}
        </div>
        <div style="font-size:13px;margin-top:4px;">
          <a href="${mapsUrl(c.name, c.address_raw)}" style="color:#2563eb;">Google 地圖查詢</a>
        </div>
      </td>
    </tr>
  `;
}

/**
 * Sends the digest for one saved_search if it has unsurfaced matches
 * OR previously-surfaced matches whose status has since changed to
 * dissolved/changed (Session 17). Returns sent:false (not an error)
 * when there's genuinely nothing to report - per Session 16's
 * objective, empty searches stay skipped, not emailed.
 */
export async function sendDigestForSearch(search: DueSearch): Promise<DigestSendResult> {
  const sql = db();

  // Freshness-tier gating (same rule as lib/matching/engine.ts's
  // matchSearch() and app/(app)/searches/[id]/page.tsx): free tier only
  // gets entity_type='company' rows once companies.registration_date is
  // 30+ days old (falling back to created_at when registration_date is
  // NULL) - registration_date is the company's actual government
  // registration date, not when our system happened to import the row,
  // which matters a lot here since Session 20b's historical backfill
  // bulk-inserted ~43,599 rows within one recent window (see
  // matchSearch()'s comment for the full story of why created_at alone
  // was wrong). Applied here too, not just at match-time, because
  // matchSearch() only ever inserts into search_matches and never
  // deletes - a row that matched before this gate existed, or before a
  // downgrade, would otherwise still get emailed out.
  const tier = await getUserTier(search.userId);
  const isFreeTier = tier === "free";

  const newMatches = await sql`
    SELECT c.*, sm.id AS match_id
    FROM search_matches sm
    JOIN companies c ON c.uniform_id = sm.company_uniform_id
    WHERE sm.saved_search_id = ${search.id} AND sm.surfaced_in_digest = false
      AND (c.entity_type = 'business' OR ${!isFreeTier} OR COALESCE(c.registration_date, c.created_at::date) <= (now() - interval '30 days')::date)
      AND c.suppressed_at IS NULL
    ORDER BY c.registration_date DESC NULLS LAST
  `;

  const changedMatches = await sql`
    SELECT c.*, sm.id AS match_id
    FROM search_matches sm
    JOIN companies c ON c.uniform_id = sm.company_uniform_id
    WHERE sm.saved_search_id = ${search.id}
      AND sm.surfaced_in_digest = true
      AND (c.status = 'dissolved' OR c.status = 'changed')
      AND c.status_updated_at > sm.surfaced_at
      AND (c.entity_type = 'business' OR ${!isFreeTier} OR COALESCE(c.registration_date, c.created_at::date) <= (now() - interval '30 days')::date)
      AND c.suppressed_at IS NULL
    ORDER BY c.status_updated_at DESC
  `;

  const newRows = newMatches as (Company & { match_id: string })[];
  const changedRows = changedMatches as (Company & { match_id: string })[];

  if (newRows.length === 0 && changedRows.length === 0) {
    return {
      searchId: search.id,
      searchName: search.name,
      sent: false,
      matchCount: 0,
      statusChangedCount: 0,
    };
  }

  const allRows = [...newRows, ...changedRows];
  const flaggedDatasets = Array.from(
    new Set(
      allRows
        .filter((r) => r.status === "dissolved" || r.status === "suspended")
        .map((r) => r.source_dataset)
        .filter((d): d is string => !!d)
    )
  );
  const freshness = await getDatasetFreshness(flaggedDatasets);

  // Cap how many rows actually get rendered into the email body - added
  // 2026-08-28 after this hit Resend's 40MB size limit in production.
  // Root cause: the same day's registration_date backfill (see
  // architecture.md's "Post-Session-23 fixes" entry) retroactively made
  // thousands of previously-invisible matches visible all at once for
  // broad searches, and this function had no limit on how many of them
  // it would render as individual HTML table rows - one search alone
  // tried to render 8,977 rows in a single email. IMPORTANT: `newRows`
  // and `changedRows` themselves stay un-truncated below (subject line
  // count and the surfaced_in_digest UPDATE both still use the full
  // arrays) - only the rendered HTML is capped. Truncating the arrays
  // themselves would have caused the overflow rows to never get marked
  // surfaced, meaning they'd count as "new" again the next time this
  // search's digest runs, forever, and the same-sized email would just
  // fail the same way again.
  const MAX_RENDERED_ROWS_PER_SECTION = 50;
  const newRowsToRender = newRows.slice(0, MAX_RENDERED_ROWS_PER_SECTION);
  const changedRowsToRender = changedRows.slice(0, MAX_RENDERED_ROWS_PER_SECTION);

  const newRowsHtml = newRowsToRender.map((r) => renderCompanyRow(r, freshness)).join("");
  const changedRowsHtml = changedRowsToRender
    .map((r) => renderCompanyRow(r, freshness, { statusChangeNotice: true }))
    .join("");

  const newOverflowCount = newRows.length - newRowsToRender.length;
  const changedOverflowCount = changedRows.length - changedRowsToRender.length;
  const newOverflowNote =
    newOverflowCount > 0
      ? `<p style="color:#6b7280;font-size:12px;margin-top:8px;">還有 ${newOverflowCount} 筆新符合結果未顯示，請登入查看完整清單。</p>`
      : "";
  const changedOverflowNote =
    changedOverflowCount > 0
      ? `<p style="color:#6b7280;font-size:12px;margin-top:8px;">還有 ${changedOverflowCount} 筆狀態異動未顯示，請登入查看完整清單。</p>`
      : "";

  const subjectParts: string[] = [];
  if (newRows.length > 0) subjectParts.push(`${newRows.length} 筆新符合結果`);
  if (changedRows.length > 0) subjectParts.push(`${changedRows.length} 筆狀態異動`);
  const subjectSummary = subjectParts.join("、");

  // Attribution (2026-09-03): completes the consolidation started in
  // lib/attribution.ts (see that file's comment) - the results page and
  // CSV export already carried this required credit line, the digest
  // email was the one place company data reaches a user without it.
  // Scoped to only the datasets actually represented among the RENDERED
  // rows below, not the truncated overflow (which isn't actually shown
  // in this email) - same scoping rule as
  // app/(app)/searches/[id]/page.tsx's displayedDatasetIds.
  const displayedDatasetIds = Array.from(
    new Set(
      [...newRowsToRender, ...changedRowsToRender]
        .map((r) => r.source_dataset)
        .filter((d): d is string => !!d)
    )
  );
  const attributionHtml = displayedDatasetIds
    .filter((dsId) => ATTRIBUTION_NAME_ZH[dsId])
    .map(
      (dsId) =>
        `<p style="margin:2px 0;">提供機關／${ATTRIBUTION_AGENCY} ${new Date().getFullYear()} ${ATTRIBUTION_NAME_ZH[dsId]}，依政府資料開放授權條款進行公開徵集及加值利用</p>`
    )
    .join("");

  const sectionsHtml = `
    ${
      newRows.length > 0
        ? `<h3 style="margin-bottom:4px;">新符合結果</h3><table style="width:100%;border-collapse:collapse;margin-bottom:16px;">${newRowsHtml}</table>${newOverflowNote}`
        : ""
    }
    ${
      changedRows.length > 0
        ? `<h3 style="margin-bottom:4px;">狀態異動通知</h3><table style="width:100%;border-collapse:collapse;">${changedRowsHtml}</table>${changedOverflowNote}`
        : ""
    }
  `;

  // 2026-09-03: added after a real test send landed in Gmail spam despite
  // taiwanleads.com's SPF/DKIM/DMARC all showing verified in Resend - the
  // domain-auth side was fine, so this targets the other big spam signal
  // Gmail and other providers weigh heavily: bulk-looking mail with no way
  // to opt out. The List-Unsubscribe(-Post) headers are what let Gmail
  // show its own native "Unsubscribe" button next to the sender name
  // (RFC 8058 - a client-initiated POST with no page load), and the
  // footer link covers clients that don't support that. Both hit the same
  // endpoint (app/api/searches/[id]/unsubscribe/route.ts), deliberately
  // unauthenticated - see that route's own comment for why that's safe.
  const unsubscribeUrl = `${process.env.NEXTAUTH_URL}/api/searches/${search.id}/unsubscribe`;

  const html = `
    <div style="font-family:sans-serif;color:#1a1d23;max-width:600px;">
      <h2 style="margin-bottom:4px;">「${search.name}」有 ${subjectSummary}</h2>
      <p style="color:#6b7280;font-size:13px;margin-top:0;">新公司快報</p>
      ${sectionsHtml}
      ${
        attributionHtml
          ? `<div style="color:#6b7280;font-size:12px;margin-top:16px;">${attributionHtml}</div>`
          : ""
      }
      <p style="color:#6b7280;font-size:12px;margin-top:24px;">
        登入查看完整結果：<a href="${process.env.NEXTAUTH_URL}/searches/${search.id}" style="color:#2563eb;">taiwanleads.com</a>
        　|
        <a href="${unsubscribeUrl}" style="color:#6b7280;">取消此通知</a>
      </p>
    </div>
  `;

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM || "onboarding@resend.dev",
    to: search.userEmail,
    subject: `「${search.name}」有 ${subjectSummary} — 新公司快報`,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  if (result.error) {
    return {
      searchId: search.id,
      searchName: search.name,
      sent: false,
      matchCount: newRows.length,
      statusChangedCount: changedRows.length,
      error: result.error.message,
    };
  }

  if (newRows.length > 0) {
    const newMatchIds = newRows.map((r) => r.match_id);
    await sql`
      UPDATE search_matches
      SET surfaced_in_digest = true, surfaced_at = now()
      WHERE id = ANY(${newMatchIds}::uuid[])
    `;
  }
  if (changedRows.length > 0) {
    // Reset the change-tracking window so the same status change isn't
    // flagged again next run - only a further change after this point
    // would trigger the notice again.
    const changedMatchIds = changedRows.map((r) => r.match_id);
    await sql`
      UPDATE search_matches
      SET surfaced_at = now()
      WHERE id = ANY(${changedMatchIds}::uuid[])
    `;
  }

  return {
    searchId: search.id,
    searchName: search.name,
    sent: true,
    matchCount: newRows.length,
    statusChangedCount: changedRows.length,
  };
}
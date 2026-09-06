import { Resend } from "resend";
import { db } from "../db";
import { formatCapital, formatDate } from "../utils";
import { getUserTier } from "../tiers";
import type { Cadence } from "../tiers";
import { getCadenceWindow } from "../cadence";
import { ATTRIBUTION_AGENCY, ATTRIBUTION_NAME_ZH } from "../attribution";
import {
  maskUniformId,
  maskCompanyName,
  maskPersonName,
  isNarrowResultSet,
  maskCapitalToBracket,
  maskRegistrationDateToWeek,
} from "../masking";
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

// mask/narrow (2026-09-05, business-model change): this function
// previously had NO masking option at all - every recipient, free tier
// included, got the fully unmasked row (real uniform ID, real name,
// real full address, a working Maps link built from the real name +
// address). That was already inconsistent with the redaction promise
// made on /search and on the pricing page before this change even
// happened - free tier's search results and dashboard view were never
// unmasked, but their email digests always were. Now that free tier's
// search results are current (no more 30-day freshness gate - see
// lib/matching/engine.ts and architecture.md's 2026-09-05 entry),
// leaving digest emails unmasked would completely defeat the point:
// the exact thing being protected against (a fresh, live lead) would
// arrive by email unmasked regardless of what /search or the results
// page do. `mask` applies the same three field masks used everywhere
// else; `narrow` additionally coarsens capital/date, mirroring
// lib/masking.ts's isNarrowResultSet() floor.
function renderCompanyRow(
  c: Company,
  freshness: Map<string, string>,
  options: { statusChangeNotice?: boolean; mask?: boolean; narrow?: boolean } = {}
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

  const mask = options.mask ?? false;
  const narrow = options.narrow ?? false;

  const displayName = mask ? maskCompanyName(c.name) : c.name;
  const displayUniformId = mask ? maskUniformId(c.uniform_id) : c.uniform_id;
  const displayPerson = mask ? maskPersonName(c.responsible_person) : c.responsible_person;
  const displayCapital = narrow ? maskCapitalToBracket(c.capital) : formatCapital(c.capital);
  const displayDate = narrow
    ? maskRegistrationDateToWeek(c.registration_date)
    : formatDate(c.registration_date);

  // Full street address + a Maps link built from the real name/address
  // would each independently undo the three masked fields above - both
  // are dropped entirely for a masked row, same as
  // app/(app)/searches/[id]/page.tsx's masked view. address_region
  // alone (already shown unmasked on /search too) stays visible.
  const addressLine = mask
    ? `${c.address_region ?? "-"}`
    : `${c.address_region ?? "-"}　${c.address_raw ?? ""}`;
  const mapsLine = mask
    ? `<a href="${process.env.NEXTAUTH_URL}/pricing" style="color:#2563eb;">升級查看完整地址與地圖</a>`
    : `<a href="${mapsUrl(c.name, c.address_raw)}" style="color:#2563eb;">Google 地圖查詢</a>`;

  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e2e5ea;">
        <div style="font-weight:600;">${displayName}</div>
        <div style="color:#6b7280;font-size:13px;">
          統一編號：${displayUniformId}　登記日期：${displayDate}
        </div>
        <div style="color:#6b7280;font-size:13px;">
          ${addressLine}
        </div>
        <div style="color:#6b7280;font-size:13px;">
          負責人：${displayPerson ?? "-"}
        </div>
        <div style="color:#6b7280;font-size:13px;">
          資本額：${displayCapital}　狀態：${statusLabel}${freshnessNote}${changeNotice}
        </div>
        <div style="font-size:13px;margin-top:4px;">
          ${mapsLine}
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

  // No freshness/tier gating here (removed 2026-09-05): a 30-day gate
  // used to sit in both queries below, mirroring
  // lib/matching/engine.ts's matchSearch(). Free tier now gets fully
  // CURRENT matches in its digest email too - masking (isFreeTier,
  // used further down to render each row) is the only thing that still
  // differs by tier. See architecture.md's 2026-09-05 "redaction is now
  // the only free-tier gate" entry.
  const tier = await getUserTier(search.userId);
  const isFreeTier = tier === "free";

  // Cadence content window (2026-09-05, direct user instruction; fixed
  // 2026-09-06 - see lib/cadence.ts's getCadenceWindow() for the full
  // story): a daily search's digest should only ever talk about
  // yesterday and the day before - two complete calendar days, never a
  // same-day sliver of "today" - weekly the last 7 complete days,
  // monthly the last 30, NOT "everything that's accumulated since
  // surfaced_in_digest was last flipped," which is what this used to be
  // (see the un-windowed query this replaced, still visible in git
  // history). `now` is captured once here and reused both for the
  // window boundary and for the `at` parameter on this email's CSV
  // download link below, so the link always reproduces exactly what
  // this specific send actually queried - not "whatever this search
  // currently has" if someone clicks it later.
  const now = new Date();
  const { windowStartDate, windowEndDate } = getCadenceWindow(search.cadence as Cadence, now);

  const newMatches = await sql`
    SELECT c.*, sm.id AS match_id
    FROM search_matches sm
    JOIN companies c ON c.uniform_id = sm.company_uniform_id
    WHERE sm.saved_search_id = ${search.id} AND sm.surfaced_in_digest = false
      AND c.suppressed_at IS NULL
      AND c.registration_date IS NOT NULL
      AND c.registration_date >= ${windowStartDate}
      AND c.registration_date <= ${windowEndDate}
    ORDER BY c.registration_date DESC NULLS LAST
  `;

  // A match that's unsurfaced but already outside this cadence's own
  // window (registered too long ago to fit a daily/weekly/monthly
  // window, or missing a registration_date entirely) can never validly
  // become "in window" on some later run either - a saved search has
  // exactly one cadence, so waiting would just grow an invisible
  // backlog forever. Mark these surfaced (without emailing them) in the
  // same run that would otherwise have kept skipping them, regardless
  // of whether this run ends up sending anything at all.
  const staleMatchRows = await sql`
    SELECT sm.id AS match_id
    FROM search_matches sm
    JOIN companies c ON c.uniform_id = sm.company_uniform_id
    WHERE sm.saved_search_id = ${search.id} AND sm.surfaced_in_digest = false
      AND c.suppressed_at IS NULL
      AND (
        c.registration_date IS NULL
        OR c.registration_date < ${windowStartDate}
        OR c.registration_date > ${windowEndDate}
      )
  `;
  const staleMatchIds = (staleMatchRows as { match_id: string }[]).map((r) => r.match_id);
  if (staleMatchIds.length > 0) {
    await sql`
      UPDATE search_matches
      SET surfaced_in_digest = true, surfaced_at = now()
      WHERE id = ANY(${staleMatchIds}::uuid[])
    `;
  }

  const changedMatches = await sql`
    SELECT c.*, sm.id AS match_id
    FROM search_matches sm
    JOIN companies c ON c.uniform_id = sm.company_uniform_id
    WHERE sm.saved_search_id = ${search.id}
      AND sm.surfaced_in_digest = true
      AND (c.status = 'dissolved' OR c.status = 'changed')
      AND c.status_updated_at > sm.surfaced_at
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

  // See lib/masking.ts's isNarrowResultSet() comment - applies here the
  // same way it does on /search and the results page: once this
  // particular search's total match count (new + changed, before the
  // render cap below) is this small, exact capital/date become
  // identifying enough on their own to warrant coarsening, on top of
  // the name/ID/person masking `mask` already applies below. Only
  // matters for free tier - a paid recipient's email is never masked or
  // coarsened.
  const narrow = isFreeTier && isNarrowResultSet(newRows.length + changedRows.length);

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

  const newRowsHtml = newRowsToRender
    .map((r) => renderCompanyRow(r, freshness, { mask: isFreeTier, narrow }))
    .join("");
  const changedRowsHtml = changedRowsToRender
    .map((r) =>
      renderCompanyRow(r, freshness, { statusChangeNotice: true, mask: isFreeTier, narrow })
    )
    .join("");

  const newOverflowCount = newRows.length - newRowsToRender.length;
  const changedOverflowCount = changedRows.length - changedRowsToRender.length;
  // 2026-09-05: the CSV download link below (built from the same
  // `newRows` this overflow count is derived from, not just the
  // rendered/capped subset) already contains every row this note is
  // telling the reader about, so it's pointed at that link instead of
  // "請登入查看完整清單" - a recipient who wants the missing rows no
  // longer has to log in for them, they can pull the CSV directly.
  const newOverflowNote =
    newOverflowCount > 0
      ? `<p style="color:#6b7280;font-size:12px;margin-top:8px;">還有 ${newOverflowCount} 筆新符合結果未於此顯示，可透過下方 CSV 下載連結取得完整清單，或登入查看。</p>`
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

  // CSV download link (2026-09-05, direct user instruction): replaces
  // the idea of attaching a CSV file to the email - an attachment goes
  // through the same HTML-formatting risk the user was avoiding, and
  // Resend has no clean way to attach a file whose content depends on
  // per-recipient masking anyway. `at=${now...}` is the SAME `now` used
  // to compute this send's own registration_date window above, so
  // clicking this later always reproduces exactly what THIS email
  // contained - not "whatever this search has accumulated by the time
  // you click." Route: app/api/searches/[id]/digest-export/route.ts -
  // deliberately unauthenticated (same trust model as the unsubscribe
  // link above) and deliberately un-gated by tier: a free-tier
  // recipient's CSV comes back masked exactly like their email rows
  // did (never less masked than the email itself), a paid recipient's
  // comes back unmasked - see that route's own header comment for the
  // full reasoning.
  const csvDownloadUrl = `${process.env.NEXTAUTH_URL}/api/searches/${
    search.id
  }/digest-export?at=${encodeURIComponent(now.toISOString())}`;
  const csvLinkHtml =
    newRows.length > 0
      ? `<p style="font-size:13px;margin-top:12px;"><a href="${csvDownloadUrl}" style="color:#2563eb;">下載本次通知資料（CSV）</a></p>`
      : "";

  // Free-tier upsell (2026-09-05): only shown when this email's rows
  // were actually masked - a paid recipient's email carries no mention
  // of upgrading, since there's nothing to upgrade away from.
  const upgradeNote = isFreeTier
    ? `<p style="color:#6b7280;font-size:12px;margin-top:8px;">此通知內容已部分遮蔽（統一編號、公司名稱與負責人姓名）。<a href="${process.env.NEXTAUTH_URL}/pricing" style="color:#2563eb;">升級付費方案</a>即可收到完整未遮蔽的通知內容。</p>`
    : "";

  const html = `
    <div style="font-family:sans-serif;color:#1a1d23;max-width:600px;">
      <h2 style="margin-bottom:4px;">「${search.name}」有 ${subjectSummary}</h2>
      <p style="color:#6b7280;font-size:13px;margin-top:0;">新公司快報</p>
      ${sectionsHtml}
      ${csvLinkHtml}
      ${
        attributionHtml
          ? `<div style="color:#6b7280;font-size:12px;margin-top:16px;">${attributionHtml}</div>`
          : ""
      }
      ${upgradeNote}
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
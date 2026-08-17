import { Resend } from "resend";
import { db } from "../db";
import { formatCapital, formatDate } from "../utils";
import type { Company } from "../../types/db";

const resend = new Resend(process.env.RESEND_API_KEY!);

const STATUS_LABEL: Record<string, string> = {
  active: "營運中",
  changed: "已異動",
  dissolved: "已解散",
  suspended: "停業中",
};

// Monthly searches only get re-checked by this weekly-run script, so
// "due" has to be derived rather than read off a column - there is no
// last_sent_at on saved_searches. Weekly cadence is trivially due every
// run (the cron itself is weekly). Monthly is due once its last send is
// null or at least 28 days old.
const MONTHLY_DUE_AFTER_DAYS = 28;

export interface DueSearch {
  id: string;
  name: string;
  cadence: string;
  userEmail: string;
}

export interface DigestSendResult {
  searchId: string;
  searchName: string;
  sent: boolean;
  matchCount: number;
  error?: string;
}

export async function getDueSavedSearches(): Promise<DueSearch[]> {
  const sql = db();

  const rows = await sql`
    SELECT
      ss.id,
      ss.name,
      ss.cadence,
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
    user_email: string;
    last_sent_at: string | null;
  }[]) {
    if (r.cadence === "weekly") {
      due.push({ id: r.id, name: r.name, cadence: r.cadence, userEmail: r.user_email });
      continue;
    }
    // monthly
    if (!r.last_sent_at) {
      due.push({ id: r.id, name: r.name, cadence: r.cadence, userEmail: r.user_email });
      continue;
    }
    const daysSinceLastSent =
      (Date.now() - new Date(r.last_sent_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastSent >= MONTHLY_DUE_AFTER_DAYS) {
      due.push({ id: r.id, name: r.name, cadence: r.cadence, userEmail: r.user_email });
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
  freshness: Map<string, string>
): string {
  const statusLabel = STATUS_LABEL[c.status] ?? c.status;
  const freshAt = c.source_dataset ? freshness.get(c.source_dataset) : undefined;
  const freshnessNote =
    (c.status === "dissolved" || c.status === "suspended") && freshAt
      ? `<br/><span style="color:#6b7280;font-size:12px;">資料來源更新於：${formatDate(freshAt)}</span>`
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
          資本額：${formatCapital(c.capital)}　狀態：${statusLabel}${freshnessNote}
        </div>
        <div style="font-size:13px;margin-top:4px;">
          <a href="${mapsUrl(c.name, c.address_raw)}" style="color:#2563eb;">Google 地圖查詢</a>
        </div>
      </td>
    </tr>
  `;
}

/**
 * Sends the digest for one saved_search if it has unsurfaced matches.
 * Returns sent:false (not an error) when there's simply nothing new -
 * per Session 16's objective, empty searches are skipped, not emailed.
 */
export async function sendDigestForSearch(search: DueSearch): Promise<DigestSendResult> {
  const sql = db();

  const matches = await sql`
    SELECT c.*, sm.id AS match_id
    FROM search_matches sm
    JOIN companies c ON c.uniform_id = sm.company_uniform_id
    WHERE sm.saved_search_id = ${search.id} AND sm.surfaced_in_digest = false
    ORDER BY c.registration_date DESC NULLS LAST
  `;

  if (matches.length === 0) {
    return { searchId: search.id, searchName: search.name, sent: false, matchCount: 0 };
  }

  const rows = matches as (Company & { match_id: string })[];

  const flaggedDatasets = Array.from(
    new Set(
      rows
        .filter((r) => r.status === "dissolved" || r.status === "suspended")
        .map((r) => r.source_dataset)
        .filter((d): d is string => !!d)
    )
  );
  const freshness = await getDatasetFreshness(flaggedDatasets);

  const rowsHtml = rows.map((r) => renderCompanyRow(r, freshness)).join("");

  const html = `
    <div style="font-family:sans-serif;color:#1a1d23;max-width:600px;">
      <h2 style="margin-bottom:4px;">「${search.name}」有 ${rows.length} 筆新符合結果</h2>
      <p style="color:#6b7280;font-size:13px;margin-top:0;">新公司快報</p>
      <table style="width:100%;border-collapse:collapse;">
        ${rowsHtml}
      </table>
      <p style="color:#6b7280;font-size:12px;margin-top:24px;">
        登入查看完整結果：<a href="${process.env.NEXTAUTH_URL}/searches/${search.id}" style="color:#2563eb;">taiwanleads.com</a>
      </p>
    </div>
  `;

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM || "onboarding@resend.dev",
    to: search.userEmail,
    subject: `「${search.name}」有 ${rows.length} 筆新符合結果 — 新公司快報`,
    html,
  });

  if (result.error) {
    return {
      searchId: search.id,
      searchName: search.name,
      sent: false,
      matchCount: rows.length,
      error: result.error.message,
    };
  }

  const matchIds = rows.map((r) => r.match_id);
  await sql`
    UPDATE search_matches
    SET surfaced_in_digest = true, surfaced_at = now()
    WHERE id = ANY(${matchIds}::uuid[])
  `;

  return { searchId: search.id, searchName: search.name, sent: true, matchCount: rows.length };
}
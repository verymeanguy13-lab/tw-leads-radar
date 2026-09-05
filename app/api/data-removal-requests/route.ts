import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const UNIFORM_ID_PATTERN = /^\d{8}$/;

// Strips ordinary and full-width whitespace so "王小明" / "王 小明" /
// "王　小明" (full-width space) all compare equal. Deliberately no other
// normalization (no case-folding, no punctuation stripping) - these are
// Chinese names, and being too lenient here would defeat the point of
// the check.
function normalizeName(s: string): string {
  return s.replace(/[\s　]+/g, "");
}

// POST — submit a PDPA data-removal request. Public, no auth required.
// Deliberately NOT auto-applied against companies.suppressed_at here —
// see the schema comment on data_removal_requests: an unreviewed public
// endpoint that immediately suppressed any company on request would be
// trivially abusable (a competitor hiding a rival from lead lists, or
// anyone impersonating a business they don't represent). This just
// records the request as 'pending' for manual review in the admin
// page — see app/(app)/admin/data-removal-requests/page.tsx.
//
// 2026-09-05: 統一編號 and 負責人姓名 are now BOTH required and checked
// against the real companies row *before* a row is even inserted here -
// previously uniform_id was optional and nothing was cross-checked at
// submission time, so anyone could submit a plausible-looking request
// for any company whose (already public) uniform_id they'd found on
// this site. Requiring the exact registered responsible-person name too
// raises the bar, since that name is masked for anonymous/free-tier
// visitors on this site and only shown in full to paying subscribers.
// See db/schema.sql's comment on data_removal_requests for the full
// rationale, including why we deliberately did NOT go further and
// require a government ID photo.
export async function POST(req: NextRequest) {
  let body: {
    uniformId?: string;
    companyName?: string;
    responsiblePerson?: string;
    email?: string;
    reason?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤。" }, { status: 400 });
  }

  const companyName = body.companyName?.trim();
  const email = body.email?.trim();
  const uniformId = body.uniformId?.trim();
  const responsiblePerson = body.responsiblePerson?.trim();
  const reason = body.reason?.trim() || null;

  if (!companyName) {
    return NextResponse.json({ error: "請填寫公司名稱。" }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "請填寫有效的電子郵件地址。" }, { status: 400 });
  }
  if (!uniformId || !UNIFORM_ID_PATTERN.test(uniformId)) {
    return NextResponse.json({ error: "請填寫該公司的8位數統一編號。" }, { status: 400 });
  }
  if (!responsiblePerson) {
    return NextResponse.json(
      { error: "請填寫該公司登記資料上的負責人姓名。" },
      { status: 400 }
    );
  }

  try {
    const sql = db();

    const rows = await sql`
      SELECT responsible_person FROM companies WHERE uniform_id = ${uniformId}
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "找不到與此統一編號相符的公司，請確認統一編號是否正確。" },
        { status: 400 }
      );
    }

    const registeredName = (rows[0] as { responsible_person: string | null }).responsible_person;

    if (!registeredName) {
      // Data gap: this company's responsible_person wasn't captured by
      // our ingestion. Don't block a possibly-legitimate requester over
      // a hole in our own data - route them to manual verification
      // instead, same as any other unresolvable case on this form.
      return NextResponse.json(
        {
          error:
            "系統無法自動核對此公司的負責人姓名，請直接寄信至 shihjungching@gmail.com 並附上統一編號，我們會協助人工審核。",
        },
        { status: 400 }
      );
    }

    if (normalizeName(registeredName) !== normalizeName(responsiblePerson)) {
      // Deliberately vague - do not reveal the registered name, or this
      // check becomes a name-guessing oracle for anyone probing it.
      return NextResponse.json(
        { error: "統一編號與負責人姓名不符，請確認後再試。" },
        { status: 400 }
      );
    }

    await sql`
      INSERT INTO data_removal_requests
        (uniform_id, company_name_submitted, responsible_person_submitted, requester_email, reason)
      VALUES (${uniformId}, ${companyName}, ${responsiblePerson}, ${email}, ${reason})
    `;
    return NextResponse.json({ submitted: true }, { status: 200 });
  } catch (err) {
    // Covers a Neon outage/connectivity failure specifically — return
    // a clear, honest JSON error rather than letting Next.js's default
    // unhandled-error page (non-JSON HTML) reach the client. The
    // person submitting this form is trying to exercise a real right;
    // a silent or confusing failure here matters more than in most
    // other forms on this site.
    console.error("data-removal-requests insert failed:", err);
    return NextResponse.json(
      { error: "系統暫時無法處理您的請求，請稍後再試，或直接寄信至 shihjungching@gmail.com。" },
      { status: 503 }
    );
  }
}

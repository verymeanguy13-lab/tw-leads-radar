import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const UNIFORM_ID_PATTERN = /^\d{8}$/;

// POST — submit a PDPA data-removal request. Public, no auth required.
// Deliberately NOT auto-applied against companies.suppressed_at here —
// see the schema comment on data_removal_requests: an unreviewed public
// endpoint that immediately suppressed any company on request would be
// trivially abusable (a competitor hiding a rival from lead lists, or
// anyone impersonating a business they don't represent). This just
// records the request as 'pending' for manual review in the admin
// page — see app/(app)/admin/data-removal-requests/page.tsx.
export async function POST(req: NextRequest) {
  let body: {
    uniformId?: string | null;
    companyName?: string;
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
  const uniformId = body.uniformId?.trim() || null;
  const reason = body.reason?.trim() || null;

  if (!companyName) {
    return NextResponse.json({ error: "請填寫公司名稱。" }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "請填寫有效的電子郵件地址。" }, { status: 400 });
  }
  if (uniformId && !UNIFORM_ID_PATTERN.test(uniformId)) {
    return NextResponse.json({ error: "統一編號應為8位數字，或留空。" }, { status: 400 });
  }

  try {
    const sql = db();
    await sql`
      INSERT INTO data_removal_requests (uniform_id, company_name_submitted, requester_email, reason)
      VALUES (${uniformId}, ${companyName}, ${email}, ${reason})
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

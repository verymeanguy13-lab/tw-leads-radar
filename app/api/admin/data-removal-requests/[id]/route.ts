import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

const UNIFORM_ID_PATTERN = /^\d{8}$/;

// POST — admin-only approve/reject action on a single data-removal
// request. Approving requires a confirmed 8-digit uniform_id (either
// the one originally submitted, or one the admin looked up and
// entered manually if the requester only knew the company name) -
// see app/(app)/admin/data-removal-requests/page.tsx for why this
// isn't automatic: matching purely by company name risks suppressing
// the wrong company if names collide.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getServerSession(authOptions);
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!session?.user?.email || session.user.email !== adminEmail) {
    return NextResponse.json({ error: "未授權。" }, { status: 401 });
  }

  let body: { action?: "approve" | "reject"; confirmedUniformId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤。" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "action 必須是 approve 或 reject。" }, { status: 400 });
  }

  const sql = db();

  try {
    if (body.action === "reject") {
      const result = await sql`
        UPDATE data_removal_requests
        SET status = 'rejected', reviewed_at = now()
        WHERE id = ${id} AND status = 'pending'
        RETURNING id
      `;
      if (result.length === 0) {
        return NextResponse.json({ error: "找不到待審核的請求。" }, { status: 404 });
      }
      return NextResponse.json({ status: "rejected" }, { status: 200 });
    }

    // approve
    const uniformId = body.confirmedUniformId?.trim();
    if (!uniformId || !UNIFORM_ID_PATTERN.test(uniformId)) {
      return NextResponse.json(
        { error: "核准前須確認正確的8位數統一編號。" },
        { status: 400 }
      );
    }

    const companyExists = await sql`SELECT 1 FROM companies WHERE uniform_id = ${uniformId}`;
    if (companyExists.length === 0) {
      return NextResponse.json(
        { error: `找不到統一編號 ${uniformId} 對應的公司，請確認輸入正確。` },
        { status: 400 }
      );
    }

    await sql`UPDATE companies SET suppressed_at = now() WHERE uniform_id = ${uniformId}`;

    const result = await sql`
      UPDATE data_removal_requests
      SET status = 'approved', reviewed_at = now(), uniform_id = ${uniformId}
      WHERE id = ${id} AND status = 'pending'
      RETURNING id
    `;
    if (result.length === 0) {
      return NextResponse.json({ error: "找不到待審核的請求（但公司已被標記為隱藏）。" }, { status: 404 });
    }

    return NextResponse.json({ status: "approved" }, { status: 200 });
  } catch (err) {
    console.error("data-removal-requests review action failed:", err);
    return NextResponse.json({ error: "系統暫時無法處理，請稍後再試。" }, { status: 503 });
  }
}

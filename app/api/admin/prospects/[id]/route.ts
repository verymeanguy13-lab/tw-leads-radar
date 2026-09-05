import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// POST — admin-only toggle of a single prospect_contacts row's
// do_not_contact flag. Mirrors app/api/admin/data-removal-requests/[id]/
// route.ts's admin-gating pattern. This is a suppression flag, not a
// delete - see db/schema.sql's comment on prospect_contacts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getServerSession(authOptions);
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!session?.user?.email || session.user.email !== adminEmail) {
    return NextResponse.json({ error: "未授權。" }, { status: 401 });
  }

  let body: { do_not_contact?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤。" }, { status: 400 });
  }

  if (typeof body.do_not_contact !== "boolean") {
    return NextResponse.json({ error: "do_not_contact 必須是布林值。" }, { status: 400 });
  }

  const sql = db();

  try {
    const result = await sql`
      UPDATE prospect_contacts
      SET do_not_contact = ${body.do_not_contact}
      WHERE id = ${id}
      RETURNING id
    `;
    if (result.length === 0) {
      return NextResponse.json({ error: "找不到此聯絡人。" }, { status: 404 });
    }
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (err) {
    console.error("prospect do_not_contact toggle failed:", err);
    return NextResponse.json({ error: "系統暫時無法處理，請稍後再試。" }, { status: 503 });
  }
}

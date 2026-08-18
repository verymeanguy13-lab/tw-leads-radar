import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email/verification";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "請輸入有效的電子郵件地址。" }, { status: 400 });
  }

  const sql = db();
  const rows = await sql`
    SELECT id FROM users WHERE email = ${email} AND email_verified_at IS NULL
  `;

  // Always return the same success response whether or not the email
  // exists / is already verified - never reveal account existence to
  // an anonymous caller.
  if (rows[0]) {
    await sendVerificationEmail(rows[0].id, email);
  }

  return NextResponse.json({ success: true });
}
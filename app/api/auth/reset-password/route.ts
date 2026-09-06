import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/email/verification";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!token) {
    return NextResponse.json({ error: "重設連結無效或已過期，請重新申請。" }, { status: 400 });
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元。` },
      { status: 400 }
    );
  }

  const tokenHash = hashToken(token);
  const sql = db();

  const rows = await sql`
    SELECT id FROM users
    WHERE password_reset_token_hash = ${tokenHash}
      AND password_reset_token_expires_at > now()
  `;
  const user = rows[0] as { id: string } | undefined;

  if (!user) {
    return NextResponse.json(
      { error: "重設連結無效或已過期，請重新申請。" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Clears the reset token in the same statement that sets the new
  // password - a token is single-use, matching the verify-email flow's
  // own pattern (app/api/auth/verify/route.ts) of clearing its token
  // columns the moment it's consumed.
  await sql`
    UPDATE users
    SET password_hash = ${passwordHash},
        password_reset_token_hash = NULL,
        password_reset_token_expires_at = NULL
    WHERE id = ${user.id}
  `;

  return NextResponse.json({ success: true });
}

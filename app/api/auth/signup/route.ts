import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email/verification";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "請求格式錯誤。" }, { status: 400 });
  }

  const businessName = typeof body.businessName === "string" ? body.businessName.trim() : "";
  const businessType = typeof body.businessType === "string" ? body.businessType.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!businessName || businessName.length > 100) {
    return NextResponse.json({ error: "請輸入商業名稱（100 字以內）。" }, { status: 400 });
  }
  if (!businessType) {
    return NextResponse.json({ error: "請選擇商業類型。" }, { status: 400 });
  }
  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "請輸入有效的電子郵件地址。" }, { status: 400 });
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元。` },
      { status: 400 }
    );
  }

  const sql = db();

  const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (existing.length > 0) {
    return NextResponse.json({ error: "此電子郵件已被使用，請直接登入。" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let userId: string;
  try {
    const inserted = await sql`
      INSERT INTO users (email, name, password_hash, business_name, business_type)
      VALUES (${email}, ${businessName}, ${passwordHash}, ${businessName}, ${businessType})
      RETURNING id
    `;
    userId = inserted[0].id;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return NextResponse.json({ error: "此電子郵件已被使用，請直接登入。" }, { status: 409 });
    }
    return NextResponse.json({ error: "建立帳號時發生錯誤，請稍後再試。" }, { status: 500 });
  }

  const emailResult = await sendVerificationEmail(userId, email);
  if (emailResult.error) {
    // Account exists but the verification email failed to send - don't
    // fail the signup itself, the person can use "resend" afterward.
    return NextResponse.json(
      { success: true, emailWarning: true },
      { status: 201 }
    );
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
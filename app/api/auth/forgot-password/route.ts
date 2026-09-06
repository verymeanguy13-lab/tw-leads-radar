import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email/password-reset";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "請輸入有效的電子郵件地址。" }, { status: 400 });
  }

  const sql = db();
  // Only accounts with a password_hash can meaningfully "reset" a
  // password - a Google-only account has none. Same
  // always-return-the-same-response pattern as
  // app/api/auth/resend-verification/route.ts, and for the same reason:
  // never reveal to an anonymous caller whether an email has an account,
  // or what kind. A Google-only account silently gets no email at all
  // (there'd be nothing correct to tell them without leaking that
  // distinction) - if this becomes a real point of confusion in support
  // requests, a follow-up could send those accounts a "this account
  // signs in with Google" notice instead, but that's a deliberate,
  // separate addition, not part of this round.
  const rows = await sql`
    SELECT id FROM users WHERE email = ${email} AND password_hash IS NOT NULL
  `;

  if (rows[0]) {
    await sendPasswordResetEmail(rows[0].id, email);
  }

  return NextResponse.json({ success: true });
}

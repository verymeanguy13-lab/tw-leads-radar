import crypto from "crypto";
import { Resend } from "resend";
import { db } from "../db";

const resend = new Resend(process.env.RESEND_API_KEY!);
const TOKEN_EXPIRY_HOURS = 24;

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Generates a new verification token for a user, stores its hash (never
 * the raw token) with an expiry, and emails the raw token as a link via
 * Resend. Used both at signup and for "resend verification email".
 *
 * Returns { error } if Resend reports a failure - per the established
 * lesson elsewhere in this codebase, Resend does not throw on failure,
 * result.error must be checked explicitly.
 */
export async function sendVerificationEmail(
  userId: string,
  email: string
): Promise<{ error?: string }> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  const sql = db();
  await sql`
    UPDATE users
    SET verification_token_hash = ${tokenHash}, verification_token_expires_at = ${expiresAt.toISOString()}
    WHERE id = ${userId}
  `;

  const verifyUrl = `${process.env.NEXTAUTH_URL}/api/auth/verify?token=${rawToken}`;

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM || "onboarding@resend.dev",
    to: email,
    subject: "請驗證您的電子郵件 — 新公司快報",
    html: `
      <div style="font-family:sans-serif;color:#1a1d23;max-width:480px;">
        <h2>請驗證您的電子郵件</h2>
        <p>請點選以下連結以完成帳號驗證（連結 ${TOKEN_EXPIRY_HOURS} 小時內有效）：</p>
        <p><a href="${verifyUrl}" style="color:#2563eb;">驗證電子郵件</a></p>
        <p style="color:#6b7280;font-size:13px;">若您沒有註冊過新公司快報，請忽略此郵件。</p>
      </div>
    `,
  });

  if (result.error) {
    return { error: result.error.message };
  }
  return {};
}
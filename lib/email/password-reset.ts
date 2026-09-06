import crypto from "crypto";
import { Resend } from "resend";
import { db } from "../db";
import { hashToken } from "./verification";

const resend = new Resend(process.env.RESEND_API_KEY!);

// Shorter than verification's 24 hours (see lib/email/verification.ts) -
// this token grants account access if intercepted, not just "mark this
// email verified", so it's worth the extra friction of a shorter window.
const TOKEN_EXPIRY_HOURS = 1;

/**
 * Generates a new password-reset token for a user, stores its hash
 * (never the raw token) with an expiry, and emails the raw token as a
 * link via Resend. Mirrors lib/email/verification.ts's
 * sendVerificationEmail() - same hash-not-raw-token pattern, same
 * "Resend does not throw on failure, check result.error explicitly"
 * lesson - pointed at a different pair of columns
 * (users.password_reset_token_hash/_expires_at) so this can be in
 * progress at the same time as an unrelated email-verification flow on
 * the same account without either one clobbering the other.
 *
 * Caller's responsibility to decide WHETHER to call this (e.g. skipping
 * Google-only accounts with no password_hash) - see
 * app/api/auth/forgot-password/route.ts, which always returns the same
 * response to the caller regardless, to avoid leaking account existence.
 */
export async function sendPasswordResetEmail(
  userId: string,
  email: string
): Promise<{ error?: string }> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  const sql = db();
  await sql`
    UPDATE users
    SET password_reset_token_hash = ${tokenHash}, password_reset_token_expires_at = ${expiresAt.toISOString()}
    WHERE id = ${userId}
  `;

  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${rawToken}`;

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM || "onboarding@resend.dev",
    to: email,
    subject: "重設您的密碼 — 新公司快報",
    html: `
      <div style="font-family:sans-serif;color:#1a1d23;max-width:480px;">
        <h2>重設您的密碼</h2>
        <p>我們收到重設此帳號密碼的請求。請點選以下連結設定新密碼（連結 ${TOKEN_EXPIRY_HOURS} 小時內有效）：</p>
        <p><a href="${resetUrl}" style="color:#2563eb;">重設密碼</a></p>
        <p style="color:#6b7280;font-size:13px;">若您沒有要求重設密碼，請忽略此郵件，您的密碼不會被變更。</p>
      </div>
    `,
  });

  if (result.error) {
    return { error: result.error.message };
  }
  return {};
}

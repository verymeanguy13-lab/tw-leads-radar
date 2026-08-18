import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/email/verification";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const baseUrl = process.env.NEXTAUTH_URL || req.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/login?error=InvalidVerificationLink`);
  }

  const tokenHash = hashToken(token);
  const sql = db();

  const rows = await sql`
    SELECT id FROM users
    WHERE verification_token_hash = ${tokenHash}
      AND verification_token_expires_at > now()
  `;
  const user = rows[0];

  if (!user) {
    return NextResponse.redirect(`${baseUrl}/login?error=InvalidVerificationLink`);
  }

  await sql`
    UPDATE users
    SET email_verified_at = now(),
        verification_token_hash = NULL,
        verification_token_expires_at = NULL
    WHERE id = ${user.id}
  `;

  return NextResponse.redirect(`${baseUrl}/login?verified=1`);
}
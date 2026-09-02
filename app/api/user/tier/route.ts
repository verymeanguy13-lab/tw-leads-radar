import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUserTier } from "@/lib/tiers";

// GET — the signed-in user's own tier. Added 2026-08-30 so
// /searches/new can show the 'daily' cadence option only as available
// to business tier, disabled with an explanatory note otherwise,
// rather than only finding out it's rejected after submitting. Every
// gating decision still happens server-side in POST /api/searches
// regardless of what this returns - this is purely for the form's UX,
// not a security boundary.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "找不到使用者。" }, { status: 401 });
  }

  const tier = await getUserTier(userId);
  return NextResponse.json({ tier }, { status: 200 });
}

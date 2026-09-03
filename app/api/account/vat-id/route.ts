import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

// 2026-09-03: lets a user store their 統一編號 (Taiwan Uniform Business
// Number) on their account. Deliberately scoped to capture-and-store
// only, per user decision — NOT wired into Paddle checkout as a business
// customer field. Paddle's built-in tax-ID handling is built around
// EU/UK-style reverse-charge VAT, a different legal mechanism from
// Taiwan's own 統一發票 invoicing system, and that distinction needs a
// real answer (see architecture.md's 2026-09-03 entry) before building
// checkout logic on top of it. This just makes sure the number is
// captured and available on the account for whenever that's resolved.
//
// Format check only: exactly 8 digits, matching how a 統一編號 is always
// formatted. Does NOT implement the official checksum/validity algorithm
// (a specific weighted-digit formula Taiwan uses to validate a real
// registered number) — out of scope for a capture-and-store field. A
// well-formed but not-actually-registered number can still be saved.
const VAT_ID_PATTERN = /^\d{8}$/;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const rawVatId = typeof body?.vatId === "string" ? body.vatId.trim() : "";

  // Empty string is allowed — it clears a previously-saved value.
  if (rawVatId && !VAT_ID_PATTERN.test(rawVatId)) {
    return NextResponse.json(
      { error: "統一編號格式錯誤，請輸入 8 位數字（或留空以清除）。" },
      { status: 400 }
    );
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await sql`UPDATE users SET vat_id = ${rawVatId || null} WHERE id = ${userId}`;

  return NextResponse.json({ success: true, vatId: rawVatId || null });
}

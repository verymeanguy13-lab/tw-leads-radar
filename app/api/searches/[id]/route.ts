import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";

// PATCH — pause or resume a saved search.
//
// 2026-09-04: the `paused` column on saved_searches has existed since
// Session 15 (matchAllSearches() and the digest emailer both already
// skip paused searches, and the search list page already shows a
// "已暫停" badge when paused is true) but nothing anywhere - no button,
// no API route - ever actually SET it. The column could only be
// flipped by hand-editing the database, in either direction, so there
// was no way for a real user to pause a search, let alone undo it.
// This adds the missing write path for both directions at once, same
// ownership pattern as DELETE below (withUserContext / RLS).
//
// Body is `{ paused: boolean }` (an explicit set, not a toggle) so the
// client always knows the resulting state from its own request instead
// of having to trust a round trip.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.paused !== "boolean") {
    return NextResponse.json(
      { error: "缺少或格式錯誤的 paused 欄位。" },
      { status: 400 }
    );
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id;
  if (!userId) {
    return NextResponse.json({ error: "找不到使用者。" }, { status: 401 });
  }

  const updated = await withUserContext(userId, (sqlClient) =>
    sqlClient`
      UPDATE saved_searches
      SET paused = ${body.paused}, updated_at = now()
      WHERE id = ${id}
      RETURNING id, paused
    `
  );

  if (updated.length === 0) {
    return NextResponse.json({ error: "找不到此搜尋條件。" }, { status: 404 });
  }

  return NextResponse.json({ paused: updated[0].paused }, { status: 200 });
}

// DELETE — remove a saved search.
//
// This did not exist before: there was no way, in the UI or the API,
// to ever delete a saved search. That's a problem on its own, but it's
// especially bad combined with free tier's 1-saved-search limit — a
// free user's first saved search was permanent, with no way to change
// their mind about its filters short of a developer manually deleting
// the row from the database.
//
// search_matches has ON DELETE CASCADE on its saved_search_id foreign
// key (see db/schema.sql), so deleting the saved_searches row cleans up
// all of its matches automatically - no separate cleanup query needed
// here. RLS's saved_searches_isolation policy (via withUserContext)
// means a user can only ever delete their own row, same ownership
// pattern as run/route.ts and export/route.ts.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id;
  if (!userId) {
    return NextResponse.json({ error: "找不到使用者。" }, { status: 401 });
  }

  const deleted = await withUserContext(userId, (sqlClient) =>
    sqlClient`
      DELETE FROM saved_searches
      WHERE id = ${id}
      RETURNING id
    `
  );

  if (deleted.length === 0) {
    return NextResponse.json({ error: "找不到此搜尋條件。" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true }, { status: 200 });
}

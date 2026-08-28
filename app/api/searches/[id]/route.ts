import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";

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

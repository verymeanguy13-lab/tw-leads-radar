import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";
import { matchSearch } from "@/lib/matching/engine";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "隢??餃?? }, { status: 401 });
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id;
  if (!userId) {
    return NextResponse.json({ error: "?曆??唬蝙?刻? }, { status: 401 });
  }

  // Ownership check: RLS's saved_searches_isolation policy means this
  // SELECT only returns a row if the search belongs to this user.
  const owned = await withUserContext(userId, (sqlClient) =>
    sqlClient`SELECT id FROM saved_searches WHERE id = ${id}`
  );
  if (owned.length === 0) {
    return NextResponse.json({ error: "?曆??唳迨??璇辣?? }, { status: 404 });
  }

  try {
    const newMatches = await matchSearch(id);
    return NextResponse.json({ newMatches }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "?瑁?????隤歹?隢?敺?閰艾? },
      { status: 500 }
    );
  }
}

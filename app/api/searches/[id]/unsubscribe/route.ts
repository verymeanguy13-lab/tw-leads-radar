import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// One-click digest unsubscribe, reached from the "取消此通知" link and the
// List-Unsubscribe header in every digest email (see lib/email/digest.ts).
//
// Deliberately unauthenticated - no session check, no withUserContext. A
// person clicking this from their inbox is very often not logged in (or
// not logged in on that device), and requiring login here would defeat
// the entire point: RFC 8058 one-click unsubscribe (and every mainstream
// mail provider's own "Unsubscribe" button next to the sender name) is
// built on the assumption that the link itself is the credential. That's
// safe here specifically because saved_searches.id is a gen_random_uuid()
// (see db/schema.sql) - 122 bits of randomness, never enumerable, and
// never shown anywhere outside this one search's own owner and this one
// search's own emails. Same trust model matchAllSearches() already uses
// for a different reason (see lib/matching/engine.ts's comment on why it
// uses plain db() instead of withUserContext) - this isn't a new pattern
// for this codebase, just a new reason for it.
//
// Pauses the search (paused = true) rather than deleting it, matching
// "unsubscribe" everywhere else in this app meaning "stop the emails,"
// not "destroy my filters" - the DELETE route already covers the case
// where someone actually wants the search gone. A paused search's
// existing search_matches rows are untouched, so re-enabling it later
// (from the search's own page) doesn't lose anything or cause a burst of
// "new" matches to re-surface.
//
// Handles both GET (the plain link a human clicks from the email footer)
// and POST (what mail clients actually send for RFC 8058's
// List-Unsubscribe-Post one-click flow, invisibly, without opening
// anything) - both do the same underlying update.

async function pauseSearch(id: string): Promise<{ name: string } | null> {
  const sql = db();
  const rows = await sql`
    UPDATE saved_searches
    SET paused = true, updated_at = now()
    WHERE id = ${id}
    RETURNING name
  `;
  return (rows[0] as { name: string } | undefined) ?? null;
}

function confirmationPage(found: boolean, name?: string) {
  const body = found
    ? `
      <h1 style="margin-bottom:8px;">已取消通知</h1>
      <p style="color:#374151;">「${name}」的電子郵件通知已停止。這組搜尋條件本身仍會保留，您可以隨時登入帳號重新開啟通知。</p>
    `
    : `
      <h1 style="margin-bottom:8px;">找不到此搜尋條件</h1>
      <p style="color:#374151;">這組通知可能已經被刪除，或連結有誤。若您仍持續收到不想要的通知，請登入帳號查看您的搜尋條件清單。</p>
    `;
  return `
    <!doctype html>
    <html lang="zh-Hant">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>取消通知 — 新公司快報</title>
      </head>
      <body style="font-family:sans-serif;color:#1a1d23;max-width:480px;margin:60px auto;padding:0 20px;">
        ${body}
        <p style="margin-top:24px;">
          <a href="${process.env.NEXTAUTH_URL}" style="color:#2563eb;">回到 taiwanleads.com</a>
        </p>
      </body>
    </html>
  `;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await pauseSearch(id);
  return new NextResponse(confirmationPage(result !== null, result?.name), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// RFC 8058 one-click unsubscribe: mail providers that support it POST here
// directly (no page ever loads) when a user clicks their own built-in
// "Unsubscribe" button next to the sender name, rather than opening the
// footer link above. Body is form-encoded per the RFC
// (List-Unsubscribe=One-Click) but its contents don't matter here - the
// searchId in the URL is already everything this endpoint needs.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await pauseSearch(id);
  return new NextResponse(null, { status: 200 });
}

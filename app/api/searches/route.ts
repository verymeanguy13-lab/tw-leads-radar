import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, withUserContext } from "@/lib/db";
import { getUserTier, canCreateSavedSearch, isCadenceAllowed } from "@/lib/tiers";
import { matchSearch } from "@/lib/matching/engine";

const VALID_ENTITY_TYPES = ["company", "business", "both"];
const VALID_CADENCE = ["weekly", "monthly", "daily"];

// GET — list the signed-in user's own saved searches.
//
// Added because /searches (the page that lists them) and the app's
// login redirect both assumed this existed, but only POST was ever
// built here. Without it there was no way - UI or API - for a user to
// ever find their way back to a saved search's results page after the
// one-time creation redirect, other than clicking a link in a digest
// email if one happened to have been sent. RLS's saved_searches_isolation
// policy (via withUserContext) means this can only ever return the
// caller's own rows.
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

  const searches = await withUserContext(userId, (sqlClient) =>
    sqlClient`
      SELECT
        ss.id, ss.name, ss.cadence, ss.paused, ss.created_at,
        count(sm.id) AS match_count
      FROM saved_searches ss
      LEFT JOIN search_matches sm ON sm.saved_search_id = ss.id
      WHERE ss.user_id = ${userId}
      GROUP BY ss.id
      ORDER BY ss.created_at DESC
    `
  );

  return NextResponse.json({ searches }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ errors: { _general: "請先登入。" } }, { status: 401 });
  }

  const sql = db();
  const userRows = await sql`SELECT id FROM users WHERE email = ${session.user.email}`;
  const userId = userRows[0]?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ errors: { _general: "找不到使用者。" } }, { status: 401 });
  }

  const body = await req.json();
  const errors: Record<string, string> = {};

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    errors.name = "請輸入搜尋條件名稱。";
  } else if (name.length > 100) {
    errors.name = "名稱過長，請輸入 100 字以內。";
  }

  const industryCodes = Array.isArray(body.industry_codes) ? body.industry_codes : [];
  const regions = Array.isArray(body.regions) ? body.regions : [];

  const capitalMin = body.capital_min !== null && body.capital_min !== undefined
    ? Number(body.capital_min) : null;
  const capitalMax = body.capital_max !== null && body.capital_max !== undefined
    ? Number(body.capital_max) : null;

  if (capitalMin !== null && (isNaN(capitalMin) || capitalMin < 0)) {
    errors.capital = "最低資本額必須為正數。";
  }
  if (capitalMax !== null && (isNaN(capitalMax) || capitalMax < 0)) {
    errors.capital = "最高資本額必須為正數。";
  }
  if (capitalMin !== null && capitalMax !== null && capitalMin > capitalMax) {
    errors.capital = "最低資本額不可高於最高資本額。";
  }

  const entityType = typeof body.entity_type === "string" ? body.entity_type : "";
  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    errors.entity_type = "請選擇有效的公司／商業類型。";
  }

  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";

  const cadence = typeof body.cadence === "string" ? body.cadence : "";
  if (!VALID_CADENCE.includes(cadence)) {
    errors.cadence = "請選擇有效的通知頻率。";
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  // Tier gating (Session 19) - both checks are server-side and cannot be
  // bypassed by skipping the UI, since they run here regardless of what
  // called this route.
  const tier = await getUserTier(userId);

  if (!isCadenceAllowed(tier, cadence)) {
    // Message needs to actually reflect which tier is being blocked and
    // why - the old hardcoded "免費方案僅支援每週通知" text was written
    // back when only weekly/monthly existed and free was the only tier
    // ever likely to hit this. Now that 'daily' exists and is
    // business-only, a pro-tier user selecting daily would see that
    // same free-tier-worded message, which is simply wrong for them.
    const message =
      cadence === "daily"
        ? "每日通知僅限每日方案（Plan C）使用，請升級方案。"
        : tier === "free"
          ? "免費方案僅支援每週通知，請升級方案以使用每月或每日通知。"
          : "此方案不支援所選擇的通知頻率，請升級方案。";
    return NextResponse.json({ errors: { cadence: message } }, { status: 403 });
  }

  const limitCheck = await canCreateSavedSearch(userId);
  if (!limitCheck.allowed) {
    return NextResponse.json(
      { errors: { _general: limitCheck.reason } },
      { status: 403 }
    );
  }

  const rows = await sql`
    INSERT INTO saved_searches (
      user_id, name, industry_codes, regions, capital_min, capital_max,
      entity_type, keyword, cadence, paused
    ) VALUES (
      ${userId},
      ${name}, ${industryCodes}, ${regions}, ${capitalMin}, ${capitalMax},
      ${entityType}, ${keyword || null}, ${cadence}, false
    )
    RETURNING id
  `;

  const created = rows[0];
  if (!created) {
    return NextResponse.json(
      { errors: { _general: "儲存失敗，請稍後再試。" } },
      { status: 500 }
    );
  }

  // 2026-09-03: run the first match synchronously right after creation,
  // instead of leaving a brand new search sitting at zero rows in
  // search_matches until the user clicks "立即執行" or the next scheduled
  // matchAllSearches() run. Previously nothing called matchSearch() here
  // at all, so every newly-created search landed on its results page
  // showing "no results" - indistinguishable from a search whose filters
  // genuinely match nothing - which is exactly the confusion that led to
  // this fix (see the results page's 2026-09-03 comment for the other
  // half of that investigation).
  //
  // Deliberately does not fail search creation if this throws - the
  // search itself is already safely committed to the database at this
  // point, and a matching failure here just means it falls back to the
  // next scheduled run, same as it always has. Logged so a real,
  // recurring failure here doesn't go unnoticed.
  try {
    await matchSearch(created.id);
  } catch (err) {
    console.error(`Initial matchSearch() failed for new saved_search ${created.id}:`, err);
  }

  return NextResponse.json({ id: created.id }, { status: 201 });
}
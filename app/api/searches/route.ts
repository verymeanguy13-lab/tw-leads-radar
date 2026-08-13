import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

const VALID_ENTITY_TYPES = ["company", "business", "both"];
const VALID_CADENCE = ["weekly", "monthly"];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ errors: { _general: "請先登入。" } }, { status: 401 });
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

  const sql = db();
  const rows = await sql`
    INSERT INTO saved_searches (
      user_id, name, industry_codes, regions, capital_min, capital_max,
      entity_type, keyword, cadence, paused
    ) VALUES (
      (SELECT id FROM users WHERE email = ${session.user.email}),
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

  return NextResponse.json({ id: created.id }, { status: 201 });
}
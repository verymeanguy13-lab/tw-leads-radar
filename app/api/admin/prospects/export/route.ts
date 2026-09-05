import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET — admin-only CSV export of prospect_contacts, honoring the same
// region/contact_type/do_not_contact filters as /admin/prospects
// itself (Session 25 objective). Mirrors app/api/searches/[id]/export/
// route.ts's CSV-building pattern (BOM, csvEscape, Content-Disposition).

function csvEscape(value: string | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

interface ProspectContactExportRow {
  contact_type: string;
  name: string;
  firm_name: string;
  region: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  source_url: string;
  source_association: string | null;
  seed_source: string | null;
  contact_method: string | null;
  do_not_contact: boolean;
  outreach_status: string;
  notes: string | null;
  scraped_at: string;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!session?.user?.email || session.user.email !== adminEmail) {
    return NextResponse.json({ error: "未授權。" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const regionFilter = searchParams.get("region");
  const contactTypeFilter = searchParams.get("contact_type");
  const doNotContactParam = searchParams.get("do_not_contact");
  const doNotContactFilter =
    doNotContactParam === "true" ? true : doNotContactParam === "false" ? false : null;

  const sql = db();

  const rows = await sql`
    SELECT contact_type, name, firm_name, region, phone, email, website,
           source_url, source_association, seed_source, contact_method,
           do_not_contact, outreach_status, notes, scraped_at
    FROM prospect_contacts
    WHERE (${regionFilter}::text IS NULL OR region = ${regionFilter})
      AND (${contactTypeFilter}::text IS NULL OR contact_type = ${contactTypeFilter})
      AND (${doNotContactFilter}::boolean IS NULL OR do_not_contact = ${doNotContactFilter})
    ORDER BY region, contact_type, name
  `;

  const headerRow = [
    "類型",
    "名稱",
    "事務所／公會",
    "縣市",
    "電話",
    "Email",
    "網站",
    "來源網址",
    "來源公會",
    "來源清單",
    "聯絡方式",
    "已排除",
    "開發狀態",
    "備註",
    "擷取時間",
  ].join(",");

  const lines: string[] = [headerRow];

  for (const row of rows as unknown as ProspectContactExportRow[]) {
    lines.push(
      [
        csvEscape(row.contact_type),
        csvEscape(row.name),
        csvEscape(row.firm_name),
        csvEscape(row.region),
        csvEscape(row.phone),
        csvEscape(row.email),
        csvEscape(row.website),
        csvEscape(row.source_url),
        csvEscape(row.source_association),
        csvEscape(row.seed_source),
        csvEscape(row.contact_method),
        csvEscape(row.do_not_contact ? "是" : "否"),
        csvEscape(row.outreach_status),
        csvEscape(row.notes),
        csvEscape(row.scraped_at ? new Date(row.scraped_at).toISOString().slice(0, 10) : ""),
      ].join(",")
    );
  }

  // Leading BOM so Excel renders the Chinese text correctly on open.
  const csvBody = "\uFEFF" + lines.join("\r\n") + "\r\n";

  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prospects-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}

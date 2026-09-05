import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import ProspectDoNotContactToggle from "@/components/ProspectDoNotContactToggle";

export const dynamic = "force-dynamic";

const CONTACT_TYPE_LABEL: Record<string, string> = {
  bookkeeper: "記帳士（個人會員）",
  bookkeeper_association: "記帳士公會",
  cpa_firm: "會計師事務所",
};

interface ProspectContactDisplayRow {
  id: string;
  contact_type: string;
  name: string;
  firm_name: string;
  region: string;
  phone: string | null;
  email: string | null;
  source_url: string;
  contact_method: string | null;
  do_not_contact: boolean;
  outreach_status: string;
}

// Session 25/26 - admin-only prospect list built by scripts/scrape-
// bookkeepers.ts and scripts/scrape-cpa-firms.ts. Gated the same way as
// /admin/ingestion and /admin/data-removal-requests - session email
// checked against ADMIN_EMAIL, not customer-facing RLS (this table
// isn't customer-owned - see db/schema.sql's comment on
// prospect_contacts).
export default async function ProspectsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string; contact_type?: string; do_not_contact?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session?.user?.email || session.user.email !== adminEmail) {
    redirect("/login");
  }

  const sp = await searchParams;
  const regionFilter = sp.region?.trim() || null;
  const contactTypeFilter = sp.contact_type?.trim() || null;
  const doNotContactFilter = sp.do_not_contact === "true" ? true : sp.do_not_contact === "false" ? false : null;

  const sql = db();

  const regionRows = await sql`
    SELECT DISTINCT region FROM prospect_contacts ORDER BY region
  `;
  const regions = (regionRows as { region: string }[]).map((r) => r.region);

  const contacts = await sql`
    SELECT id, contact_type, name, firm_name, region, phone, email, website,
           source_url, source_association, seed_source, contact_method,
           do_not_contact, outreach_status, notes, scraped_at
    FROM prospect_contacts
    WHERE (${regionFilter}::text IS NULL OR region = ${regionFilter})
      AND (${contactTypeFilter}::text IS NULL OR contact_type = ${contactTypeFilter})
      AND (${doNotContactFilter}::boolean IS NULL OR do_not_contact = ${doNotContactFilter})
    ORDER BY region, contact_type, name
  `;

  const exportQuery = new URLSearchParams();
  if (regionFilter) exportQuery.set("region", regionFilter);
  if (contactTypeFilter) exportQuery.set("contact_type", contactTypeFilter);
  if (doNotContactFilter !== null) exportQuery.set("do_not_contact", String(doNotContactFilter));

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold mb-2">名單開發聯絡人（內部用）</h1>
      <p className="text-sm text-secondary mb-6">
        {"共 " + contacts.length + " 筆。此頁面僅供內部人工開發使用，非自動寄送工具。"}
      </p>

      <form method="get" className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-xs text-secondary mb-1">縣市</label>
          <select
            name="region"
            defaultValue={regionFilter ?? ""}
            className="border rounded px-2 py-1 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">全部</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-secondary mb-1">類型</label>
          <select
            name="contact_type"
            defaultValue={contactTypeFilter ?? ""}
            className="border rounded px-2 py-1 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">全部</option>
            {Object.entries(CONTACT_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-secondary mb-1">排除狀態</label>
          <select
            name="do_not_contact"
            defaultValue={sp.do_not_contact ?? ""}
            className="border rounded px-2 py-1 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">全部</option>
            <option value="false">可聯絡</option>
            <option value="true">已排除</option>
          </select>
        </div>

        <button type="submit" className="px-4 py-2 rounded text-sm border" style={{ borderColor: "var(--border)" }}>
          套用篩選
        </button>

        <a
          href={`/api/admin/prospects/export?${exportQuery.toString()}`}
          className="px-4 py-2 rounded text-sm text-white"
          style={{ backgroundColor: "var(--accent)" }}
        >
          匯出 CSV
        </a>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2 pr-4">類型</th>
              <th className="py-2 pr-4">名稱</th>
              <th className="py-2 pr-4">事務所／公會</th>
              <th className="py-2 pr-4">縣市</th>
              <th className="py-2 pr-4">電話</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">來源</th>
              <th className="py-2 pr-4">狀態</th>
              <th className="py-2 pr-4">操作</th>
            </tr>
          </thead>
          <tbody>
            {(contacts as ProspectContactDisplayRow[]).map((c) => (
              <tr key={c.id} className="border-b align-top" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 pr-4">{CONTACT_TYPE_LABEL[c.contact_type] ?? c.contact_type}</td>
                <td className="py-2 pr-4">{c.name}</td>
                <td className="py-2 pr-4 text-secondary">{c.firm_name}</td>
                <td className="py-2 pr-4">{c.region}</td>
                <td className="py-2 pr-4">{c.phone ?? "—"}</td>
                <td className="py-2 pr-4">{c.email ?? "—"}</td>
                <td className="py-2 pr-4">
                  <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="underline text-xs">
                    來源連結
                  </a>
                  {c.contact_method === "form_only" && (
                    <span className="block text-xs text-secondary">僅表單</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-xs text-secondary">
                  {c.do_not_contact ? "已排除" : c.outreach_status}
                </td>
                <td className="py-2 pr-4">
                  <ProspectDoNotContactToggle contactId={c.id} doNotContact={c.do_not_contact} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {contacts.length === 0 && <p className="text-sm text-secondary mt-4">目前沒有符合篩選條件的聯絡人。</p>}
      </div>
    </div>
  );
}

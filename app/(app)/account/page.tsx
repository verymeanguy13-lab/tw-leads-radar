import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import AccountPageClient from "./AccountPageClient";

// Session 21 — Account & Billing Settings.
// Server component, matching this app's established pattern (same as
// app/(marketing)/pricing/page.tsx) — session is fetched server-side
// via getServerSession(), not client-side useSession(). This app has
// no <SessionProvider> wrapping it anywhere, so useSession() would
// crash; the interactive parts live in AccountPageClient.tsx instead,
// which receives userId/userEmail as plain props.

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email ?? null;
  let userId: string | null = null;

  if (userEmail) {
    const sql = db();
    const rows = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
    userId = rows[0]?.id ?? null;
  }

  return <AccountPageClient userId={userId} userEmail={userEmail} />;
}

import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import CheckoutButton from "@/components/CheckoutButton";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "定價",
};

export default async function PricingPage() {
  const session = await getServerSession(authOptions);
  let userId: string | null = null;
  const userEmail = session?.user?.email ?? null;

  if (userEmail) {
    const sql = db();
    const rows = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
    userId = rows[0]?.id ?? null;
  }

  return (
    <div className="px-8 py-16 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-10 text-center">{"\u5b9a\u50f9"}</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="border border-default rounded-lg p-6">
          <h2 className="font-semibold text-lg mb-1">
            {"\u65b9\u6848A\uff5c\u514d\u8cbb\u700f\u89bd\uff08\u5ee3\u544a\u652f\u63f4\uff09"}
          </h2>
          <p className="text-2xl font-bold mb-4">NT$0</p>
          <ul className="text-sm space-y-2 mb-6">
            <li>{"\u2713 \u5373\u6642\u641c\u5c0b\u6700\u65b0\u516c\u53f8\u8cc7\u6599"}</li>
            <li>{"\u2713 \u7d71\u4e00\u7de8\u865f\u3001\u516c\u53f8\u540d\u7a31\u8207\u8ca0\u8cac\u4eba\u59d3\u540d\u90e8\u5206\u906e\u853d"}</li>
            <li className="text-secondary">{"\u2022 \u7db2\u7ad9\u5167\u5efa\u5ee3\u544a"}</li>
            <li>{"\u2713 1 \u7d44\u5132\u5b58\u641c\u5c0b\u689d\u4ef6\uff08\u6bcf\u6708\u6458\u8981\uff09"}</li>
            <li className="text-secondary">{"\u2717 \u4e0d\u652f\u63f4CSV\u532f\u51fa"}</li>
          </ul>
          <Link href="/login" className="block text-center border border-default rounded px-4 py-2">
            {"\u958b\u59cb\u4f7f\u7528"}
          </Link>
        </div>

        <div className="border border-default rounded-lg p-6 bg-card">
          <h2 className="font-semibold text-lg mb-1">{"\u65b9\u6848B\uff5c\u9031\u5831\u65b9\u6848"}</h2>
          <p className="text-2xl font-bold mb-1">NT$600 {"/ \u6708"}</p>
          <p className="text-sm text-secondary mb-4">
            {"\u6216\u5e74\u7e73 NT$6,000\uff0c\u76f8\u7576\u65bc\u514d2\u500b\u6708\u8cbb\u7528\uff08\u7d0417%\uff09"}
          </p>
          <ul className="text-sm space-y-2 mb-6">
            <li>{"\u2713 \u5b8c\u6574\u672a\u906e\u853d\u8cc7\u6599\uff08\u7d71\u4e00\u7de8\u865f\u3001\u516c\u53f8\u540d\u7a31\u3001\u8ca0\u8cac\u4eba\u59d3\u540d\uff09"}</li>
            <li>{"\u2713 \u7121\u5ee3\u544a"}</li>
            <li>{"\u2713 \u591a\u7d44\u5132\u5b58\u641c\u5c0b\u689d\u4ef6"}</li>
            <li>{"\u2713 \u6bcf\u9031\u96fb\u5b50\u90f5\u4ef6\u6458\u8981"}</li>
            <li>{"\u2713 CSV\u532f\u51fa"}</li>
          </ul>
          <CheckoutButton
            monthlyPriceId={process.env.NEXT_PUBLIC_PADDLE_PRICE_B_MONTHLY || ""}
            yearlyPriceId={process.env.NEXT_PUBLIC_PADDLE_PRICE_B_YEARLY || ""}
            label={"\u958b\u59cb\u4f7f\u7528"}
            className="block w-full text-center bg-[var(--accent)] text-white rounded px-4 py-2 font-medium disabled:opacity-50"
            userId={userId}
            userEmail={userEmail}
          />
        </div>

        <div className="border border-default rounded-lg p-6 bg-card">
          <h2 className="font-semibold text-lg mb-1">{"\u65b9\u6848C\uff5c\u6bcf\u65e5\u65b9\u6848\uff08\u9032\u968e\uff09"}</h2>
          <p className="text-2xl font-bold mb-1">NT$1,300 {"/ \u6708"}</p>
          <p className="text-sm text-secondary mb-4">
            {"\u6216\u5e74\u7e73 NT$13,000\uff0c\u76f8\u7576\u65bc\u514d2\u500b\u6708\u8cbb\u7528\uff08\u7d0417%\uff09"}
          </p>
          <ul className="text-sm space-y-2 mb-6">
            <li>{"\u2713 \u5b8c\u6574\u672a\u906e\u853d\u8cc7\u6599\uff08\u7d71\u4e00\u7de8\u865f\u3001\u516c\u53f8\u540d\u7a31\u3001\u8ca0\u8cac\u4eba\u59d3\u540d\uff09"}</li>
            <li>{"\u2713 \u7121\u5ee3\u544a"}</li>
            <li>{"\u2713 \u7121\u9650\u5132\u5b58\u641c\u5c0b\u689d\u4ef6"}</li>
            <li>{"\u2713 \u6bcf\u65e5\u96fb\u5b50\u90f5\u4ef6\u6458\u8981"}</li>
            <li>{"\u2713 CSV\u532f\u51fa"}</li>
            <li>{"\u2713 API\u5b58\u53d6\uff08\u898f\u5283\u4e2d\uff09"}</li>
          </ul>
          <CheckoutButton
            monthlyPriceId={process.env.NEXT_PUBLIC_PADDLE_PRICE_C_MONTHLY || ""}
            yearlyPriceId={process.env.NEXT_PUBLIC_PADDLE_PRICE_C_YEARLY || ""}
            label={"\u958b\u59cb\u4f7f\u7528"}
            className="block w-full text-center bg-[var(--accent)] text-white rounded px-4 py-2 font-medium disabled:opacity-50"
            userId={userId}
            userEmail={userEmail}
          />
        </div>
      </div>

      <p className="text-xs text-secondary text-center mt-10 max-w-xl mx-auto">
        {"\u8aaa\u660e\uff1a\u514d\u8cbb\u65b9\u6848\u4e4b\u641c\u5c0b\u7d50\u679c\u8207\u96fb\u5b50\u90f5\u4ef6\u901a\u77e5\uff0c\u7d71\u4e00\u7de8\u865f\u3001\u516c\u53f8\u540d\u7a31\u8207\u8ca0\u8cac\u4eba\u59d3\u540d\u5c07\u90e8\u5206\u906e\u853d\u4ee5\u4fdd\u8b77\u7576\u4e8b\u4eba\u96b1\u79c1\uff1b\u5730\u5340\u3001\u884c\u696d\u5225\u7b49\u5176\u4ed6\u6b04\u4f4d\u4e0d\u53d7\u5f71\u97ff\u3002\u5347\u7d1a\u4ed8\u8cbb\u65b9\u6848\u5373\u53ef\u770b\u5230\u5b8c\u6574\u672a\u906e\u853d\u8cc7\u6599\u3002"}
      </p>
    </div>
  );
}
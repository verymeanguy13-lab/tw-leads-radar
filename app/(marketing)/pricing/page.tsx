import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import NewebpayCheckoutButton from "@/components/NewebpayCheckoutButton";
import type { Metadata } from "next";

// 2026-09-05: checkout switched from Paddle's CheckoutButton to
// NewebpayCheckoutButton, on the user's explicit instruction to hide
// Paddle from the site's surface and put 藍新 (NewebPay) in its place,
// rather than ripping Paddle out of the codebase (it's still used
// elsewhere - see app/api/account/cancel/route.ts and
// app/api/account/route.ts, both now updated to handle either
// processor). CheckoutButton.tsx/lib/paddle-api.ts are untouched and
// still fully functional - they're just no longer reachable from this
// page.
//
// REAL, IMMEDIATE CONSEQUENCE, stated plainly because it's easy to miss
// from the diff alone: NEWEBPAY_MERCHANT_ID/HASH_KEY/HASH_IV are not set
// (no 藍新 merchant account exists yet - applying for one requires this
// site to already look fully live first, a separate open item). Until
// those exist, every click of the buttons below will fail gracefully
// with "NewebPay 尚未設定完成，目前無法使用此付款方式" (the 503 path
// app/api/checkout/newebpay/route.ts already returns) rather than
// crashing - but that means NO ONE CAN ACTUALLY SUBSCRIBE to Plan B or C
// right now. This is the tradeoff the user explicitly chose over leaving
// Paddle live in the meantime - see architecture.md's 2026-09-05 "hide
// Paddle from the surface" entry.

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
          <p className="text-xs text-secondary text-center mt-2">{"\u4e0d\u9700\u4fe1\u7528\u5361"}</p>
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
          <NewebpayCheckoutButton
            tier="pro"
            label={"\u958b\u59cb\u4f7f\u7528"}
            className="block w-full text-center bg-[var(--accent)] text-white rounded px-4 py-2 font-medium disabled:opacity-50"
            userId={userId}
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
          <NewebpayCheckoutButton
            tier="business"
            label={"\u958b\u59cb\u4f7f\u7528"}
            className="block w-full text-center bg-[var(--accent)] text-white rounded px-4 py-2 font-medium disabled:opacity-50"
            userId={userId}
          />
        </div>
      </div>

      {/* 2026-09-05: trust-signal row, originally added when checkout was
          still Paddle. Both claims still hold true now that checkout is
          NewebpayCheckoutButton above:
          - "\u514d\u8cbb\u65b9\u6848\u4e0d\u9700\u4fe1\u7528\u5361" is true unconditionally - Plan A's CTA is a
            plain /login link, no checkout component at all, no card ever
            asked for.
          - "\u96a8\u6642\u53d6\u6d88" is honored for both processors: Paddle via
            cancelPaddleSubscription() (unchanged), NewebPay via the new
            alterNewebpayPeriodStatus() branch added to
            app/api/account/cancel/route.ts alongside this same checkout
            switch. Access continues until the already-paid period ends
            either way - see lib/tiers.ts's getUserTier(), updated the
            same day to check current_period_end instead of relying on a
            NewebPay-side event that doesn't exist to flip `status` the
            way Paddle's webhook does.
          NOTE on card-free paid plans: monthly billing (either tier) is
          still credit-card-only - \u85cd\u65b0's recurring product (\u4fe1\u7528\u5361\u5b9a\u671f\u5b9a\u984d)
          has the same constraint Paddle does, see architecture.md's
          2026-09-05 "correction" entry. Yearly billing is different as
          of the same day: NewebpayCheckoutButton's yearly option now
          goes through a one-time checkout (lib/newebpay-api.ts's
          buildCreateMpgOrderRequest()) that genuinely offers ATM
          transfer / \u8d85\u5546\u4ee3\u78bc alongside card, with no auto-renewal - see
          that function's own header comment. */}
      <div className="flex flex-col sm:flex-row justify-center gap-2 sm:gap-8 text-sm text-secondary text-center mt-8">
        <p>{"\u2713 \u514d\u8cbb\u65b9\u6848\u4e0d\u9700\u4fe1\u7528\u5361"}</p>
        <p>{"\u2713 \u4ed8\u8cbb\u65b9\u6848\u53ef\u96a8\u6642\u53d6\u6d88\uff0c\u670d\u52d9\u5c07\u6301\u7e8c\u81f3\u7576\u671f\u5df2\u4ed8\u8cbb\u9031\u671f\u7d50\u675f"}</p>
      </div>

      <p className="text-xs text-secondary text-center mt-10 max-w-xl mx-auto">
        {"\u8aaa\u660e\uff1a\u514d\u8cbb\u65b9\u6848\u4e4b\u641c\u5c0b\u7d50\u679c\u8207\u96fb\u5b50\u90f5\u4ef6\u901a\u77e5\uff0c\u7d71\u4e00\u7de8\u865f\u3001\u516c\u53f8\u540d\u7a31\u8207\u8ca0\u8cac\u4eba\u59d3\u540d\u5c07\u90e8\u5206\u906e\u853d\u4ee5\u4fdd\u8b77\u7576\u4e8b\u4eba\u96b1\u79c1\uff1b\u5730\u5340\u3001\u884c\u696d\u5225\u7b49\u5176\u4ed6\u6b04\u4f4d\u4e0d\u53d7\u5f71\u97ff\u3002\u5347\u7d1a\u4ed8\u8cbb\u65b9\u6848\u5373\u53ef\u770b\u5230\u5b8c\u6574\u672a\u906e\u853d\u8cc7\u6599\u3002"}
      </p>
    </div>
  );
}
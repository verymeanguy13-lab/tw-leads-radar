import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "搶先掌握新成立公司",
};

// 2026-09-05: this page's only CTA used to point straight at /signup -
// meaning a cold visitor never even saw /search, the free, no-login
// search this session built out (filter parity, tier-based redaction,
// a live registration-count stat). That's a real disconnect from the
// current product, independent of the redaction-vs-freshness strategy
// discussion that led here: the whole point of making search free and
// login-less is to let a stranger see real, current results before
// being asked for anything, and this page was skipping straight past
// that and asking for an account first. /search is now the primary CTA;
// /signup (for saved-search notifications) is a secondary link below
// it, not the only path in. The old sub-line ("資料新鮮度依方案而定")
// is also gone - freshness no longer varies by plan (see
// architecture.md's 2026-09-05 "redaction is now the only free-tier
// gate" entry), so that line was flatly wrong after that change.
export default function LandingPage() {
  return (
    <div>
      <section className="px-8 py-20 max-w-3xl mx-auto text-center">
        <h1 className="text-3xl font-bold mb-4">
          {"\u6436\u5148\u638c\u63e1\u65b0\u6210\u7acb\u516c\u53f8\uff0c\u6bd4\u7af6\u722d\u5c0d\u624b\u66f4\u65e9\u63a5\u89f8\u6f5b\u5728\u5ba2\u6236"}
        </h1>
        <p className="text-secondary text-lg mb-8">
          {"\u4f9d\u7522\u696d\u5225\u3001\u5730\u5340\u3001\u8cc7\u672c\u984d\u7be9\u9078\u65b0\u8a2d\u7acb\u516c\u53f8\uff0c\u4e0d\u9700\u767b\u5165\u5373\u53ef\u67e5\u8a62\u6700\u65b0\u8cc7\u6599\u3002"}
        </p>
        <Link
          href="/search"
          className="inline-block bg-[var(--accent)] text-white rounded px-8 py-3 font-semibold"
        >
          {"\u514d\u8cbb\u67e5\u8a62"}
        </Link>
        <p className="text-xs text-secondary mt-4">
          {"\u4e0d\u9700\u767b\u5165\u5373\u53ef\u67e5\u8a62\u6700\u65b0\u8cc7\u6599\uff0c\u514d\u8cbb\u65b9\u6848\u7684\u7d71\u4e00\u7de8\u865f\u3001\u516c\u53f8\u540d\u7a31\u8207\u8ca0\u8cac\u4eba\u59d3\u540d\u5c07\u90e8\u5206\u906e\u853d\u3002"}
          {" "}
          <Link href="/signup" className="underline">
            {"\u514d\u8cbb\u8a3b\u518a"}
          </Link>
          {"\uff08\u4e0d\u9700\u4fe1\u7528\u5361\uff09\u4ea6\u53ef\u5132\u5b58\u641c\u5c0b\u689d\u4ef6\uff0c\u6bcf\u6708\u81ea\u52d5\u901a\u77e5\u3002"}
        </p>
      </section>

      {/* 2026-09-05: notification-cadence sales section, added on request
          ("i want better sales stuff on the landing page. like drawing
          people for daily notifications"). Cadence is the real
          differentiator between the three tiers now that freshness and
          redaction no longer vary by plan the way they used to (free/
          anonymous search is current for everyone - see architecture.md's
          2026-09-05 "redaction is now the only free-tier gate" entry) -
          this section makes that differentiator the explicit pitch
          instead of leaving it as one line inside the old feature grid
          below. The "30倍"/"4倍" claims are not made up: they're the
          actual ratios between lib/email/digest.ts's
          CADENCE_DUE_AFTER_DAYS values (daily 0.9, weekly 6.5, monthly
          28 - 28/0.9 ≈ 31, 28/6.5 ≈ 4.3), so the copy stays honest and
          matches what the product actually does. Prices match
          lib/tiers.ts's TIER_PRICING and app/(marketing)/pricing/page.tsx
          exactly - this section links to /pricing rather than duplicating
          full plan details, so there's still one source of truth for
          what each plan includes. */}
      <section className="px-8 py-16">
        <div className="max-w-4xl mx-auto text-center mb-10">
          <h2 className="text-2xl font-bold mb-2">選擇符合你業務步調的通知頻率</h2>
          <p className="text-secondary text-sm">
            新公司每天都在登記——你多久收到通知，決定你比同業快多少。
          </p>
        </div>
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="border border-default rounded-lg p-6 text-center">
            <p className="text-sm font-semibold mb-1">免費方案</p>
            <p className="text-secondary text-sm mb-4">每月一次摘要，適合先觀察市場動態。</p>
            <p className="text-xl font-bold">NT$0</p>
          </div>
          <div className="border border-default rounded-lg p-6 text-center bg-card">
            <p className="text-sm font-semibold mb-1">方案B｜週報方案</p>
            <p className="text-secondary text-sm mb-4">
              每週摘要，掌握新客戶的速度比免費方案快約 4 倍。
            </p>
            <p className="text-xl font-bold">NT$600 / 月</p>
          </div>
          <div
            className="border-2 rounded-lg p-6 text-center bg-card relative"
            style={{ borderColor: "var(--accent)" }}
          >
            <span
              className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs text-white px-3 py-1 rounded-full whitespace-nowrap"
              style={{ backgroundColor: "var(--accent)" }}
            >
              業務團隊首選
            </span>
            <p className="text-sm font-semibold mb-1">方案C｜每日方案</p>
            <p className="text-secondary text-sm mb-4">
              每日摘要，新公司登記隔天就送到你手上——比免費方案快約 30 倍搶得第一次接觸機會。
            </p>
            <p className="text-xl font-bold">NT$1,300 / 月</p>
          </div>
        </div>
        <div className="text-center mt-8">
          <Link
            href="/pricing"
            className="inline-block underline text-sm"
            style={{ color: "var(--accent)" }}
          >
            查看完整方案內容與功能比較 →
          </Link>
        </div>
      </section>

      <section className="px-8 py-16 bg-card">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h3 className="font-semibold mb-2">{"\u7cbe\u6e96\u7be9\u9078"}</h3>
            <p className="text-secondary text-sm">
              {"\u4f9d\u7522\u696d\u5225\u3001\u7e23\u5e02\u3001\u8cc7\u672c\u984d\u7bc4\u570d\u81ea\u8a02\u689d\u4ef6\uff0c\u53ea\u770b\u4f60\u771f\u6b63\u5728\u610f\u7684\u540d\u55ae\u3002"}
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">{"\u81ea\u52d5\u96fb\u5b50\u90f5\u4ef6\u901a\u77e5"}</h3>
            <p className="text-secondary text-sm">
              {"\u65b0\u516c\u53f8\u767b\u8a18\u5f8c\uff0c\u4f9d\u65b9\u6848\u9031\u671f\u4e3b\u52d5\u901a\u77e5\uff0c\u4e0d\u5fc5\u81ea\u5df1\u52d5\u624b\u67e5\u8a62\u3002"}
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">{"\u5feb\u901f\u5730\u5716\u67e5\u8a62"}</h3>
            <p className="text-secondary text-sm">
              {"\u6bcf\u7b46\u540d\u55ae\u9644\u4e0a\u4e00\u9375Google\u5730\u5716\u641c\u5c0b\u9023\u7d50\uff0c\u5354\u52a9\u4f60\u5feb\u901f\u67e5\u627e\u806f\u7d61\u65b9\u5f0f\uff08\u662f\u5426\u627e\u5f97\u5230\u8996\u8a72\u516c\u53f8\u662f\u5426\u5df2\u5efa\u7acbGoogle\u5546\u5bb6\u6a94\u6848\u800c\u5b9a\uff0c\u4e0d\u4fdd\u8b49\u6bcf\u7b46\u90fd\u6709\uff09\u3002"}
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">{"\u53d6\u4ee3\u4eba\u5de5\u641c\u5c0b"}</h3>
            <p className="text-secondary text-sm">
              {"\u4e0d\u7528\u518d\u4e00\u9593\u4e00\u9593\u624b\u52d5\u67e5\u8a62\u516c\u53f8\u767b\u8a18\u7db2\u7ad9\uff0c\u7cfb\u7d71\u81ea\u52d5\u6574\u7406\u6210\u6e05\u55ae\u3002"}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
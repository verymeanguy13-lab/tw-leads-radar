import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptTradeInfo, computeTradeSha } from "@/lib/newebpay-api";
import { TIER_PRICING } from "@/lib/tiers";

// 2026-09-05 — 藍新 (NewebPay) NotifyURL handler for the general one-time
// checkout (幕前支付/MPG), used only by the yearly-plan flow
// (app/api/checkout/newebpay-yearly/route.ts). Sibling to
// app/api/webhooks/newebpay/route.ts (the Period/monthly webhook) - kept
// as a SEPARATE route rather than branching one handler on payload shape,
// since each checkout route points its own NotifyURL at its own webhook,
// so there's never a need for one handler to guess which flow a notify
// belongs to.
//
// **Less unverified than the Period webhook, but still unverified.** The
// outer envelope this expects (MerchantID + TradeInfo + TradeSha form
// fields) IS NewebPay's general MPG checkout notify convention - the
// same one app/api/webhooks/newebpay/route.ts's own comment already
// describes as "confirmed against multiple independent third-party
// integration writeups," except here it actually applies directly
// (that route borrowed the assumption from this exact convention for a
// different product, Period, where it wasn't confirmed to carry over).
// The inner result field names (MerchantOrderNo/TradeNo/Amt/PaymentType/
// PayTime) are now independently cross-checked (2026-09-12, before any
// real ATM/CVS payment was completed - see architecture.md) against
// NewebPay's own manual, a Laravel NewebPay package's field usage, and
// a real-world integration blog showing `data["Result"]["MerchantOrderNo"]`
// - consistent with the `{Status, Message, Result: {...}}` envelope
// shape NewebPay uses company-wide (also seen in alterNewebpayPeriodStatus()'s
// decrypted response). Still never tested against a real or sandbox
// NewebPay account end-to-end - do not trust this against real traffic
// without that test first.
//
// 2026-09-12 fix: found by static review (before spending real money to
// discover it live) - this handler had the EXACT SAME "Status checked
// on the wrong object" bug that was found and fixed in the sibling
// Period webhook the same day. Status lives on the OUTER decrypted
// envelope, not inside Result - checking `result.Status` after already
// unwrapping to `.Result` meant the check was silently always false,
// so a declined/failed MPG payment (most relevant for the yearly plan's
// credit-card option; ATM/CVS notifies are only believed to fire on
// final success at all) would have been treated as a success and
// granted the subscription without a completed payment. Fixed to check
// the envelope's own Status first, matching the Period webhook's fix.
// Also added an Amt cross-check against TIER_PRICING as cheap
// defense-in-depth - not required for security (TradeSha already proves
// NewebPay authored the payload) but guards against granting the wrong
// tier if Amt and the pending order's tier were ever to disagree.
//
// Unlike the Period webhook, a claimed order here needs no "recurring
// vs first charge" branch - there is no recurring commitment, so every
// notify this route will ever receive for a given merchant_order_no is
// the one and only charge for it. On success, this INSERTs a
// subscriptions row with NO newebpay_period_no (there is nothing to
// store there) and current_period_end set to 365 days from now - see
// app/api/checkout/newebpay-yearly/route.ts's header comment on why this
// doesn't auto-renew, and app/api/account/route.ts's `autoRenew` field
// for how that's surfaced.

interface MpgNotifyResult {
  MerchantID?: string;
  MerchantOrderNo?: string;
  TradeNo?: string;
  Amt?: number;
  PaymentType?: string;
  PayTime?: string;
}

interface MpgNotifyEnvelope {
  Status?: string;
  Message?: string;
  Result?: MpgNotifyResult;
}

// Plan durations are a flat 365 days from successful payment, not a
// calendar year - simpler to reason about and matches how this app
// already treats "current_period_end" everywhere else (a concrete
// timestamp, not a recurring calendar rule).
const YEARLY_PLAN_DAYS = 365;

export async function POST(req: NextRequest) {
  const merchantId = process.env.NEWEBPAY_MERCHANT_ID;
  if (!merchantId) {
    console.error("NewebPay MPG webhook: NEWEBPAY_MERCHANT_ID is not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const form = await req.formData();
  const tradeInfo = form.get("TradeInfo");
  const tradeSha = form.get("TradeSha");
  const postedMerchantId = form.get("MerchantID");

  if (typeof tradeInfo !== "string" || typeof tradeSha !== "string") {
    return NextResponse.json({ error: "Missing TradeInfo/TradeSha" }, { status: 400 });
  }
  if (postedMerchantId !== merchantId) {
    console.error(
      `NewebPay MPG webhook: MerchantID mismatch (got ${String(postedMerchantId)})`
    );
    return NextResponse.json({ error: "Invalid MerchantID" }, { status: 401 });
  }

  const expectedSha = computeTradeSha(tradeInfo);
  if (expectedSha !== tradeSha.toUpperCase()) {
    return NextResponse.json({ error: "Invalid TradeSha" }, { status: 401 });
  }

  let envelope: MpgNotifyEnvelope;
  try {
    const decrypted = decryptTradeInfo(tradeInfo);
    envelope = JSON.parse(decrypted) as MpgNotifyEnvelope;
  } catch (err) {
    console.error("NewebPay MPG webhook: failed to decrypt/parse TradeInfo", err);
    return NextResponse.json({ error: "Invalid TradeInfo" }, { status: 400 });
  }

  // `envelope.Status` covers both the nested-Result shape (the confirmed
  // real one) and a hypothetical flat shape (no `.Result` at all, in
  // which case `envelope` IS `result` and this is the same field) -
  // matching the Period webhook's already-fixed pattern. See this file's
  // 2026-09-12 header comment for why checking `result.Status` instead
  // (the pre-fix version) was a real bug, not just style.
  const result: MpgNotifyResult = envelope.Result ?? (envelope as MpgNotifyResult);

  if (envelope.Status && envelope.Status !== "SUCCESS") {
    console.error(
      `NewebPay MPG webhook: non-success status ${envelope.Status}`,
      envelope.Message ?? ""
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const merchantOrderNo = result.MerchantOrderNo;
  if (!merchantOrderNo) {
    console.error("NewebPay MPG webhook: missing MerchantOrderNo in result");
    return NextResponse.json({ error: "Missing order identifier" }, { status: 400 });
  }

  const sql = db();

  try {
    const pendingRows = await sql`
      SELECT user_id, tier, business_use_confirmed_at FROM newebpay_pending_orders
      WHERE merchant_order_no = ${merchantOrderNo} AND claimed_at IS NULL
    `;
    const pending = pendingRows[0] as
      | { user_id: string; tier: string; business_use_confirmed_at: string | null }
      | undefined;

    if (!pending) {
      // Either an already-claimed order (a duplicate notify - NewebPay,
      // like most gateways, can resend) or a notify for an order this
      // app never recorded (shouldn't happen in normal operation, since
      // this route only exists to serve orders newebpay-yearly's own
      // route created). Log and no-op rather than error - safe either
      // way, since re-inserting would either violate the UNIQUE
      // constraint on newebpay_merchant_order_no or duplicate access
      // grants.
      console.error(
        `NewebPay MPG webhook: no unclaimed pending order for ${merchantOrderNo} - likely a duplicate notify`
      );
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // 2026-09-12: cheap defense-in-depth, not a security requirement
    // (TradeSha already proves NewebPay authored this payload) - but if
    // Amt and the pending order's own tier ever disagree, that's a sign
    // something is wrong (stale pricing, a tampered client-side amount
    // that somehow got this far, a future pricing-map edit that forgot
    // this table) and this should NOT silently grant access. Logs and
    // refuses rather than guessing which one to trust.
    //
    // Number(...) on both sides deliberately, not a strict `!==` on the
    // raw values: NewebPay's own JSON encoding for Amt (string vs.
    // number) has never been confirmed by a real payload, and comparing
    // "6000" !== 6000 with strict inequality would treat every genuine
    // successful payment as a mismatch and reject it - the opposite of
    // this check's purpose. Number(undefined) is NaN, so a missing Amt
    // still safely falls through to skip the check via the isNaN guard
    // rather than false-positive against 0.
    const expectedAmt =
      pending.tier === "pro" || pending.tier === "business"
        ? TIER_PRICING[pending.tier].yearly
        : undefined;
    const actualAmt = Number(result.Amt);
    if (expectedAmt !== undefined && !Number.isNaN(actualAmt) && actualAmt !== expectedAmt) {
      console.error(
        `NewebPay MPG webhook: Amt mismatch for ${merchantOrderNo} - got ${result.Amt}, expected ${expectedAmt} for tier ${pending.tier}. Refusing to grant access; investigate before manually resolving.`
      );
      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
    }

    await sql`
      INSERT INTO subscriptions (
        user_id, newebpay_merchant_order_no, tier, status, current_period_end,
        business_use_confirmed_at
      )
      VALUES (
        ${pending.user_id}, ${merchantOrderNo}, ${pending.tier}, 'active',
        now() + (${YEARLY_PLAN_DAYS} || ' days')::interval, ${pending.business_use_confirmed_at}
      )
      ON CONFLICT (newebpay_merchant_order_no) DO NOTHING
    `;
    await sql`
      UPDATE newebpay_pending_orders SET claimed_at = now()
      WHERE merchant_order_no = ${merchantOrderNo}
    `;
  } catch (err) {
    console.error("NewebPay MPG webhook processing error:", err);
    return NextResponse.json({ error: "Processing error" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

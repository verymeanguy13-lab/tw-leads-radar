import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptTradeInfo, computeTradeSha } from "@/lib/newebpay-api";

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
// What's NOT verified here: the exact inner result field names for a
// one-time MPG order specifically (Status/MerchantOrderNo/TradeNo/Amt/
// PaymentType assumed from the same sources lib/newebpay-api.ts's
// buildCreateMpgOrderRequest() cites), and this has never been tested
// against a real or sandbox NewebPay account - do not trust it against
// real traffic without that test first.
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
  Status?: string;
  MerchantID?: string;
  MerchantOrderNo?: string;
  TradeNo?: string;
  Amt?: number;
  PaymentType?: string;
  PayTime?: string;
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

  let result: MpgNotifyResult;
  try {
    const decrypted = decryptTradeInfo(tradeInfo);
    const parsed = JSON.parse(decrypted);
    // Same defensive "check both" pattern as the Period webhook - not
    // confirmed which shape a one-time MPG notify actually uses either.
    result = (parsed.Result ?? parsed) as MpgNotifyResult;
  } catch (err) {
    console.error("NewebPay MPG webhook: failed to decrypt/parse TradeInfo", err);
    return NextResponse.json({ error: "Invalid TradeInfo" }, { status: 400 });
  }

  if (result.Status && result.Status !== "SUCCESS") {
    console.error(`NewebPay MPG webhook: non-success status ${result.Status}`);
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
      SELECT user_id, tier FROM newebpay_pending_orders
      WHERE merchant_order_no = ${merchantOrderNo} AND claimed_at IS NULL
    `;
    const pending = pendingRows[0] as { user_id: string; tier: string } | undefined;

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

    await sql`
      INSERT INTO subscriptions (
        user_id, newebpay_merchant_order_no, tier, status, current_period_end
      )
      VALUES (
        ${pending.user_id}, ${merchantOrderNo}, ${pending.tier}, 'active',
        now() + (${YEARLY_PLAN_DAYS} || ' days')::interval
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

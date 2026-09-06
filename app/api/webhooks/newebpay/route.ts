import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptTradeInfo, computeTradeSha } from "@/lib/newebpay-api";

// 2026-09-04 — 藍新 (NewebPay) NotifyURL handler for 信用卡定期定額
// (recurring credit card) charges. Mirrors app/api/webhooks/paddle/
// route.ts's role and the "webhook is the single source of truth for
// subscription state" pattern app/api/account/cancel/route.ts already
// documents and relies on.
//
// **UNVERIFIED, READ BEFORE TRUSTING THIS IN PRODUCTION:** the envelope
// this expects (MerchantID + TradeInfo + TradeSha form fields) is
// NewebPay's well-documented convention for their general MPG (幕前支付)
// checkout notify — confirmed against multiple independent third-party
// integration writeups. It is NOT confirmed specifically for the Period
// (定期定額) API's NotifyURL — the field-level spec this session pulled
// (architecture.md, 2026-09-04) lists the *inner* result fields
// (Status, PeriodNo, TradeNo, etc.) but never states the outer wrapper
// field name for Period specifically, and the official PDF (current
// version NDNP-1.0.6) could not be fetched to confirm either way. If
// real test notifications don't parse, this envelope assumption — not
// the inner field names below — is the first thing to check.
//
// Also unbuilt: nothing yet inserts into newebpay_pending_orders (see
// db/schema.sql) at checkout-initiation time, since no checkout route
// calling lib/newebpay-api.ts's buildCreatePeriodOrderRequest() exists
// yet. This handler will find no matching row and log+no-op until that
// exists — expected, not a bug, until that half is built.

interface PeriodNotifyResult {
  Status?: string;
  MerchantID?: string;
  MerchantOrderNo?: string;
  PeriodNo?: string;
  TradeNo?: string;
  AuthTime?: string;
  AuthAmt?: number;
  DateArray?: string;
  AlreadyTimes?: number;
  AuthTimes?: number;
  NextAuthDate?: string;
}

export async function POST(req: NextRequest) {
  const merchantId = process.env.NEWEBPAY_MERCHANT_ID;
  if (!merchantId) {
    console.error("NewebPay webhook: NEWEBPAY_MERCHANT_ID is not set");
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
      `NewebPay webhook: MerchantID mismatch (got ${String(postedMerchantId)})`
    );
    return NextResponse.json({ error: "Invalid MerchantID" }, { status: 401 });
  }

  const expectedSha = computeTradeSha(tradeInfo);
  if (expectedSha !== tradeSha.toUpperCase()) {
    return NextResponse.json({ error: "Invalid TradeSha" }, { status: 401 });
  }

  let result: PeriodNotifyResult;
  try {
    const decrypted = decryptTradeInfo(tradeInfo);
    const parsed = JSON.parse(decrypted);
    // Some NewebPay flows nest the actual fields under `.Result`, others
    // return them at the top level — not confirmed which applies to
    // Period specifically, so check both rather than assume.
    result = (parsed.Result ?? parsed) as PeriodNotifyResult;
  } catch (err) {
    console.error("NewebPay webhook: failed to decrypt/parse TradeInfo", err);
    return NextResponse.json({ error: "Invalid TradeInfo" }, { status: 400 });
  }

  if (result.Status && result.Status !== "SUCCESS") {
    console.error(`NewebPay webhook: non-success status ${result.Status}`);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const merchantOrderNo = result.MerchantOrderNo;
  const periodNo = result.PeriodNo;
  if (!merchantOrderNo || !periodNo) {
    console.error("NewebPay webhook: missing MerchantOrderNo or PeriodNo in result");
    return NextResponse.json({ error: "Missing order/period identifiers" }, { status: 400 });
  }

  const sql = db();

  try {
    // First charge on a brand-new recurring order: claim the pending
    // order (inserted at checkout-initiation time — not yet built) and
    // create the real subscription row.
    const pendingRows = await sql`
      SELECT user_id, tier, business_use_confirmed_at FROM newebpay_pending_orders
      WHERE merchant_order_no = ${merchantOrderNo} AND claimed_at IS NULL
    `;
    const pending = pendingRows[0] as
      | { user_id: string; tier: string; business_use_confirmed_at: string | null }
      | undefined;

    if (pending) {
      await sql`
        INSERT INTO subscriptions (
          user_id, newebpay_merchant_order_no, newebpay_period_no, tier, status, current_period_end,
          business_use_confirmed_at
        )
        VALUES (
          ${pending.user_id}, ${merchantOrderNo}, ${periodNo}, ${pending.tier}, 'active',
          ${result.NextAuthDate ?? null}, ${pending.business_use_confirmed_at}
        )
        ON CONFLICT (newebpay_period_no) DO UPDATE
        SET status = 'active',
            current_period_end = EXCLUDED.current_period_end,
            updated_at = now()
      `;
      await sql`
        UPDATE newebpay_pending_orders SET claimed_at = now()
        WHERE merchant_order_no = ${merchantOrderNo}
      `;
    } else {
      // Recurring (non-first) charge on an already-claimed order, or a
      // notify for an order this app has no pending row for (e.g. the
      // checkout-initiation half isn't built yet). Update by
      // newebpay_period_no if we already know it; otherwise there's
      // nothing to attach this to yet.
      const updated = await sql`
        UPDATE subscriptions
        SET status = 'active',
            current_period_end = ${result.NextAuthDate ?? null},
            updated_at = now()
        WHERE newebpay_period_no = ${periodNo}
        RETURNING id
      `;
      // RETURNING is required here for .length to reflect actual rows
      // affected — matching app/api/searches/[id]/route.ts's existing
      // pattern for this exact check. Without it, neon's driver returns
      // an empty array for UPDATE regardless of how many rows matched,
      // which would make this check silently useless.
      if (updated.length === 0) {
        console.error(
          `NewebPay webhook: no pending order or existing subscription for ${merchantOrderNo}/${periodNo} — likely means checkout-initiation isn't wired up yet`
        );
      }
    }
  } catch (err) {
    console.error("NewebPay webhook processing error:", err);
    return NextResponse.json({ error: "Processing error" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

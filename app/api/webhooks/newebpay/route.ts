import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptTradeInfo, alterNewebpayPeriodStatus } from "@/lib/newebpay-api";

// 2026-09-04 — 藍新 (NewebPay) NotifyURL handler for 信用卡定期定額
// (recurring credit card) charges. Mirrors app/api/webhooks/paddle/
// route.ts's role and the "webhook is the single source of truth for
// subscription state" pattern app/api/account/cancel/route.ts already
// documents and relies on.
//
// 2026-09-12 fix: the envelope this originally expected (MerchantID +
// TradeInfo + TradeSha form fields) turned out to be NewebPay's general
// MPG (幕前支付) checkout notify convention — correct for the *yearly*
// one-time checkout's webhook (app/api/webhooks/newebpay-mpg/route.ts),
// but WRONG for Period. Confirmed against NewebPay's own official
// 信用卡定期定額技術串接手冊 PDF: Period's NotifyURL POSTs a single form
// field literally named "Period" (AES-256-CBC encrypted, same HashKey/
// HashIV as PostData_) — no separate TradeInfo/TradeSha/MerchantID
// fields alongside it at all. Because this handler was checking for
// fields that never arrive, it 400'd on every real Period notify before
// ever reaching the decrypt/DB-update logic below — confirmed live
// 2026-09-12 when a real Plan B subscribe payment never updated the
// user's account. This was the exact risk this file's own previous
// comment flagged ("if real test notifications don't parse, this
// envelope assumption is the first thing to check") — it was.
//
// Also fixed in the same pass: the decrypted payload's shape is
// `{ Status, Message, Result: { MerchantID, MerchantOrderNo, PeriodNo,
// ... } }` per the same manual — Status lives on the OUTER object, not
// inside Result. The previous code checked `result.Status` where
// `result` was already unwrapped to `.Result`, so that check was
// silently always false (Result has no Status field) and a declined/
// failed charge would have been treated as success. Fixed by checking
// the envelope's own Status first, falling back to the unwrapped
// object's in case a future/other NewebPay flow returns it flat.
//
// There's no separate outer MerchantID field to check against
// process.env.NEWEBPAY_MERCHANT_ID for Period (unlike MPG) — the only
// thing NewebPay sends is the single encrypted field, so the MerchantID
// check now happens against the *decrypted* value instead. Successful
// AES decryption + JSON.parse with our own HashKey/HashIV is itself
// already strong evidence this came from NewebPay (a forged payload
// encrypted with the wrong key would not decrypt to valid JSON), and the
// MerchantID cross-check below is belt-and-suspenders on top of that.
interface PeriodNotifyResult {
  MerchantID?: string;
  MerchantOrderNo?: string;
  PeriodNo?: string;
  TradeNo?: string;
  AuthDate?: string;
  AuthAmt?: number;
  TotalTimes?: number;
  AlreadyTimes?: number;
  NextAuthDate?: string;
}

interface PeriodNotifyEnvelope {
  Status?: string;
  Message?: string;
  Result?: PeriodNotifyResult;
}

// Also unbuilt: nothing yet inserts into newebpay_pending_orders (see
// db/schema.sql) at checkout-initiation time, since no checkout route
// calling lib/newebpay-api.ts's buildCreatePeriodOrderRequest() exists
// yet. This handler will find no matching row and log+no-op until that
// exists — expected, not a bug, until that half is built.

export async function POST(req: NextRequest) {
  const merchantId = process.env.NEWEBPAY_MERCHANT_ID;
  if (!merchantId) {
    console.error("NewebPay webhook: NEWEBPAY_MERCHANT_ID is not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const form = await req.formData();
  const periodField = form.get("Period");

  if (typeof periodField !== "string") {
    return NextResponse.json({ error: "Missing Period field" }, { status: 400 });
  }

  let envelope: PeriodNotifyEnvelope;
  try {
    const decrypted = decryptTradeInfo(periodField);
    envelope = JSON.parse(decrypted) as PeriodNotifyEnvelope;
  } catch (err) {
    console.error("NewebPay webhook: failed to decrypt/parse Period field", err);
    return NextResponse.json({ error: "Invalid Period payload" }, { status: 400 });
  }

  // Some NewebPay flows nest the actual fields under `.Result`, others
  // return them at the top level — not confirmed which applies to Period
  // specifically for every notify type, so check both rather than
  // assume.
  const result: PeriodNotifyResult = envelope.Result ?? (envelope as PeriodNotifyResult);

  if (result.MerchantID && result.MerchantID !== merchantId) {
    console.error(`NewebPay webhook: MerchantID mismatch in decrypted Period payload (got ${result.MerchantID})`);
    return NextResponse.json({ error: "Invalid MerchantID" }, { status: 401 });
  }

  // `envelope.Status` covers both shapes: when Result is nested, Status
  // sits alongside it on the outer envelope; when a flow instead returns
  // everything flat (no `.Result` at all), `envelope` IS `result`, so
  // `envelope.Status` is the same field either way. No separate check on
  // `result` is needed here.
  if (envelope.Status && envelope.Status !== "SUCCESS") {
    console.error(`NewebPay webhook: non-success status ${envelope.Status}`, envelope.Message ?? "");
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
      SELECT user_id, tier, business_use_confirmed_at, supersedes_period_no
      FROM newebpay_pending_orders
      WHERE merchant_order_no = ${merchantOrderNo} AND claimed_at IS NULL
    `;
    const pending = pendingRows[0] as
      | {
          user_id: string;
          tier: string;
          business_use_confirmed_at: string | null;
          supersedes_period_no: string | null;
        }
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

      // 2026-09-08 — plan-switch (see app/api/checkout/newebpay-switch/
      // route.ts): this order was created specifically to REPLACE an
      // existing Period commitment, named here rather than at
      // checkout-initiation time — see that route's header comment for
      // why the termination must wait until here (the new commitment is
      // now confirmed paid; terminating any earlier would risk leaving a
      // customer who abandons checkout with nothing active at all).
      //
      // Deliberately does NOT fail or roll back the new subscription
      // above if this fails — the customer has already been charged for
      // the new plan, and that must stand regardless. If AlterStatus
      // doesn't return success, the old commitment's `subscriptions` row
      // is intentionally left untouched (still 'active') rather than
      // marked canceled here — marking it canceled without confirmation
      // that NewebPay actually stopped billing it would make this app
      // silently misreport its own billing state. The console.error
      // below is the only signal that will exist for this — **no retry,
      // alerting, or admin UI surfaces this today**; someone needs to
      // grep production logs (or eyeball NewebPay's own back office
      // periodically) to catch a stuck double-billing case until that's
      // built. Flagging this now rather than letting it be a silent gap.
      if (pending.supersedes_period_no) {
        try {
          // 2026-09-12: alterNewebpayPeriodStatus() now requires the OLD
          // commitment's own original MerOrderNo alongside its PeriodNo
          // (see that function's header comment) — look it up from the
          // subscription row being superseded rather than assuming
          // merchantOrderNo above applies (that's the NEW switch order's
          // number, not the old commitment's).
          const supersededRows = await sql`
            SELECT newebpay_merchant_order_no FROM subscriptions
            WHERE newebpay_period_no = ${pending.supersedes_period_no}
          `;
          const supersededMerchantOrderNo = supersededRows[0]?.newebpay_merchant_order_no as
            | string
            | undefined;
          if (!supersededMerchantOrderNo) {
            throw new Error(
              `no newebpay_merchant_order_no found for superseded period ${pending.supersedes_period_no}`
            );
          }
          const alterResult = await alterNewebpayPeriodStatus(
            pending.supersedes_period_no,
            supersededMerchantOrderNo,
            "terminate"
          );
          if (alterResult.success) {
            await sql`
              UPDATE subscriptions
              SET status = 'canceled', canceled_at = now(), updated_at = now()
              WHERE newebpay_period_no = ${pending.supersedes_period_no}
            `;
          } else {
            console.error(
              `NewebPay webhook: AlterStatus terminate returned non-success for superseded period ${pending.supersedes_period_no} (plan switch to new period ${periodNo}) — the OLD commitment is likely still active and MAY KEEP CHARGING at its old tier's price. Manual intervention required: terminate ${pending.supersedes_period_no} directly in NewebPay's back office.`,
              alterResult
            );
          }
        } catch (err) {
          console.error(
            `NewebPay webhook: error calling AlterStatus terminate for superseded period ${pending.supersedes_period_no} (plan switch to new period ${periodNo}) — manual intervention required to avoid double-billing.`,
            err
          );
        }
      }
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

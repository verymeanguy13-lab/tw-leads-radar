// 2026-09-04 — 藍新 (NewebPay) 信用卡定期定額 (recurring credit card)
// server-side API client. Mirrors lib/paddle-api.ts's role for Paddle,
// but NewebPay has no equivalent of a client-side Checkout.js call —
// the Period-creation request below IS the checkout initiation, done
// entirely server-side, then the merchant redirects the browser to
// NewebPay's own hosted payment page using the encrypted PostData_ this
// module produces.
//
// Field-level spec this is built against: pulled 2026-09-04 from a
// third-party mirror of NewebPay's own PDF, version NDNP-1.0.4
// (2024/05/15) — NOT the newest NDNP-1.0.6 referenced in NewebPay's own
// search-indexed filenames, which this session could not fetch (their
// direct download links 404'd/session-gated). See architecture.md's
// 2026-09-04 "藍新 (NewebPay) 信用卡定期定額 field-level API spec pulled"
// entry for the full gap list. Re-verify every field name here against
// the actual current PDF, ideally against a real sandbox account,
// before this touches production traffic — nothing in this file has
// been tested against a live or sandbox NewebPay endpoint.
//
// Setup required before this works: a 藍新 個人 (individual) merchant
// account (2026-09-04 decision — staying unincorporated), with
// NEWEBPAY_MERCHANT_ID, NEWEBPAY_HASH_KEY, and NEWEBPAY_HASH_IV set from
// that account's credentials. None of that exists yet as of this
// writing — this module will throw at runtime until it does.

import crypto from "crypto";

const NEWEBPAY_BASE_URL =
  process.env.NEXT_PUBLIC_NEWEBPAY_ENV === "sandbox"
    ? "https://ccore.newebpay.com"
    : "https://core.newebpay.com";

const PERIOD_CREATE_PATH = "/MPG/period";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`NewebPay: ${name} is not set`);
  }
  return value;
}

/**
 * AES-256-CBC encrypt, per NewebPay's convention: key = HashKey (32
 * bytes), iv = HashIV (16 bytes), PKCS7 padding (Node's default).
 * Output is lowercase hex, matching every third-party integration
 * example found for this platform.
 */
function encryptPostData(fields: Record<string, string | number>): string {
  const hashKey = requireEnv("NEWEBPAY_HASH_KEY");
  const hashIv = requireEnv("NEWEBPAY_HASH_IV");

  const query = Object.entries(fields)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");

  const cipher = crypto.createCipheriv("aes-256-cbc", hashKey, hashIv);
  const encrypted = Buffer.concat([cipher.update(query, "utf8"), cipher.final()]);
  return encrypted.toString("hex");
}

/**
 * Decrypt an AES-256-CBC hex payload NewebPay sent back (TradeInfo on
 * their general MPG checkout flow — see the route-level comment in
 * app/api/webhooks/newebpay/route.ts for why the Period API's notify
 * envelope specifically is NOT confirmed to use this same field name).
 * setAutoPadding(false) + stripping trailing padding bytes matches the
 * pattern several independent 藍新 integration writeups use, since
 * NewebPay's own padding scheme has historically not matched Node's
 * strict PKCS7 validation in every case.
 */
export function decryptTradeInfo(hex: string): string {
  const hashKey = requireEnv("NEWEBPAY_HASH_KEY");
  const hashIv = requireEnv("NEWEBPAY_HASH_IV");

  const decipher = crypto.createDecipheriv("aes-256-cbc", hashKey, hashIv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(hex, "hex")),
    decipher.final(),
  ]);
  // Strip PKCS7 padding / trailing control bytes NewebPay's own padding
  // can leave behind — matches the \x00-\x20 strip several independent
  // integration writeups use rather than trusting setAutoPadding(true).
  return decrypted.toString("utf8").replace(/[\x00-\x20]+$/, "");
}

/** SHA256("HashKey={key}&{tradeInfoHex}&HashIV={iv}") uppercased — the
 * checksum NewebPay computes the same way on their end and expects to
 * match the TradeSha field, on their general MPG notify convention. */
export function computeTradeSha(tradeInfoHex: string): string {
  const hashKey = requireEnv("NEWEBPAY_HASH_KEY");
  const hashIv = requireEnv("NEWEBPAY_HASH_IV");
  const raw = `HashKey=${hashKey}&${tradeInfoHex}&HashIV=${hashIv}`;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex").toUpperCase();
}

export type PeriodType = "D" | "W" | "M" | "Y";

export interface CreatePeriodOrderParams {
  merchantOrderNo: string;
  periodAmt: number;
  periodType: PeriodType;
  /** Day/point within the cycle NewebPay charges on — string(4) per the
   * spec; exact encoding differs by periodType and isn't fully spelled
   * out in the field list this was built from. Confirm the exact
   * expected format (e.g. "01" for day-of-month on M) before using. */
  periodPoint: string;
  periodTimes: number;
  payerEmail: string;
  prodDesc: string;
  returnUrl?: string;
  notifyUrl?: string;
}

/**
 * Builds the encrypted PostData_ for a new recurring order. This does
 * NOT call fetch() and get a JSON response back the way Paddle's REST
 * API does — NewebPay's Period-creation flow returns an HTML page
 * meant to be shown to (or auto-submitted by) the payer's browser, so
 * the caller is responsible for redirecting/rendering the response,
 * not parsing JSON out of it. Not yet wired into any checkout route —
 * no caller exists yet.
 */
export function buildCreatePeriodOrderRequest(params: CreatePeriodOrderParams): {
  url: string;
  postData: string;
  merchantId: string;
} {
  const merchantId = requireEnv("NEWEBPAY_MERCHANT_ID");

  const fields: Record<string, string | number> = {
    RespondType: "JSON",
    TimeStamp: Math.floor(Date.now() / 1000),
    Version: "1.5",
    MerOrderNo: params.merchantOrderNo,
    PeriodAmt: params.periodAmt,
    PeriodType: params.periodType,
    PeriodPoint: params.periodPoint,
    PeriodStartType: 2, // full amount charged on first cycle
    PeriodTimes: params.periodTimes,
    PayerEmail: params.payerEmail,
    ProdDesc: params.prodDesc,
  };
  if (params.returnUrl) fields.ReturnURL = params.returnUrl;
  if (params.notifyUrl) fields.NotifyURL = params.notifyUrl;

  return {
    url: `${NEWEBPAY_BASE_URL}${PERIOD_CREATE_PATH}`,
    postData: encryptPostData(fields),
    merchantId,
  };
}

const MPG_CHECKOUT_PATH = "/MPG/mpg_gateway";

/**
 * 2026-09-05 — 藍新 (NewebPay) general one-time checkout (幕前支付/MPG),
 * added for the yearly-plan "pay via ATM transfer or 超商代碼, no credit
 * card" option — genuinely different from everything else in this file,
 * which is all built against the recurring Period (定期定額) API. Period
 * is credit-card-only (see architecture.md's 2026-09-05 "correction"
 * entry); ATM transfer and 超商代碼 are one-time, manually-completed
 * payment methods that cannot power a recurring charge, but they work
 * fine for a one-time annual payment - the customer just doesn't get
 * auto-renewed the way a card-based subscription does. This module
 * covers ONLY that one-time order; the resulting `subscriptions` row has
 * no `newebpay_period_no` (there is no recurring commitment) and does
 * not auto-renew - see app/api/checkout/newebpay-yearly/route.ts and
 * app/api/webhooks/newebpay-mpg/route.ts.
 *
 * Field-level spec sourced this session (2026-09-05) from NewebPay MPG
 * integration writeups independently cross-checked across two sources
 * (a GitHub SDK's README and an iThome technical article) - NOT
 * NewebPay's own authoritative PDF, which this session still cannot
 * fetch (same blocker as the Period API spec). Both sources agreed on
 * the outer envelope (MerchantID/TradeInfo/TradeSha/Version) and the
 * AES-256-CBC + SHA256 encryption scheme, which is reassuring since it
 * exactly matches encryptPostData()/computeTradeSha() already built and
 * shipped in this file for the Period API - same convention, real
 * cross-validation, not a coincidence. The payment-method flags
 * (CREDIT/WEBATM/VACC/CVS/BARCODE) are confirmed present and named
 * this way across sources; which of VACC vs WEBATM vs CVS vs BARCODE
 * Taiwanese payers intuitively call "ATM" was not independently
 * confirmed - VACC (a virtual account number to transfer to, matching
 * "ATM轉帳"/"ATM 3568388" that most Taiwanese SaaS/course sites market
 * as their no-card option) is enabled here alongside CVS (超商代碼) and
 * BARCODE (條碼繳費) so the customer sees every non-card option
 * NewebPay's own hosted page supports for this order, not just one.
 * CREDIT stays enabled too, so someone who prefers a card for the
 * annual plan still can.
 *
 * Same standing caveat as every other function in this file: UNVERIFIED
 * against NewebPay's authoritative spec or a real/sandbox account.
 * Payment-method selection, ATM virtual-account display, and CVS code
 * display all happen entirely on NewebPay's own hosted page after the
 * browser is redirected there (this module never sees or handles those
 * details itself) - but whether the *notify* envelope this session's
 * webhook code expects for a one-time MPG order (as opposed to a Period
 * order) is correct has never been tested end-to-end.
 */
export interface CreateMpgOrderParams {
  merchantOrderNo: string;
  amt: number;
  itemDesc: string;
  payerEmail: string;
  returnUrl?: string;
  notifyUrl?: string;
  clientBackUrl?: string;
}

export function buildCreateMpgOrderRequest(params: CreateMpgOrderParams): {
  url: string;
  merchantId: string;
  tradeInfo: string;
  tradeSha: string;
  version: string;
} {
  const merchantId = requireEnv("NEWEBPAY_MERCHANT_ID");
  const version = "2.0";

  const fields: Record<string, string | number> = {
    MerchantID: merchantId,
    RespondType: "JSON",
    TimeStamp: Math.floor(Date.now() / 1000),
    Version: version,
    MerchantOrderNo: params.merchantOrderNo,
    Amt: params.amt,
    ItemDesc: params.itemDesc,
    Email: params.payerEmail,
    LoginType: 0,
    // Payment methods offered on NewebPay's hosted page - see this
    // function's header comment for why these four specifically.
    CREDIT: 1,
    VACC: 1,
    CVS: 1,
    BARCODE: 1,
  };
  if (params.returnUrl) fields.ReturnURL = params.returnUrl;
  if (params.notifyUrl) fields.NotifyURL = params.notifyUrl;
  if (params.clientBackUrl) fields.ClientBackURL = params.clientBackUrl;

  const tradeInfo = encryptPostData(fields);
  const tradeSha = computeTradeSha(tradeInfo);

  return {
    url: `${NEWEBPAY_BASE_URL}${MPG_CHECKOUT_PATH}`,
    merchantId,
    tradeInfo,
    tradeSha,
    version,
  };
}

const PERIOD_ALTER_STATUS_PATH = "/MPG/period/AlterStatus";

// AlterType values per the most commonly documented convention across
// independent 藍新 Period-API integration writeups (this session found no
// authoritative confirmation, same caveat as everything else in this
// file - see the header comment): 1 = 啟用/restart a suspended
// commitment, 2 = 停用/temporarily suspend (skips future charges but
// keeps the commitment alive), 3 = 終止/terminate permanently. "Cancel"
// in this product's own account-cancellation flow means terminate, not
// suspend - matches cancelPaddleSubscription()'s behavior (ends the
// subscription outright, doesn't pause it).
export type PeriodAlterAction = "restart" | "suspend" | "terminate";

const ALTER_TYPE: Record<PeriodAlterAction, number> = {
  restart: 1,
  suspend: 2,
  terminate: 3,
};

export interface AlterPeriodStatusResult {
  success: boolean;
  status?: string;
  message?: string;
}

/**
 * Terminates (or suspends/restarts) an existing NewebPay Period
 * commitment, stopping future charges. Unlike
 * buildCreatePeriodOrderRequest(), which produces a browser-redirect
 * payload for a brand-new order, this is a direct server-to-server call:
 * no new card authorization is needed to stop future charges on an
 * already-authorized recurring commitment, so NewebPay's JSON response
 * comes back synchronously with no browser involvement.
 *
 * **UNVERIFIED, same caveat as the rest of this file:** this session
 * could not fetch NewebPay's authoritative current PDF (NDNP-1.0.6) or
 * test against a real/sandbox account. The request shape below (an
 * encrypted PostData_ alongside a plain MerchantID field, matching the
 * convention buildCreatePeriodOrderRequest()/NewebpayCheckoutButton.tsx
 * already use elsewhere in this codebase) and the assumed
 * {Status, Message} JSON response envelope are both modeled on that same
 * convention, not confirmed against the official spec for this specific
 * endpoint. Do not trust this against real subscriber traffic without
 * testing it against an actual NewebPay sandbox account first — nothing
 * in this codebase has been, per every other file in this integration.
 *
 * Deliberately does NOT touch this app's own `subscriptions` table -
 * matches app/api/account/cancel/route.ts's existing Paddle-side pattern
 * of leaving `status`/`current_period_end` exactly as last set by the
 * most recent successful-charge notify, so the customer's access
 * continues until that already-paid period genuinely ends (see
 * lib/tiers.ts's getUserTier(), which now checks current_period_end for
 * both processors) rather than being cut off the moment they cancel.
 */
export async function alterNewebpayPeriodStatus(
  periodNo: string,
  action: PeriodAlterAction
): Promise<AlterPeriodStatusResult> {
  const merchantId = requireEnv("NEWEBPAY_MERCHANT_ID");

  const fields: Record<string, string | number> = {
    RespondType: "JSON",
    Version: "1.0",
    TimeStamp: Math.floor(Date.now() / 1000),
    PeriodNo: periodNo,
    AlterType: ALTER_TYPE[action],
  };
  const postData = encryptPostData(fields);

  const res = await fetch(`${NEWEBPAY_BASE_URL}${PERIOD_ALTER_STATUS_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ MerchantID: merchantId, PostData_: postData }).toString(),
  });

  if (!res.ok) {
    throw new Error(`NewebPay AlterStatus HTTP ${res.status}`);
  }

  // Response envelope for this endpoint is unconfirmed - assuming a
  // {Status, Message} shape consistent with NewebPay's RespondType:
  // "JSON" convention used elsewhere in this file, but not verified
  // against a real account.
  const json = await res.json().catch(() => null as { Status?: string; Message?: string } | null);
  const status = json?.Status;
  return {
    success: status === "SUCCESS",
    status,
    message: json?.Message,
  };
}

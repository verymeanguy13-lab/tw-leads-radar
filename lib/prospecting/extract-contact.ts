import * as cheerio from "cheerio";
import type { Browser } from "playwright";

// Sessions 25-26 shared helpers: fetch a page two ways (cheap static
// fetch first, real-browser render as a fallback for JS-rendered
// sites), then heuristically pull phone/email/address out of whatever
// text comes back. None of this guesses at a field that isn't actually
// present in the fetched text - every extractor returns undefined
// rather than a fabricated value when it finds no match, per the
// blueprint's explicit "store null rather than guessing" instruction
// (Session 25 Step 2).

export interface FetchedText {
  html: string;
  text: string;
}

// Plain HTTP fetch + cheerio text extraction. Works for ordinary
// server-rendered sites (confirmed against several 記帳士公會 sites this
// session - see architecture.md). Does NOT execute JavaScript, so a
// client-side-rendered (SPA) site will come back with only its initial
// shell markup, little or no body text.
export async function fetchStatic(url: string): Promise<FetchedText | undefined> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TaiwanLeadsBot/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return undefined;
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    const text = $("body").text().replace(/\s+/g, " ").trim();
    return { html, text };
  } catch {
    return undefined;
  }
}

// Real headless-browser render, for sites confirmed or suspected to be
// JS-rendered (e.g. 新北市記帳士公會's SPA, or as a last-resort retry when
// fetchStatic() comes back with no usable contact text). Mirrors
// scripts/refresh-industry-csv.ts's existing chromium.launch() pattern
// - reuses a single passed-in browser rather than launching one per
// call, since a scraper run may call this many times.
export async function fetchRendered(
  browser: Browser,
  url: string
): Promise<FetchedText | undefined> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    const html = await page.content();
    const text = (await page.evaluate(() => document.body?.innerText ?? "")).replace(/\s+/g, " ").trim();
    return { html, text };
  } catch {
    return undefined;
  } finally {
    await page.close();
  }
}

// Landline (e.g. 02-2391-3123, (04)751-3117, 03 936 8686) and mobile
// (09xx-xxx-xxx) patterns. Deliberately does not try to match 0800
// toll-free numbers - not seen in any real source checked this session,
// not worth the extra false-positive risk.
const PHONE_PATTERN = /\(?0\d{1,2}\)?[-\s]?\d{3,4}[-\s]?\d{3,4}/;

export function extractPhone(text: string): string | undefined {
  const match = text.match(PHONE_PATTERN);
  return match ? match[0].trim() : undefined;
}

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function extractEmail(text: string): string | undefined {
  const match = text.match(EMAIL_PATTERN);
  return match ? match[0] : undefined;
}

// Address heuristic: prefer text immediately following an explicit
// "地址" label (most reliable - every source found this session used
// this exact label), fall back to a generic Taiwan-address-shaped
// substring (city/county + a road/street token + a number) if no
// labeled address is present. Neither path fabricates a value; both
// return undefined on no match.
const LABELED_ADDRESS_PATTERN = /地址[：:]\s*([^\s].{4,60}?)(?=[\s]{2,}|電話|傳真|Tel|Fax|$)/;
const GENERIC_ADDRESS_PATTERN =
  /(?:[一-龥]{2,3}[市縣])[一-龥0-9０-９]{2,4}(?:區|鄉|鎮|市)?[一-龥0-9０-９]{0,10}(?:路|街|大道|巷)[一-龥0-9０-９]{0,15}(?:號|樓)/;

export function extractAddress(text: string): string | undefined {
  const labeled = text.match(LABELED_ADDRESS_PATTERN);
  if (labeled) return labeled[1].trim();
  const generic = text.match(GENERIC_ADDRESS_PATTERN);
  return generic ? generic[0].trim() : undefined;
}

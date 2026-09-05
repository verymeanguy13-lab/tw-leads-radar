// Public, no-login search (added 2026-09-05): masking rules applied to
// companies rows before they ever leave the server for an unauthenticated
// request. These functions must be the ONLY place unmasked company data
// touches a response for that route - see app/(marketing)/search/page.tsx.
//
// Design note: the user asked to mirror a competitor's redacted search
// results. Reverse-engineering their sample against ~30 real rows gave two
// rules with 100% consistency:
//   - Uniform ID (統一編號, always 8 digits): shown as "***" + the last 5
//     digits. Never fewer, never more - every example matched this exactly.
//   - Responsible-person name: keep character 1, mask character 2 with a
//     single "*", keep everything after unchanged. Verified against a wide
//     mix of Chinese names ("黃*杰") and Western names written in Chinese
//     legal documents ("A*bert Yuen", "S*even John McNaught") - the rule is
//     a plain string-index operation, not language-aware, and that's
//     exactly what made it reproduce correctly across scripts.
//   - Company name: the competitor's own sample was NOT consistent here -
//     some rows masked a 2-character prefix, others masked almost the
//     entire distinctive name, with no rule that reproduced every example.
//     Rather than guess at an inconsistent pattern, this file defines our
//     own simple, consistently-applied rule instead (see maskCompanyName).
//     It's deliberately less aggressive than hiding the whole name: the
//     underlying registry data is already legally public (PDPA Article
//     19(7), same basis as the rest of this product - see architecture.md),
//     so the goal here is a clean teaser, not a secrecy guarantee.

// Legal-entity suffixes checked longest-first so "股份有限公司" matches before
// the shorter "有限公司" would also match a substring of it.
const COMPANY_SUFFIXES = [
  "股份有限公司",
  "有限公司",
  "股份兩合公司",
  "兩合公司",
  "無限公司",
  "企業社",
  "工作室",
  "商行",
  "商號",
  "事務所",
  "合作社",
  "分公司",
].sort((a, b) => b.length - a.length);

export function maskUniformId(uniformId: string): string {
  const digits = uniformId.trim();
  if (!/^\d{8}$/.test(digits)) {
    // Not a well-formed 8-digit uniform ID (shouldn't happen for real
    // companies rows) - mask it entirely rather than risk leaking an
    // unexpected format unmasked.
    return "*".repeat(digits.length);
  }
  return "***" + digits.slice(3);
}

export function maskPersonName(name: string | null): string | null {
  if (!name) return name;
  const trimmed = name.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.length === 1) return trimmed[0] + "*";
  return trimmed[0] + "*" + trimmed.slice(2);
}

export function maskCompanyName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return trimmed;

  const suffix = COMPANY_SUFFIXES.find((s) => trimmed.endsWith(s));
  const core = suffix ? trimmed.slice(0, trimmed.length - suffix.length) : trimmed;

  if (core.length === 0) {
    // Name is literally just the legal suffix (shouldn't happen in
    // practice) - fall back to masking everything but the first character.
    return trimmed.length === 1 ? trimmed : trimmed[0] + "*".repeat(trimmed.length - 1);
  }

  const maskedCore = core.length === 1 ? "*" : core[0] + "*".repeat(core.length - 1);
  return maskedCore + (suffix ?? "");
}

// Narrow-result-set floor (2026-09-05, business-model change: free tier
// and anonymous visitors now see fully CURRENT data in both live search
// and email notifications - the 30-day freshness gate that used to
// stand alongside this masking was removed entirely. See
// architecture.md's 2026-09-05 "redaction is now the only free-tier
// gate" entry for the full reasoning.)
//
// The per-field masking above was designed and tuned while free tier
// was ALSO 30+ days stale, which was itself a form of protection: a
// masked, month-old row was low-value to bother deanonymizing. With
// data now current for every tier, that incidental protection is gone -
// a visitor who narrows region + industry + capital range + entity type
// down to one or two rows can often cross-reference the masked
// fragments (first character of the name, last 5 digits of the uniform
// ID, exact capital, exact registration date) against Taiwan's own
// public company registry lookup in a single query, since this data
// originates from that same public registry in the first place (see the
// top-of-file PDPA Article 19(7) note). That was a much smaller
// incentive when the row was a month old; it's a real one now that
// every row is today's or this week's.
//
// This isn't a defense against a determined, technical adversary - it's
// a floor against the easy, one-click version of that lookup, applied
// on top of (never instead of) the per-field masking above. Every call
// site that renders search results (app/(marketing)/search/page.tsx,
// app/(app)/searches/[id]/page.tsx, lib/email/digest.ts) checks
// isNarrowResultSet() against the count of rows a viewer's own filters
// actually returned (or, for the results-page/digest case, the total
// match count that filter combination has ever produced) and, only for
// non-paid viewers, additionally coarsens capital into a bracket and
// registration date into the week it fell in - the two fields precise
// enough, combined with an exact region+industry, to narrow a public
// registry search to one hit.
export const NARROW_RESULT_SET_THRESHOLD = 5;

export function isNarrowResultSet(resultCount: number): boolean {
  return resultCount > 0 && resultCount <= NARROW_RESULT_SET_THRESHOLD;
}

const CAPITAL_BRACKETS: { max: number; label: string }[] = [
  { max: 1_000_000, label: "100萬元以下" },
  { max: 5_000_000, label: "100萬–500萬元" },
  { max: 10_000_000, label: "500萬–1,000萬元" },
  { max: 50_000_000, label: "1,000萬–5,000萬元" },
  { max: Infinity, label: "5,000萬元以上" },
];

export function maskCapitalToBracket(capital: number | null): string {
  if (capital === null) return "-";
  const bracket = CAPITAL_BRACKETS.find((b) => capital <= b.max);
  return bracket ? bracket.label : "-";
}

// Coarsens a registration date down to the Monday of the week it falls
// in - e.g. any date from 2026/09/07 (Mon) through 2026/09/13 (Sun)
// reports as "2026/09/07 當週". Dates from Postgres `date` columns come
// through as midnight-UTC ISO strings, so this deliberately uses the
// UTC getters throughout rather than local-time getters, which would
// risk rolling a date into the wrong week depending on the server's
// timezone.
export function maskRegistrationDateToWeek(date: string | Date | null): string {
  if (!date) return "-";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "-";

  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7; // days since this date's most recent Monday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - diffToMonday);

  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${dd} 當週`;
}

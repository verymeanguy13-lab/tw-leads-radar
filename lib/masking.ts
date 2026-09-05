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

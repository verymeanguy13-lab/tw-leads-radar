import { ATTRIBUTION_AGENCY, ATTRIBUTION_NAME_ZH } from "./attribution";
import {
  maskUniformId,
  maskCompanyName,
  maskPersonName,
  maskCapitalToBracket,
  maskRegistrationDateToWeek,
} from "./masking";
import type { Company } from "../types/db";

// 2026-09-05 — extracted from app/api/searches/[id]/export/route.ts
// (Session 20's original CSV export, unchanged in behavior by this
// extraction) so the exact same column set, escaping, attribution-line
// format, and BOM handling can be reused by
// app/api/searches/[id]/digest-export/route.ts (new, added alongside
// this file - the per-notification CSV download link in digest emails).
// The two routes differ in WHICH rows they pass in and whether `mask`
// is set, not in how a CSV gets built from rows once decided - this is
// that shared "how."

const STATUS_LABEL: Record<string, string> = {
  active: "營運中",
  changed: "已異動",
  dissolved: "已解散",
  suspended: "停業中",
};

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface BuildCsvOptions {
  // 2026-09-05: when true, applies the same three-field masking used
  // everywhere else in this app for free-tier viewers (see
  // lib/masking.ts) - added so the new digest-export route can serve a
  // free-tier recipient's own digest CSV without leaking what their
  // email already didn't show them. The original authenticated export
  // route never sets this (canExportCsv() already gates free tier out
  // of that route entirely, so every row it ever passes in is destined
  // for a paid viewer) - default false preserves that route's exact
  // prior behavior unchanged.
  mask?: boolean;
  // 2026-09-05: coarsens capital/date the same way isNarrowResultSet()
  // does for free-tier email rows and results-page rows - only
  // meaningful when `mask` is also true (a paid viewer's CSV is never
  // narrowed, matching every other paid surface in this app).
  narrow?: boolean;
  // Freshness note lookup for dissolved/suspended rows, keyed by
  // source_dataset - same shape and purpose as the original export
  // route's datasetFreshness map.
  datasetFreshness?: Map<string, string>;
}

/**
 * Builds a complete CSV document (attribution comment lines + header +
 * data rows + leading BOM) from a set of Company rows, exactly matching
 * the format app/api/searches/[id]/export/route.ts has produced since
 * Session 20. Does not touch the network or the database - callers
 * fetch `matches` themselves (with whatever WHERE clause is right for
 * that call site) and pass them in.
 */
export function buildMatchesCsv(matches: Company[], options: BuildCsvOptions = {}): string {
  const { mask = false, narrow = false, datasetFreshness = new Map() } = options;

  const displayedDatasetIds = Array.from(
    new Set(matches.map((r) => r.source_dataset).filter((d): d is string => !!d))
  );
  const attributionLines = displayedDatasetIds
    .filter((dsId) => ATTRIBUTION_NAME_ZH[dsId])
    .map(
      (dsId) =>
        `# 提供機關／${ATTRIBUTION_AGENCY} ${new Date().getFullYear()} ${ATTRIBUTION_NAME_ZH[dsId]}，依政府資料開放授權條款進行公開徵集及加值利用`
    );

  const headerRow = [
    "統一編號",
    "類型",
    "名稱",
    "登記日期",
    "縣市",
    "鄉鎮市區",
    "地址",
    "負責人",
    "資本額",
    "狀態",
    "狀態資料更新於",
  ].join(",");

  const lines: string[] = [...attributionLines, headerRow];

  for (const row of matches) {
    const isDissolvedOrSuspended = row.status === "dissolved" || row.status === "suspended";
    const freshAt =
      isDissolvedOrSuspended && row.source_dataset
        ? datasetFreshness.get(row.source_dataset)
        : undefined;

    // Masked rows drop 鄉鎮市區/地址 entirely, same as every other
    // masked surface in this app (email rows, /search, the results
    // page) - the full address is dropped alongside the name/ID/person
    // fields it would otherwise help re-identify, not narrowed like
    // capital/date are.
    const displayName = mask ? maskCompanyName(row.name) : row.name;
    const displayUniformId = mask ? maskUniformId(row.uniform_id) : row.uniform_id;
    const displayPerson = mask ? maskPersonName(row.responsible_person) : row.responsible_person;
    // maskCapitalToBracket/maskRegistrationDateToWeek both return
    // already-final display strings (a bracket label, a "week of" date)
    // rather than raw values, so they're passed straight into the row -
    // csvEscape still runs over them below like every other field, in
    // case a bracket label ever needed comma/quote escaping.
    const displayCapital: string | number | null =
      mask && narrow ? maskCapitalToBracket(row.capital) : row.capital;
    const displayDate: string | null =
      mask && narrow ? maskRegistrationDateToWeek(row.registration_date) : row.registration_date;
    const displayDistrict = mask ? "" : row.address_district;
    const displayAddress = mask ? "" : row.address_raw;

    lines.push(
      [
        csvEscape(displayUniformId),
        csvEscape(row.entity_type),
        csvEscape(displayName),
        csvEscape(displayDate),
        csvEscape(row.address_region),
        csvEscape(displayDistrict),
        csvEscape(displayAddress),
        csvEscape(displayPerson),
        csvEscape(displayCapital),
        csvEscape(STATUS_LABEL[row.status] ?? row.status),
        csvEscape(freshAt ? new Date(freshAt).toISOString().slice(0, 10) : ""),
      ].join(",")
    );
  }

  // Leading BOM so Excel renders the Chinese text correctly on open -
  // unchanged from the original export route.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function safeCsvFilename(name: string): string {
  return (name || "export").replace(/[^a-zA-Z0-9-_]/g, "_");
}

import * as fs from "fs";
import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import { db } from "../db";
import { convertRocDate } from "../parsing/roc-date";

export interface NormalizedRow {
  uniform_id: string;
  entity_type: "company" | "business";
  name: string;
  industry_codes: string[];
  capital: number | null;
  address_raw: string | null;
  responsible_person: string | null;
  registration_date: string | null;
  event_date: string | null;
  source_dataset: string;
}

export interface ParseFailure {
  rawLine: string;
  reason: string;
}

export interface NormalizeResult {
  rows: NormalizedRow[];
  failures: ParseFailure[];
  encodingDetected: "utf-8" | "big5";
}

interface ColumnMap {
  uniformIdCol: string;
  nameCol: string;
  addressCol: string;
  personCol: string;
  capitalCol: string;
  dateCol: string;
  dateMeaning: "registration" | "event";
  entityType: "company" | "business";
}

const COLUMN_MAPS: Record<string, ColumnMap> = {
  company_new: { uniformIdCol: "\u7d71\u4e00\u7de8\u865f", nameCol: "\u516c\u53f8\u540d\u7a31", addressCol: "\u516c\u53f8\u6240\u5728\u5730", personCol: "\u4ee3\u8868\u4eba", capitalCol: "\u8cc7\u672c\u984d", dateCol: "\u6838\u51c6\u8a2d\u7acb\u65e5\u671f", dateMeaning: "registration", entityType: "company" },
  company_change: { uniformIdCol: "\u7d71\u4e00\u7de8\u865f", nameCol: "\u516c\u53f8\u540d\u7a31", addressCol: "\u516c\u53f8\u6240\u5728\u5730", personCol: "\u4ee3\u8868\u4eba", capitalCol: "\u8cc7\u672c\u984d", dateCol: "\u6838\u51c6\u8b8a\u66f4\u65e5\u671f", dateMeaning: "event", entityType: "company" },
  company_dissolve: { uniformIdCol: "\u7d71\u4e00\u7de8\u865f", nameCol: "\u516c\u53f8\u540d\u7a31", addressCol: "\u516c\u53f8\u6240\u5728\u5730", personCol: "\u4ee3\u8868\u4eba", capitalCol: "\u8cc7\u672c\u984d", dateCol: "\u6838\u51c6\u89e3\u6563\u65e5\u671f", dateMeaning: "event", entityType: "company" },
  business_new: { uniformIdCol: "\u7d71\u4e00\u7de8\u865f", nameCol: "\u5546\u696d\u540d\u7a31", addressCol: "\u5546\u696d\u6240\u5728\u5730", personCol: "\u8ca0\u8cac\u4eba", capitalCol: "\u8cc7\u672c\u984d", dateCol: "\u8a2d\u7acb\u65e5\u671f", dateMeaning: "registration", entityType: "business" },
  business_change: { uniformIdCol: "\u7d71\u4e00\u7de8\u865f", nameCol: "\u5546\u696d\u540d\u7a31", addressCol: "\u5546\u696d\u6240\u5728\u5730", personCol: "\u8ca0\u8cac\u4eba", capitalCol: "\u8cc7\u672c\u984d", dateCol: "\u8b8a\u66f4\u65e5\u671f", dateMeaning: "event", entityType: "business" },
  business_dissolve: { uniformIdCol: "\u7d71\u4e00\u7de8\u865f", nameCol: "\u5546\u696d\u540d\u7a31", addressCol: "\u5546\u696d\u6240\u5728\u5730", personCol: "\u8ca0\u8cac\u4eba", capitalCol: "\u8cc7\u672c\u984d", dateCol: "\u8b8a\u66f4\u65e5\u671f", dateMeaning: "event", entityType: "business" },
};

function detectEncoding(buffer: Buffer): "utf-8" | "big5" {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return "utf-8";
  } catch {
    return "big5";
  }
}

function decodeBuffer(buffer: Buffer, encoding: "utf-8" | "big5"): string {
  if (encoding === "utf-8") {
    const text = buffer.toString("utf-8");
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }
  return iconv.decode(buffer, "big5");
}

function parseCapital(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return isNaN(n) ? null : n;
}

export async function normalizeFile(
  filePath: string,
  datasetId: string,
  ingestionRunId: string
): Promise<NormalizeResult> {
  const colMap = COLUMN_MAPS[datasetId];
  if (!colMap) {
    throw new Error(`normalize.ts: no column mapping defined for dataset "${datasetId}"`);
  }

  const buffer = fs.readFileSync(filePath);
  const encodingDetected = detectEncoding(buffer);
  const text = decodeBuffer(buffer, encodingDetected);

  const records: Record<string, string>[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  if (records.length > 0) {
    const actualCols = new Set(Object.keys(records[0]));
    const expectedCols = [colMap.uniformIdCol, colMap.nameCol, colMap.addressCol, colMap.personCol, colMap.capitalCol, colMap.dateCol];
    const missing = expectedCols.filter((col) => !actualCols.has(col));
    if (missing.length > 0) {
      throw new Error(
        `normalize.ts: dataset "${datasetId}" is missing expected column(s): ${missing.join(", ")}. Actual columns: ${Array.from(actualCols).join(", ")}`
      );
    }
  }

  const rows: NormalizedRow[] = [];
  const failures: ParseFailure[] = [];

  for (const record of records) {
    const rawLine = JSON.stringify(record);
    const uniformId = (record[colMap.uniformIdCol] || "").trim();

    if (!/^\d{8}$/.test(uniformId)) {
      failures.push({ rawLine, reason: `Invalid or missing uniform_id: "${uniformId}"` });
      continue;
    }

    const name = (record[colMap.nameCol] || "").trim();
    if (!name) {
      failures.push({ rawLine, reason: "Missing name" });
      continue;
    }

    const dateRaw = record[colMap.dateCol] || "";
    const parsedDate = convertRocDate(dateRaw);
    if (dateRaw.trim() && !parsedDate) {
      failures.push({ rawLine, reason: `Unparseable ROC date: "${dateRaw}"` });
    }

    rows.push({
      uniform_id: uniformId,
      entity_type: colMap.entityType,
      name,
      industry_codes: [],
      capital: parseCapital(record[colMap.capitalCol] || ""),
      address_raw: (record[colMap.addressCol] || "").trim() || null,
      responsible_person: (record[colMap.personCol] || "").trim() || null,
      registration_date: colMap.dateMeaning === "registration" ? parsedDate : null,
      event_date: colMap.dateMeaning === "event" ? parsedDate : null,
      source_dataset: datasetId,
    });
  }

  const sql = db();
  const failureLog = failures.length > 0
    ? JSON.stringify(failures.slice(0, 100)) + (failures.length > 100 ? ` ...and ${failures.length - 100} more` : "")
    : null;

  await sql`
    UPDATE ingestion_runs
    SET encoding_detected = ${encodingDetected}, parse_failures = ${failures.length}, row_count = ${records.length}, error_log = ${failureLog}
    WHERE id = ${ingestionRunId}
  `;

  return { rows, failures, encodingDetected };
}
import { db } from "../db";
import { parseAddress } from "../parsing/address";
import type { NormalizedRow } from "./normalize";

export interface UpsertSummary {
  inserted: number;
  updated: number;
  statusChanges: number;
}

interface PreparedRow {
  uniform_id: string;
  entity_type: string;
  name: string;
  industry_codes: string[];
  capital: number | null;
  address_raw: string | null;
  address_region: string | null;
  address_district: string | null;
  responsible_person: string | null;
  registration_date: string | null;
  status: "active" | "changed" | "dissolved";
  status_updated_at: string | null;
  source_dataset: string;
  source_month: string;
}

function statusForDataset(datasetId: string): "active" | "changed" | "dissolved" {
  if (datasetId.endsWith("_dissolve")) return "dissolved";
  if (datasetId.endsWith("_change")) return "changed";
  return "active";
}

const CHUNK_SIZE = 500;

export async function upsertRows(
  rows: NormalizedRow[],
  sourceMonth: string
): Promise<UpsertSummary> {
  const sql = db();
  let inserted = 0;
  let updated = 0;
  let statusChanges = 0;

  const dedupedMap = new Map<string, NormalizedRow>();
  for (const row of rows) {
    dedupedMap.set(row.uniform_id, row);
  }
  const deduped = Array.from(dedupedMap.values());

  const prepared: PreparedRow[] = deduped.map((row) => {
    const { region, district } = parseAddress(row.address_raw || "");
    const status = statusForDataset(row.source_dataset);
    return {
      uniform_id: row.uniform_id,
      entity_type: row.entity_type,
      name: row.name,
      industry_codes: row.industry_codes,
      capital: row.capital,
      address_raw: row.address_raw,
      address_region: region,
      address_district: district,
      responsible_person: row.responsible_person,
      registration_date: row.registration_date,
      status,
      status_updated_at: status !== "active" ? new Date().toISOString() : null,
      source_dataset: row.source_dataset,
      source_month: sourceMonth,
    };
  });

  for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
    const chunk = prepared.slice(i, i + CHUNK_SIZE);
    const uniformIds = chunk.map((r) => r.uniform_id);

    const existingRows = await sql`
      SELECT uniform_id, status FROM companies WHERE uniform_id = ANY(${uniformIds})
    `;
    const existingMap = new Map(existingRows.map((r: any) => [r.uniform_id, r.status]));

    const batchJson = JSON.stringify(chunk);

    await sql`
      INSERT INTO companies (
        uniform_id, entity_type, name, industry_codes, capital,
        address_raw, address_region, address_district, responsible_person,
        registration_date, status, status_updated_at, source_dataset, source_month
      )
      SELECT
        uniform_id, entity_type, name, industry_codes, capital,
        address_raw, address_region, address_district, responsible_person,
        registration_date::date, status, status_updated_at::timestamptz,
        source_dataset, source_month
      FROM jsonb_to_recordset(${batchJson}::jsonb) AS x(
        uniform_id varchar(8),
        entity_type varchar(20),
        name text,
        industry_codes text[],
        capital numeric,
        address_raw text,
        address_region text,
        address_district text,
        responsible_person text,
        registration_date text,
        status varchar(20),
        status_updated_at text,
        source_dataset text,
        source_month text
      )
      ON CONFLICT (uniform_id) DO UPDATE SET
        entity_type = EXCLUDED.entity_type,
        name = EXCLUDED.name,
        industry_codes = EXCLUDED.industry_codes,
        capital = EXCLUDED.capital,
        address_raw = EXCLUDED.address_raw,
        address_region = EXCLUDED.address_region,
        address_district = EXCLUDED.address_district,
        responsible_person = EXCLUDED.responsible_person,
        registration_date = COALESCE(companies.registration_date, EXCLUDED.registration_date),
        status = EXCLUDED.status,
        status_updated_at = CASE
          WHEN EXCLUDED.status <> companies.status THEN now()
          ELSE companies.status_updated_at
        END,
        source_dataset = EXCLUDED.source_dataset,
        source_month = EXCLUDED.source_month,
        updated_at = now()
    `;

    for (const row of chunk) {
      const prior = existingMap.get(row.uniform_id);
      if (prior === undefined) {
        inserted++;
      } else {
        updated++;
        if (prior !== row.status) statusChanges++;
      }
    }
  }

  return { inserted, updated, statusChanges };
}
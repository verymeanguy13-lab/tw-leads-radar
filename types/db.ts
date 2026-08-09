export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
  tier: "free" | "pro" | "business";
  status: "active" | "past_due" | "canceled" | "none";
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface Company {
  uniform_id: string;
  entity_type: "company" | "business";
  name: string;
  industry_codes: string[];
  capital: number | null;
  address_raw: string | null;
  address_region: string | null;
  address_district: string | null;
  responsible_person: string | null;
  registration_date: string | null;
  status: "active" | "changed" | "dissolved" | "suspended";
  status_updated_at: string | null;
  source_dataset: string | null;
  source_month: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedSearch {
  id: string;
  user_id: string;
  name: string;
  industry_codes: string[];
  regions: string[];
  capital_min: number | null;
  capital_max: number | null;
  entity_type: "company" | "business" | "both";
  keyword: string | null;
  cadence: "weekly" | "monthly";
  paused: boolean;
  created_at: string;
  updated_at: string;
}

export interface SearchMatch {
  id: string;
  saved_search_id: string;
  company_uniform_id: string;
  matched_at: string;
  surfaced_in_digest: boolean;
  surfaced_at: string | null;
}

export interface IngestionRun {
  id: string;
  dataset_name: string;
  source_month: string | null;
  row_count: number | null;
  new_count: number | null;
  updated_count: number | null;
  parse_failures: number;
  encoding_detected: string | null;
  status: "running" | "success" | "failed" | "partial";
  error_log: string | null;
  started_at: string;
  completed_at: string | null;
}
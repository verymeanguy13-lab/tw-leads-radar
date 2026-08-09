import type { SavedSearch, Company, IngestionRun } from "./db";

export interface SavedSearchResult {
  search: SavedSearch;
  matches: Company[];
  totalMatches: number;
}

export interface IngestionSummary {
  runs: IngestionRun[];
  lastSuccessfulRun: string | null;
}
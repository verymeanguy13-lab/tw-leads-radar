import type { DatasetSource } from "./sources.config";

export interface MonitorCheckInput {
  source: DatasetSource;
  discoveredMonth: string;
  lastKnownGoodMonth: string | null;
  lastKnownGoodAt: Date | null;
  rowCount: number;
  typicalRowCount: number | null;
}

export type MonitorResult =
  | { outcome: "ok" }
  | { outcome: "no_new_data"; reason: string }
  | { outcome: "flagged"; reason: string };

export function runMonitorChecks(input: MonitorCheckInput): MonitorResult {
  const { source, discoveredMonth, lastKnownGoodMonth, lastKnownGoodAt, rowCount, typicalRowCount } = input;

  if (lastKnownGoodMonth && discoveredMonth <= lastKnownGoodMonth) {
    const daysSinceLastGood = lastKnownGoodAt
      ? (Date.now() - lastKnownGoodAt.getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;

    if (daysSinceLastGood <= source.expectedCadenceDays) {
      return {
        outcome: "no_new_data",
        reason: `${source.nameZh}: still on ${lastKnownGoodMonth}, within expected ${source.expectedCadenceDays}-day cadence - government likely has not published yet.`,
      };
    }
    return {
      outcome: "flagged",
      reason: `${source.nameZh}: discovered month (${discoveredMonth}) has not advanced past ${lastKnownGoodMonth} for ${Math.round(daysSinceLastGood)} days, exceeding the expected ${source.expectedCadenceDays}-day cadence. Scraper may be reading a stale/wrong element - needs human review.`,
    };
  }

  if (typicalRowCount !== null && typicalRowCount > 0) {
    const ratio = rowCount / typicalRowCount;
    if (ratio < 0.1 || ratio > 10) {
      return {
        outcome: "flagged",
        reason: `${source.nameZh}: row_count ${rowCount} is drastically different from typical ${typicalRowCount} (ratio ${ratio.toFixed(2)}) - likely a parsing or encoding break.`,
      };
    }
  }

  return { outcome: "ok" };
}
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCapital(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return `NT$${n.toLocaleString("zh-TW")}`;
}

// 2026-09-03: explicit timeZone added - without it, toLocaleDateString
// renders in whatever timezone the server process itself runs in
// (Vercel's serverless functions run in UTC), not the user's. This
// product is Taiwan-only, so every date shown to a user should read in
// Taipei time regardless of where the code executes. Concretely: an
// ingestion run completing at 2026-09-03 07:50 Taipei time is
// 2026-09-02 23:50 UTC - before this fix, the "資料更新日期" line on the
// results page would show September 2nd for data that actually
// finished updating on the 3rd, which reads as the site being a full
// day more stale than it really is.
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return date.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Taipei",
  });
}
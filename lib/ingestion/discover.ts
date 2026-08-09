import * as cheerio from "cheerio";

export interface DiscoveredFile {
  url: string;
  monthLabel: string;
}

export async function discoverLatestFile(pageUrl: string): Promise<DiscoveredFile> {
  const res = await fetch(pageUrl);
  if (!res.ok) {
    throw new Error(`discover.ts: failed to fetch ${pageUrl} (status ${res.status})`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const found: DiscoveredFile[] = [];
  const monthPattern = /(\d{4})\u5e74(\d{2})\u6708/;

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || !href.includes("oid=")) return;

    const rowText = $(el).closest("tr, li, div").text();
    const match = rowText.match(monthPattern);
    if (!match) return;

    found.push({ url: href, monthLabel: `${match[1]}\u5e74${match[2]}\u6708` });
  });

  if (found.length === 0) {
    throw new Error(`discover.ts: no CSV links found on ${pageUrl} - page structure may have changed`);
  }

  found.sort((a, b) => a.monthLabel.localeCompare(b.monthLabel));
  return found[found.length - 1];
}
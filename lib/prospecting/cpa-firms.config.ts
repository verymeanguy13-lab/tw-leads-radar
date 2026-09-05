// Session 26 seed list - curated (not scraped from a public roster;
// there is no single authoritative directory of "CPA firms that
// specialize in SME/startups"), per blueprint Section 4.4. Each firm's
// own official site is fetched live at scrape time
// (scripts/scrape-cpa-firms.ts) rather than hardcoding contact values
// here - this config only records WHERE to look (the firm's real
// contact page, confirmed reachable 2026-09-05) and WHICH branches to
// look for, since branch existence itself can't be auto-discovered
// generically from a firm's own site.
//
// 和繼會計師事務所 (the fourth firm named in the original blueprint seed
// list) is deliberately NOT included here - a 2026-09-05 search could
// not find any official site or live listing under that exact name
// (only similarly-named but distinct firms turned up: 和眾, 和業, 和泰,
// 和榮, 致和). Rather than guess which of those it meant, this firm is
// excluded until the exact name is confirmed - see architecture.md.

export interface CpaFirmBranch {
  // Chinese label as it's expected to appear on the firm's own contact
  // page, used to locate that branch's section of text for extraction.
  label: string;
  region: string;
}

export interface CpaFirmSource {
  firmName: string;
  seedSource: string;
  contactPageUrl: string;
  branches: CpaFirmBranch[];
}

export const CPA_FIRMS: CpaFirmSource[] = [
  {
    firmName: "嘉威聯合會計師事務所",
    seedSource: "third-party accounting-firm ranking blog (blueprint Section 4.4 seed list)",
    contactPageUrl: "https://www.jwcpas.com.tw/contact2.php",
    // Site publishes 5 branches plus the head office as of 2026-09-05 -
    // more than the "分所：桃園、台中、嘉義" the original seed description
    // mentioned. Recording what the firm's own site actually publishes,
    // per Session 26 Step 1 ("pull only what the firm itself publishes").
    branches: [
      { label: "總所", region: "新北市" },
      { label: "台北分所", region: "台北市" },
      { label: "桃園分所", region: "桃園市" },
      { label: "台中分所", region: "台中市" },
      { label: "彰化分所", region: "彰化縣" },
      { label: "嘉義分所", region: "嘉義市" },
    ],
  },
  {
    firmName: "十方廣華聯合會計師事務所",
    seedSource: "third-party accounting-firm ranking blog (blueprint Section 4.4 seed list)",
    contactPageUrl: "https://macrocpa.com.tw/聯絡我們/",
    branches: [
      { label: "總所", region: "台北市" },
      { label: "松江分所", region: "台北市" },
      { label: "桃園分所", region: "桃園市" },
    ],
  },
  {
    firmName: "精訊聯合會計師事務所",
    seedSource: "third-party accounting-firm ranking blog (blueprint Section 4.4 seed list)",
    contactPageUrl: "https://www.cpafirm.com.tw/about/introduction",
    branches: [
      { label: "台北", region: "台北市" },
      { label: "桃園", region: "桃園市" },
      { label: "台中", region: "台中市" },
      { label: "雲林", region: "雲林縣" },
      { label: "台南", region: "台南市" },
    ],
  },
];

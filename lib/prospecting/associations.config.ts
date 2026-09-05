// Session 25 data source config - one entry per regional 記帳士公會
// (bookkeeper association) from blueprint Section 4.3, plus the seven
// associations that Section 4.3 originally listed as "not confirmed
// reachable" (彰化, 南投, 雲林, 嘉義, 台南, 基隆, 宜蘭). Those seven were
// re-researched on 2026-09-05: two now have a confirmed live official
// site (彰化, 台南), one has a site but only for the city chapter, not a
// county one (嘉義), and three still have no real official site
// (南投's domain redirects to what looks like a hijacked/parked page;
// 雲林's listed site actually belongs to 嘉義 - a copy-paste error in the
// federation's own directory; 宜蘭 has nothing findable at all). For
// those three, `federationFallback` provides a phone-only fallback
// sourced from the national federation's own published chapter
// directory, so scrape-bookkeepers.ts has something real and traceable
// to insert instead of just skipping the region.
//
// `region` values are written to match companies.address_region so
// this table stays joinable/filterable the same way as the rest of the
// schema, per Session 25 Step 4.

export interface AssociationSource {
  region: string;
  name: string;
  url?: string;
  hasMemberDirectory: boolean;
  // True only for a site confirmed to be dead/hijacked/unrelated -
  // don't even attempt to fetch it, go straight to federationFallback.
  knownUnreachable?: boolean;
  federationFallback?: { phone?: string; fax?: string };
}

export const NATIONAL_FEDERATION = {
  region: "全國",
  name: "中華民國記帳士公會全國聯合會",
  url: "https://www.cpb.org.tw/",
  directoryUrl: "https://www.cpb.org.tw/本會簡介/全國縣(市)地方公會資訊",
  phone: "02-2391-3123",
  email: "roc.cpbtw@msa.hinet.net",
};

export const BOOKKEEPER_ASSOCIATIONS: AssociationSource[] = [
  {
    region: "台北市",
    name: "社團法人臺北市記帳士公會",
    url: "https://www.taipeicpb.org.tw/users/",
    hasMemberDirectory: true,
  },
  { region: "新北市", name: "社團法人新北市記帳士公會", url: "https://ntpcpb.org.tw/", hasMemberDirectory: false },
  { region: "桃園市", name: "社團法人桃園市記帳士公會", url: "https://www.acctaou.com.tw/", hasMemberDirectory: false },
  { region: "台中市", name: "社團法人台中市記帳士公會", url: "https://www.tccpb.org.tw/", hasMemberDirectory: false },
  {
    region: "台中市",
    name: "臺中市山海屯記帳及報稅代理人公會",
    url: "https://www.tchacc.org.tw/",
    hasMemberDirectory: false,
  },
  { region: "高雄市", name: "社團法人高雄市記帳士公會", url: "https://www.kscpb.org.tw/", hasMemberDirectory: false },
  { region: "花蓮縣", name: "社團法人花蓮縣記帳士公會", url: "https://www.hlcpb.org.tw/", hasMemberDirectory: false },
  { region: "新竹市", name: "社團法人新竹市記帳士公會", url: "https://www.hccpb.org.tw/", hasMemberDirectory: false },
  {
    region: "新竹縣",
    name: "社團法人新竹縣記帳士公會",
    url: "https://sites.google.com/a/hsinchucpb.org.tw/www/",
    hasMemberDirectory: false,
  },
  // Re-researched 2026-09-05, now resolved with a real confirmed site:
  { region: "彰化縣", name: "彰化縣記帳士公會", url: "https://www.cpta.org.tw/", hasMemberDirectory: false },
  { region: "台南市", name: "台南市記帳士公會", url: "https://www.tncpb.org.tw/", hasMemberDirectory: false },
  // 嘉義: only the city chapter has a findable site (stale, ~2015
  // content, but still live); no separate county-level 嘉義縣 association
  // or site was found at all.
  {
    region: "嘉義市",
    name: "嘉義市記帳士公會",
    url: "http://www.cycpb.org.tw/",
    hasMemberDirectory: false,
    federationFallback: { phone: "05-216-8555" },
  },
  // Still no real site as of 2026-09-05 - federation-directory fallback only.
  {
    region: "南投縣",
    name: "南投縣記帳士公會",
    url: "https://nantoucpb.org.tw/",
    hasMemberDirectory: false,
    knownUnreachable: true, // redirects to a suspicious/parked domain - do not fetch
    federationFallback: { phone: "049-224-0238", fax: "049-223-5523" },
  },
  {
    region: "雲林縣",
    name: "雲林縣記帳士公會",
    hasMemberDirectory: false,
    // No `url`: the federation directory's listed site for 雲林 is
    // actually 嘉義市's real site (a copy-paste error upstream, confirmed
    // 2026-09-05) - not fetched here to avoid attributing 嘉義 content to 雲林.
    federationFallback: { phone: "05-534-5490", fax: "05-532-1763" },
  },
  {
    region: "基隆市",
    name: "基隆市記帳士公會",
    url: "https://keelungcpb.org.tw/h/Index?key=u5ntx",
    hasMemberDirectory: false,
    federationFallback: { phone: "02-2465-7382" },
  },
  {
    region: "宜蘭縣",
    name: "宜蘭縣記帳士公會",
    hasMemberDirectory: false,
    // No `url` at all - nothing findable as of 2026-09-05.
    federationFallback: { phone: "03-936-8686", fax: "03-935-7440" },
  },
];

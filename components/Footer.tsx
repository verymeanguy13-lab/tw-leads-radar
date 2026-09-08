import Link from "next/link";
import DataAttribution from "./DataAttribution";

const CURRENT_YEAR = new Date().getFullYear().toString();
const AGENCY = "\u7d93\u6fdf\u90e8\u5546\u696d\u767c\u5c55\u7f72";

const ALL_SIX_DATASETS = [
  { agency: AGENCY, name: "\u516c\u53f8\u8a2d\u7acb\u767b\u8a18\u6e05\u518a", year: CURRENT_YEAR },
  { agency: AGENCY, name: "\u516c\u53f8\u8b8a\u66f4\u767b\u8a18\u6e05\u518a", year: CURRENT_YEAR },
  { agency: AGENCY, name: "\u516c\u53f8\u89e3\u6563\u767b\u8a18\u6e05\u518a", year: CURRENT_YEAR },
  { agency: AGENCY, name: "\u5546\u696d\u8a2d\u7acb\u767b\u8a18\u6e05\u518a", year: CURRENT_YEAR },
  { agency: AGENCY, name: "\u5546\u696d\u8b8a\u66f4\u767b\u8a18\u6e05\u518a", year: CURRENT_YEAR },
  { agency: AGENCY, name: "\u5546\u696d\u6b47\u696d\u767b\u8a18\u6e05\u518a", year: CURRENT_YEAR },
];

export default function Footer() {
  return (
    <footer className="border-t border-default mt-auto py-6 px-8">
      <DataAttribution datasets={ALL_SIX_DATASETS} />
      <p className="text-xs text-secondary mt-3 flex gap-4">
        <Link href="/privacy" className="underline">
          隱私權政策
        </Link>
        <Link href="/terms" className="underline">
          服務條款
        </Link>
        <Link href="/data-removal" className="underline">
          資料移除請求
        </Link>
      </p>
      {/* 2026-09-08: added on explicit user request ("copyright of content
          on this website belongs to me"). Deliberately scoped to this
          site's own compiled content/software/design, NOT the underlying
          government open data above (which stays under its own 政府資料
          開放授權條款 regardless of anything claimed here) - the
          parenthetical exists specifically to avoid the notice reading as
          an overclaim over public-sector data this site doesn't own.
          Uses the site's own brand name rather than a personal legal name
          or an incorporated entity (neither exists yet - see
          architecture.md's "not incorporated" legal backlog item), on the
          reasoning that a copyright notice needs no registered or legal
          name to be valid under Taiwan's Copyright Act / the Berne
          Convention - it's a deterrent signal, not a filing - and this is
          the same brand name already registered with NewebPay. CURRENT_YEAR
          reuses the constant already defined above for DataAttribution, so
          this never drifts out of sync with it. */}
      <p className="text-xs text-secondary mt-3">
        {`© ${CURRENT_YEAR} 新公司快報. 版權所有，保留一切權利。（本站所使用之政府開放資料仍依原授權條款規範，不在此聲明範圍內。）`}
      </p>
    </footer>
  );
}
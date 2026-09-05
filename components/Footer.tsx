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
    </footer>
  );
}
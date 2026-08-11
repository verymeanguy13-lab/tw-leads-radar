import Link from "next/link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-full">
      <nav className="border-b border-default px-8 py-4 flex justify-between items-center">
        <Link href="/" className="font-bold text-lg">
          {"\u65b0\u516c\u53f8\u5feb\u5831"}
        </Link>
        <div className="flex gap-6 items-center text-sm">
          <Link href="/pricing">{"\u5b9a\u50f9"}</Link>
          <Link href="/login" className="bg-[var(--accent)] text-white rounded px-4 py-2">
            {"\u767b\u5165"}
          </Link>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
      <div className="border-t border-default px-8 py-4 flex gap-6 text-xs text-secondary">
        <Link href="/privacy">{"\u96b1\u79c1\u6b0a\u653f\u7b56"}</Link>
        <Link href="/terms">{"\u670d\u52d9\u689d\u6b3e"}</Link>
      </div>
    </div>
  );
}
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="px-8 py-24 max-w-md mx-auto text-center">
      <h1 className="text-3xl font-bold mb-3">找不到頁面</h1>
      <p className="text-secondary mb-8">
        您要找的頁面不存在，或已經被移動。
      </p>
      <Link
        href="/"
        className="inline-block bg-[var(--accent)] text-white rounded px-6 py-2 font-medium"
      >
        回首頁
      </Link>
    </div>
  );
}

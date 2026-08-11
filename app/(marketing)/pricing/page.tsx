import Link from "next/link";

export default function PricingPage() {
  return (
    <div className="px-8 py-16 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-10 text-center">{"\u5b9a\u50f9"}</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="border border-default rounded-lg p-6">
          <h2 className="font-semibold text-lg mb-1">{"\u514d\u8cbb\u7248"}</h2>
          <p className="text-2xl font-bold mb-4">NT$0</p>
          <ul className="text-sm space-y-2 mb-6">
            <li>{"\u2713 1\u7d44\u5132\u5b58\u641c\u5c0b\u689d\u4ef6"}</li>
            <li>{"\u2713 \u7ad9\u5167\u700f\u89bd\u6240\u6709\u7b26\u5408\u689d\u4ef6\u540d\u55ae"}</li>
            <li>{"\u2713 \u6bcf\u6708\u96fb\u5b50\u90f5\u4ef6\u6458\u8981\u901a\u77e5"}</li>
            <li className="text-secondary">{"\u2717 \u4e0d\u652f\u63f4CSV\u532f\u51fa"}</li>
          </ul>
          <Link
            href="/login"
            className="block text-center border border-default rounded px-4 py-2"
          >
            {"\u958b\u59cb\u4f7f\u7528"}
          </Link>
        </div>

        <div className="border border-default rounded-lg p-6 bg-card">
          <h2 className="font-semibold text-lg mb-1">{"\u4ed8\u8cbb\u7248"}</h2>
          <p className="text-2xl font-bold mb-1">NT$700 {"/ \u6708"}</p>
          <p className="text-sm text-secondary mb-4">
            {"\u6216\u5e74\u7e73 NT$7,000\uff0c\u76f8\u7576\u65bc\u514d2\u500b\u6708\u8cbb\u7528\uff08\u7d0417%\uff09"}
          </p>
          <ul className="text-sm space-y-2 mb-6">
            <li>{"\u2713 \u591a\u7d44\u5132\u5b58\u641c\u5c0b\u689d\u4ef6"}</li>
            <li>{"\u2713 CSV\u532f\u51fa"}</li>
            <li>
              {"\u2713 \u6bcf\u9031\u96fb\u5b50\u90f5\u4ef6\u6458\u8981\uff08\u6bd4\u514d\u8cbb\u7248\u66f4\u5feb\u5f97\u77e5\u65b0\u540d\u55ae\uff0c\u8cc7\u6599\u4ecd\u70ba\u6bcf\u6708\u66f4\u65b0\uff0c\u4f46\u901a\u77e5\u9593\u9694\u7e2e\u77ed\uff09"}
            </li>
          </ul>
          <Link
            href="/login"
            className="block text-center bg-[var(--accent)] text-white rounded px-4 py-2"
          >
            {"\u958b\u59cb\u4f7f\u7528"}
          </Link>
        </div>
      </div>

      <p className="text-xs text-secondary text-center mt-10 max-w-lg mx-auto">
        {"\u8aaa\u660e\uff1a\u653f\u5e9c\u767b\u8a18\u8cc7\u6599\u672c\u8eab\u6bcf\u6708\u66f4\u65b0\u4e00\u6b21\uff0c\u4e26\u975e\u66f4\u983b\u7e41\u3002\u4ed8\u8cbb\u7248\u7684\u6bcf\u9031\u901a\u77e5\u6307\u7684\u662f\u66f4\u5feb\u53d6\u5f97\u540c\u4e00\u6279\u8cc7\u6599\u7684\u901a\u77e5\uff0c\u4e0d\u662f\u66f4\u65b0\u983b\u7387\u672c\u8eab\u52a0\u5feb\u3002"}
      </p>
    </div>
  );
}
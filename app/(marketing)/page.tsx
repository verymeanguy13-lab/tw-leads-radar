import Link from "next/link";

export default function LandingPage() {
  return (
    <div>
      <section className="px-8 py-20 max-w-3xl mx-auto text-center">
        <h1 className="text-3xl font-bold mb-4">
          {"\u6436\u5148\u638c\u63e1\u65b0\u6210\u7acb\u516c\u53f8\uff0c\u6bd4\u7af6\u722d\u5c0d\u624b\u66f4\u65e9\u63a5\u89f8\u6f5b\u5728\u5ba2\u6236"}
        </h1>
        <p className="text-secondary text-lg mb-8">
          {"\u4f9d\u7522\u696d\u5225\u3001\u5730\u5340\u3001\u8cc7\u672c\u984d\u7be9\u9078\u65b0\u8a2d\u7acb\u516c\u53f8\uff0c\u4f9d\u65b9\u6848\u4e0d\u540c\uff0c\u6700\u5feb\u53ef\u638c\u63e1\u524d\u4e00\u65e5\u6700\u65b0\u8cc7\u6599\u3002"}
        </p>
        <Link
          href="/signup"
          className="inline-block bg-[var(--accent)] text-white rounded px-8 py-3 font-semibold"
        >
          {"\u514d\u8cbb\u958b\u59cb\u4f7f\u7528"}
        </Link>
        <p className="text-xs text-secondary mt-4">
          {"\u8cc7\u6599\u65b0\u9bae\u5ea6\u4f9d\u65b9\u6848\u800c\u5b9a\uff0c\u8a73\u898b\u5b9a\u50f9\u3002"}
        </p>
      </section>

      <section className="px-8 py-16 bg-card">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h3 className="font-semibold mb-2">{"\u7cbe\u6e96\u7be9\u9078"}</h3>
            <p className="text-secondary text-sm">
              {"\u4f9d\u7522\u696d\u5225\u3001\u7e23\u5e02\u3001\u8cc7\u672c\u984d\u7bc4\u570d\u81ea\u8a02\u689d\u4ef6\uff0c\u53ea\u770b\u4f60\u771f\u6b63\u5728\u610f\u7684\u540d\u55ae\u3002"}
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">{"\u81ea\u52d5\u96fb\u5b50\u90f5\u4ef6\u901a\u77e5"}</h3>
            <p className="text-secondary text-sm">
              {"\u65b0\u516c\u53f8\u767b\u8a18\u5f8c\uff0c\u4f9d\u65b9\u6848\u9031\u671f\u4e3b\u52d5\u901a\u77e5\uff0c\u4e0d\u5fc5\u81ea\u5df1\u52d5\u624b\u67e5\u8a62\u3002"}
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">{"\u5feb\u901f\u5730\u5716\u67e5\u8a62"}</h3>
            <p className="text-secondary text-sm">
              {"\u6bcf\u7b46\u540d\u55ae\u9644\u4e0a\u4e00\u9375Google\u5730\u5716\u641c\u5c0b\u9023\u7d50\uff0c\u5354\u52a9\u4f60\u5feb\u901f\u67e5\u627e\u806f\u7d61\u65b9\u5f0f\uff08\u662f\u5426\u627e\u5f97\u5230\u8996\u8a72\u516c\u53f8\u662f\u5426\u5df2\u5efa\u7acbGoogle\u5546\u5bb6\u6a94\u6848\u800c\u5b9a\uff0c\u4e0d\u4fdd\u8b49\u6bcf\u7b46\u90fd\u6709\uff09\u3002"}
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">{"\u53d6\u4ee3\u4eba\u5de5\u641c\u5c0b"}</h3>
            <p className="text-secondary text-sm">
              {"\u4e0d\u7528\u518d\u4e00\u9593\u4e00\u9593\u624b\u52d5\u67e5\u8a62\u516c\u53f8\u767b\u8a18\u7db2\u7ad9\uff0c\u7cfb\u7d71\u81ea\u52d5\u6574\u7406\u6210\u6e05\u55ae\u3002"}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
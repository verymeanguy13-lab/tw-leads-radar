import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "隱私權政策",
};

export default function PrivacyPage() {
  return (
    <div className="px-8 py-16 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">隱私權政策</h1>
      <p className="text-secondary">
        本頁面尚待完成。正式法律文件將另行撰寫與發佈。
      </p>
    </div>
  );
}

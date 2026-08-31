import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "資料移除請求",
};

export default function DataRemovalLayout({ children }: { children: React.ReactNode }) {
  return children;
}

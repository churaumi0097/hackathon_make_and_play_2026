import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anti-shortcut | あえて、寄り道を。",
  description: "気分と時間から、いつもの最短ルートとは違う寄り道を提案するナビゲーション。",
};

export const viewport: Viewport = {
  themeColor: "#f2f0e8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anti-ShortCut ｜ 人類のための遠回りマップ",
  description:
    "AIの最短ルートを拒否し、今の感情に寄り添う“意味のある遠回り”を提案するアンチ・ナビゲーション。",
};

export const viewport: Viewport = {
  themeColor: "#14100d",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import "./simmusic.css";

export const metadata: Metadata = {
  title: "SimMusic",
  description: "Simmc Livehouse 排班与乐曲收录。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}

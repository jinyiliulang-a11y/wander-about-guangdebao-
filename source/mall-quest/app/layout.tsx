import type { Metadata, Viewport } from "next";
import { historyInterceptorBootstrap } from "@/lib/history-interceptor";
import { PROJECT_EDITION } from "@/lib/project-edition";
import "./globals.css";
import "./treasure.css";
import "./feature-upgrade.css";
import "./experience.css";
import "./client-look.css";
import "./client-cards.css";
import "./reference-client.css";
import "./reference-adapter.css";
import "../components/reference-creator.css";
import "../components/reference-records.css";
import "../components/reference-level.css";
import "./reference-workspace.css";
import "./responsive.css";
import "./scrollbars.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  title: PROJECT_EDITION === "full" ? "逛道宝 · 商场寻宝" : PROJECT_EDITION === "client" ? "逛道宝 · 客户端" : PROJECT_EDITION === "merchant" ? "逛道宝 · 商家端" : "逛道宝 · 运维端（运营后台）",
  description: "跟随线索发现特色小店，创作自己的宝藏故事。",
  other: {
    "codex-preview": "development",
  },
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
      <head><script id="mall-quest-history-interceptor" dangerouslySetInnerHTML={{ __html: historyInterceptorBootstrap }} /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/components/query-provider";

export const metadata: Metadata = {
  title: "AgentForge Adversarial AI Security",
  description: "Multi-agent adversarial evaluation of the OpenEMR Clinical Co-Pilot",
};

/**
 * Root layout is intentionally minimal — just the HTML shell + global
 * data provider. The authenticated app shell (sidebar, content frame)
 * lives in `(authed)/layout.tsx`. /login + /api routes render outside
 * that group so they're not framed by the sidebar.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-50 text-slate-900">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}

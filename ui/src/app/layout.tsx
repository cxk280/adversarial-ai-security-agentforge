import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { QueryProvider } from "@/components/query-provider";

export const metadata: Metadata = {
  title: "AgentForge Adversarial AI Security",
  description: "Multi-agent adversarial evaluation of the OpenEMR Clinical Co-Pilot",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-50 text-slate-900">
        <QueryProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 px-8 py-6 overflow-x-auto">{children}</main>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}

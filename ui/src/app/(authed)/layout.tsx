import { Sidebar } from "@/components/sidebar";

/**
 * Wraps every authenticated page (everything except /login + /api/*).
 * The root layout stays minimal — just <html>, <body>, and the
 * QueryProvider — so /login can render full-bleed without the
 * sidebar peeking out behind it.
 */
export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 px-8 py-6 overflow-x-auto">{children}</main>
    </div>
  );
}

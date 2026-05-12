"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { relativeTime, usd } from "@/lib/format";
import { useRuns } from "@/hooks/use-runs";
import type { RunSummary } from "@/lib/api";

const HEADERS = ["RUN", "WHEN", "ATTACKS", "EXPLOITS", "COST"];

/** Recent Runs card on the Dashboard. Live data via TanStack Query. */
export function RecentRunsCard({ limit = 5 }: { limit?: number }) {
  const { data, isLoading, error } = useRuns();
  const runs: RunSummary[] = (data?.runs ?? []).slice(0, limit);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between px-5 py-4">
        <h3 className="font-semibold text-slate-900">Recent Runs</h3>
        <Link href="/runs" className="text-xs font-medium text-teal-600 hover:underline">
          View all →
        </Link>
      </header>
      <div className="border-t border-amber-50">
        <table className="w-full">
          <thead>
            <tr className="border-b border-amber-50">
              {HEADERS.map((h) => (
                <th
                  key={h}
                  className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-xs text-slate-500">
                  Loading recent runs…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-xs text-red-600">
                  Couldn&apos;t reach the API
                </td>
              </tr>
            )}
            {!isLoading && !error && runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-xs text-slate-500">
                  No runs yet — kick one off on the Ad Hoc Run page.
                </td>
              </tr>
            )}
            {runs.map((r) => {
              const attacks =
                (r.totals?.pass ?? 0) +
                (r.totals?.fail ?? 0) +
                (r.totals?.partial ?? 0) +
                (r.totals?.inconclusive ?? 0);
              const pass = r.totals?.pass ?? 0;
              return (
                <tr
                  key={r.run_id}
                  className="border-b border-amber-50 last:border-b-0"
                >
                  <td className="px-5 py-3 font-mono text-xs font-medium text-slate-900">
                    {r.run_id.slice(0, 18)}…
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600">
                    {relativeTime(r.started_at)}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-900">{attacks}</td>
                  <td
                    className={cn(
                      "px-5 py-3 text-xs font-semibold",
                      pass >= 5
                        ? "text-red-600"
                        : pass > 0
                          ? "text-orange-600"
                          : "text-slate-500",
                    )}
                  >
                    {pass > 0 ? `🚨 ${pass}` : "0"}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-900">
                    {usd(r.spend_usd ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

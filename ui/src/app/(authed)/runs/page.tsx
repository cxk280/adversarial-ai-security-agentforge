"use client";

import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { relativeTime, usd } from "@/lib/format";
import { useRuns } from "@/hooks/use-runs";
import type { RunSummary } from "@/lib/api";

export default function RunsHistoryPage() {
  const { data, isLoading, error } = useRuns();
  const runs: RunSummary[] = data?.runs ?? [];

  const total = runs.length;
  const exploits = runs.reduce((s, r) => s + (r.totals?.pass ?? 0), 0);
  const totalCost = runs.reduce((s, r) => s + (r.spend_usd ?? 0), 0);

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Run History" />
      <div className="space-y-5 px-8 py-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">Run history</h1>
          <p className="text-sm text-slate-600">
            {isLoading ? (
              "Loading…"
            ) : error ? (
              <span className="text-red-600">API error · check ADVERSARY_API_TOKEN env</span>
            ) : (
              <>
                {total} campaign{total === 1 ? "" : "s"} &nbsp;·&nbsp; {usd(totalCost)} total spend &nbsp;·&nbsp; {exploits} confirmed exploit{exploits === 1 ? "" : "s"}
              </>
            )}
          </p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[1.5fr_90px_90px_140px_70px_70px_70px_80px] gap-3 border-b border-amber-50 px-5 py-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <div>Campaign</div>
            <div>Started</div>
            <div>Duration</div>
            <div>Target</div>
            <div>Attacks</div>
            <div>Exploits</div>
            <div>Cost</div>
            <div>State</div>
          </div>
          {isLoading && (
            <div className="px-5 py-10 text-center text-sm text-slate-500">Loading runs…</div>
          )}
          {error && (
            <div className="px-5 py-10 text-center text-sm text-red-600">
              Couldn&apos;t reach the adversary-agent API. Check that
              <code className="mx-1 rounded bg-slate-100 px-1 text-xs">NEXT_PUBLIC_ADVERSARY_API_TOKEN</code>
              is set and the service is reachable.
            </div>
          )}
          {!isLoading && !error && runs.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              No runs yet. Kick one off from the Ad Hoc Run page.
            </div>
          )}
          {runs.map((r) => {
            const attacks =
              (r.totals?.pass ?? 0) +
              (r.totals?.fail ?? 0) +
              (r.totals?.partial ?? 0) +
              (r.totals?.inconclusive ?? 0);
            const shortTarget = r.target_url
              .replace(/^https?:\/\//, "")
              .replace(/\.up\.railway\.app$/, "")
              .replace(/^copilot-agent-/, "");
            return (
              <Link
                key={r.run_id}
                href={`/runs/${r.run_id}`}
                className="grid grid-cols-[1.5fr_90px_90px_140px_70px_70px_70px_80px] gap-3 border-b border-amber-50 px-5 py-3 last:border-b-0 items-center hover:bg-slate-50"
              >
                <div className="font-mono text-xs font-semibold text-teal-600">{r.run_id}</div>
                <div className="text-xs text-slate-500">{relativeTime(r.started_at)}</div>
                <div className="text-xs text-slate-500">
                  {r.duration_s != null ? `${r.duration_s}s` : "—"}
                </div>
                <div className="text-xs font-medium text-slate-900">{shortTarget}</div>
                <div className="text-xs text-slate-900">{attacks}</div>
                <div
                  className={cn(
                    "text-xs",
                    (r.totals?.pass ?? 0) === 0
                      ? "text-slate-400"
                      : "font-bold text-red-600",
                  )}
                >
                  {(r.totals?.pass ?? 0) === 0 ? "0" : `🚨 ${r.totals.pass}`}
                </div>
                <div className="text-xs text-slate-900">{usd(r.spend_usd ?? 0)}</div>
                <div>
                  <span
                    className={cn(
                      "rounded px-1.5 py-1 text-[9px] font-bold uppercase tracking-wide",
                      r.state === "completed"
                        ? "bg-green-100 text-green-700"
                        : r.state === "running"
                          ? "bg-teal-50 text-teal-700"
                          : r.state === "queued"
                            ? "bg-slate-100 text-slate-700"
                            : "bg-orange-100 text-orange-700",
                    )}
                  >
                    {r.state}
                  </span>
                </div>
              </Link>
            );
          })}
        </section>
      </div>
    </div>
  );
}

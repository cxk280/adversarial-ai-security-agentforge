"use client";

import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { relativeTime, usd } from "@/lib/format";
import { useRuns } from "@/hooks/use-runs";
import type { RunSummary } from "@/lib/api";

const FILTERS = [
  { label: "Source", value: "All" },
  { label: "Target", value: "All" },
  { label: "State",  value: "All" },
  { label: "Window", value: "Last 7 days", valueColor: "text-teal-600" },
];

export default function RunsHistoryPage() {
  const { data, isLoading, error } = useRuns();
  const runs: RunSummary[] = data?.runs ?? [];

  const total = runs.length;
  const exploits = runs.reduce((s, r) => s + (r.totals?.pass ?? 0), 0);
  const totalCost = runs.reduce((s, r) => s + (r.spend_usd ?? 0), 0);

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Run History" target="copilot-agent-dev" />
      <div className="space-y-5 px-8 py-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900">Run history</h1>
            <p className="text-sm text-slate-600">
              {isLoading ? (
                "Loading…"
              ) : error ? (
                <span className="text-red-600">API error · check ADVERSARY_API_TOKEN env</span>
              ) : (
                <>
                  Last 7 days &nbsp;·&nbsp; {total} campaigns &nbsp;·&nbsp; {usd(totalCost)} total spend &nbsp;·&nbsp; {exploits} confirmed exploits &nbsp;·&nbsp; All replays available
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50"
          >
            ↓ Export audit log
          </button>
        </div>

        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-amber-50/40 px-3 py-2">
            <span className="text-sm text-slate-400">⌕</span>
            <input
              type="text"
              placeholder="Search campaigns by ID, category, source, target SHA…"
              className="flex-1 bg-transparent text-sm placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50"
            >
              <span className="text-[11px] text-slate-500">{f.label}</span>
              <span className={cn(
                "text-xs font-semibold",
                f.valueColor ?? "text-slate-900",
              )}>{f.value}</span>
              <span className="text-[10px] text-slate-400">▾</span>
            </button>
          ))}
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
              <div
                key={r.run_id}
                className="grid grid-cols-[1.5fr_90px_90px_140px_70px_70px_70px_80px] gap-3 border-b border-amber-50 px-5 py-3 last:border-b-0 items-center"
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
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

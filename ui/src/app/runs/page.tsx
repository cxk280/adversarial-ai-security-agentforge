import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { relativeTime, usd } from "@/lib/format";

interface RunRow {
  id: string;
  startedAt: string;
  source: "manual" | "circleci" | "scheduled";
  target: string;
  attacks: number;
  exploits: number;
  duration: string;
  cost: number | null;
  state: "DONE" | "BYPASS";
}

const RUNS: RunRow[] = [
  { id: "cmp_…864228", startedAt: "2026-05-11T17:14:00Z", source: "manual",    target: "dev",  attacks: 57, exploits: 3, duration: "7m 34s", cost: 0.18, state: "DONE" },
  { id: "cmp_…b31426", startedAt: "2026-05-11T17:06:00Z", source: "manual",    target: "dev",  attacks: 57, exploits: 2, duration: "7m 47s", cost: 0.18, state: "DONE" },
  { id: "cmp_…7c22d2", startedAt: "2026-05-11T16:58:00Z", source: "manual",    target: "dev",  attacks: 57, exploits: 8, duration: "8m 02s", cost: 0.19, state: "DONE" },
  { id: "cmp_…2a789a", startedAt: "2026-05-11T16:55:00Z", source: "manual",    target: "dev",  attacks: 5,  exploits: 1, duration: "1m 12s", cost: 0.02, state: "DONE" },
  { id: "cmp_…3e85ab", startedAt: "2026-05-11T16:30:00Z", source: "circleci",  target: "dev",  attacks: 30, exploits: 0, duration: "3m 41s", cost: 0.09, state: "DONE" },
  { id: "cmp_…f14d22", startedAt: "2026-05-11T12:30:00Z", source: "scheduled", target: "qa",   attacks: 30, exploits: 0, duration: "3m 28s", cost: 0.10, state: "DONE" },
  { id: "cmp_…aa19c0", startedAt: "2026-05-11T09:30:00Z", source: "circleci",  target: "dev",  attacks: 30, exploits: 0, duration: "3m 33s", cost: 0.10, state: "DONE" },
  { id: "cmp_…71e2d8", startedAt: "2026-05-11T03:30:00Z", source: "manual",    target: "dev",  attacks: 12, exploits: 0, duration: "1m 02s", cost: null, state: "BYPASS" },
  { id: "cmp_…550b9a", startedAt: "2026-05-10T17:00:00Z", source: "scheduled", target: "prod", attacks: 30, exploits: 0, duration: "4m 11s", cost: 0.11, state: "DONE" },
  { id: "cmp_…20cb14", startedAt: "2026-05-09T14:30:00Z", source: "circleci",  target: "dev",  attacks: 30, exploits: 1, duration: "3m 49s", cost: 0.10, state: "DONE" },
];

const SOURCE_COLOR: Record<RunRow["source"], string> = {
  manual:    "text-teal-600",
  circleci:  "text-slate-900",
  scheduled: "text-slate-500",
};

const FILTERS = [
  { label: "Source", value: "All" },
  { label: "Target", value: "All" },
  { label: "State",  value: "All" },
  { label: "Window", value: "Last 7 days", valueColor: "text-teal-600" },
];

export default function RunsHistoryPage() {
  const total = RUNS.length;
  const exploits = RUNS.reduce((s, r) => s + r.exploits, 0);
  const totalCost = RUNS.reduce((s, r) => s + (r.cost ?? 0), 0);

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Run History" target="copilot-agent-dev" />
      <div className="space-y-5 px-8 py-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900">Run history</h1>
            <p className="text-sm text-slate-600">
              Last 7 days &nbsp;·&nbsp; {total} campaigns &nbsp;·&nbsp; {usd(totalCost)} total spend &nbsp;·&nbsp; {exploits} confirmed exploits &nbsp;·&nbsp; All replays available
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
          <div className="grid grid-cols-[1.2fr_90px_90px_70px_70px_70px_70px_70px_80px] gap-3 border-b border-amber-50 px-5 py-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <div>Campaign</div>
            <div>Started</div>
            <div>Source</div>
            <div>Target</div>
            <div>Attacks</div>
            <div>Exploits</div>
            <div>Duration</div>
            <div>Cost</div>
            <div>State</div>
          </div>
          {RUNS.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[1.2fr_90px_90px_70px_70px_70px_70px_70px_80px] gap-3 border-b border-amber-50 px-5 py-3 last:border-b-0 items-center"
            >
              <div className="text-xs font-semibold text-teal-600">{r.id}</div>
              <div className="text-xs text-slate-500">{relativeTime(r.startedAt)}</div>
              <div className={cn("text-xs font-medium", SOURCE_COLOR[r.source])}>{r.source}</div>
              <div className="text-xs font-medium text-slate-900">{r.target}</div>
              <div className="text-xs text-slate-900">{r.attacks}</div>
              <div className={cn(
                "text-xs",
                r.exploits === 0 ? "text-slate-400" : "font-bold text-red-600",
              )}>{r.exploits === 0 ? "0" : `🚨 ${r.exploits}`}</div>
              <div className="text-xs text-slate-500">{r.duration}</div>
              <div className="text-xs text-slate-900">{r.cost === null ? "—" : usd(r.cost)}</div>
              <div>
                <span className={cn(
                  "rounded px-1.5 py-1 text-[9px] font-bold uppercase tracking-wide",
                  r.state === "DONE"
                    ? "bg-green-100 text-green-700"
                    : "bg-orange-100 text-orange-700",
                )}>{r.state}</span>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

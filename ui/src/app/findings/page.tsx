"use client";

import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { SeverityBadge } from "@/components/severity-badge";
import { StatusPill } from "@/components/status-pill";
import { FINDINGS as MOCK_FINDINGS } from "@/lib/mock";
import { relativeTime } from "@/lib/format";
import { useFindings } from "@/hooks/use-runs";
import type { FindingSummary } from "@/lib/api";

const FILTERS = [
  { label: "Severity", value: "All" },
  { label: "Category", value: "All" },
  { label: "Status", value: "Open + Draft" },
  { label: "Target", value: "dev", valueColor: "text-teal-600" },
];

export default function FindingsPage() {
  const { data, isLoading, error } = useFindings();

  // Live findings from the API merged with the mock entries that don't exist
  // on disk yet (e.g. VULN-0004 Draft, VULN-0005 Low) so the UI still shows
  // the draft-queue scenario.
  const live = data?.findings ?? [];
  const liveIds = new Set(live.map((f) => f.id));
  const mockExtras = MOCK_FINDINGS.filter((m) => !liveIds.has(m.id));
  const findings: (FindingSummary | typeof MOCK_FINDINGS[number])[] = error
    ? MOCK_FINDINGS
    : [...live, ...mockExtras];

  const open = findings.filter((f) => f.status === "open").length;
  const drafts = findings.filter((f) => f.status === "draft").length;
  const resolved = findings.filter((f) => f.status === "resolved").length;
  const in_prog = findings.filter((f) => f.status === "in_progress").length;

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Findings" target="copilot-agent-dev" />
      <div className="space-y-5 px-8 py-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900">Findings</h1>
            <p className="text-sm text-slate-600">
              {isLoading ? (
                "Loading from API…"
              ) : (
                <>
                  {open} open &nbsp;·&nbsp; {in_prog} in progress &nbsp;·&nbsp; {resolved} resolved &nbsp;·&nbsp; {drafts} draft awaiting approval
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50"
          >
            ↓ Export
          </button>
        </div>

        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-amber-50/40 px-3 py-2">
            <span className="text-sm text-slate-400">⌕</span>
            <input
              type="text"
              placeholder="Search by ID, title, attack category, or attack_id…"
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
              <span className={`text-xs font-semibold ${f.valueColor ?? "text-slate-900"}`}>{f.value}</span>
              <span className="text-[10px] text-slate-400">▾</span>
            </button>
          ))}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[60px_1fr_minmax(0,3fr)_minmax(0,2fr)_120px_120px] gap-3 border-b border-amber-50 px-5 py-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <div>SEV</div>
            <div>ID</div>
            <div>FINDING</div>
            <div>CATEGORY</div>
            <div>STATUS</div>
            <div>DISCOVERED</div>
          </div>
          {findings.map((f) => (
            <Link
              key={f.id}
              href={`/findings/${f.id}`}
              className="grid grid-cols-[60px_1fr_minmax(0,3fr)_minmax(0,2fr)_120px_120px] gap-3 border-b border-amber-50 px-5 py-3.5 last:border-b-0 hover:bg-slate-50"
            >
              <SeverityBadge severity={f.severity} className="self-center" />
              <div className="self-center text-xs font-semibold text-teal-600">{f.id}</div>
              <div className="self-center text-sm font-medium text-slate-900">{f.title}</div>
              <div className="self-center text-xs text-slate-600">
                {f.category} / {f.subcategory}
              </div>
              <div className="self-center">
                <StatusPill status={f.status} />
              </div>
              <div className="self-center text-[11px] text-slate-500">
                {f.discovered ? relativeTime(f.discovered) : "—"}
              </div>
            </Link>
          ))}
        </section>

        {drafts > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-orange-300 bg-amber-50/40 px-4 py-3.5">
            <span className="rounded-full bg-orange-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
              ⚠ Draft Queue
            </span>
            <span className="flex-1 text-sm font-medium text-slate-900">
              {drafts} finding{drafts === 1 ? "" : "s"} above severity threshold {drafts === 1 ? "is" : "are"} waiting for your approval before publishing.
            </span>
            <button
              type="button"
              className="rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-700"
            >
              Review draft →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

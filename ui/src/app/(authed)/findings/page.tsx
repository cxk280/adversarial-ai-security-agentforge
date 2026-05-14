"use client";

import { useMemo } from "react";
import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { SeverityBadge } from "@/components/severity-badge";
import { StatusPill } from "@/components/status-pill";
import { relativeTime } from "@/lib/format";
import { useFindings } from "@/hooks/use-runs";

/**
 * Sort key: open findings first (ascending VULN-NNNN), then in_progress,
 * then resolved (also ascending VULN-NNNN within each bucket).
 * Anything we can't parse as VULN-NNNN sorts last (preserves insertion
 * order for those — extremely rare; only happens when a finding id
 * doesn't follow the canonical VULN-NNNN shape).
 */
const STATUS_RANK: Record<string, number> = {
  open: 0,
  in_progress: 1,
  draft: 1,
  resolved: 2,
};

function _vulnNum(id: string): number {
  const m = id.match(/^VULN-(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export default function FindingsPage() {
  const { data, isLoading, error } = useFindings();
  const findings = useMemo(() => {
    const raw = data?.findings ?? [];
    return [...raw].sort((a, b) => {
      const sa = STATUS_RANK[a.status] ?? 99;
      const sb = STATUS_RANK[b.status] ?? 99;
      if (sa !== sb) return sa - sb;
      return _vulnNum(a.id) - _vulnNum(b.id);
    });
  }, [data]);

  const open = findings.filter((f) => f.status === "open").length;
  const inProg = findings.filter((f) => f.status === "in_progress").length;
  const resolved = findings.filter((f) => f.status === "resolved").length;

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Findings" />
      <div className="space-y-5 px-8 py-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">Findings</h1>
          <p className="text-sm text-slate-600">
            {isLoading
              ? "Loading from /findings…"
              : error
                ? "Couldn't reach the adversary-agent API."
                : (
                  <>
                    {open} open &nbsp;·&nbsp; {inProg} in progress &nbsp;·&nbsp; {resolved} resolved
                  </>
                )}
          </p>
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
          {!isLoading && !error && findings.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              No findings yet. The Documentation Agent writes a VULN-NNNN.md
              every time the Judges confirm an exploit; nothing has landed in
              the current container yet.
            </div>
          )}
          {findings.map((f) => (
            <Link
              key={f.id}
              href={`/findings/${f.id}`}
              className="grid grid-cols-[60px_1fr_minmax(0,3fr)_minmax(0,2fr)_120px_120px] gap-3 border-b border-amber-50 px-5 py-3.5 last:border-b-0 hover:bg-slate-50"
            >
              <SeverityBadge severity={f.severity} className="self-center" />
              <div className="self-center text-xs font-semibold text-teal-600">{f.id}</div>
              <div className="flex items-center gap-2 self-center text-sm font-medium text-slate-900">
                <span className="truncate">{f.title}</span>
                {f.doc_agent_status === "in_progress" && (
                  <span className="inline-flex items-center gap-1 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-700">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal-500" />
                    </span>
                    Writing…
                  </span>
                )}
                {f.doc_agent_status === "failed" && (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                    Doc-agent failed
                  </span>
                )}
              </div>
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
      </div>
    </div>
  );
}

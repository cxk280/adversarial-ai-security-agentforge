"use client";

import { useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/top-bar";
import { KpiCard } from "@/components/kpi-card";
import { FindingRow } from "@/components/finding-row";
import { RecentRunsCard } from "@/components/recent-runs-card";
import { useFindings, useRuns, useCoverage } from "@/hooks/use-runs";
import { relativeTime, usd } from "@/lib/format";
import { pingTarget, type TargetPing } from "@/lib/api";
import { useTarget } from "@/lib/target-context";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const { data: findingsData } = useFindings();
  const { data: runsData } = useRuns();
  const { data: coverageData } = useCoverage();

  const findings = findingsData?.findings ?? [];
  const runs = runsData?.runs ?? [];
  const coverageRows = coverageData?.rows ?? [];

  const stats = useMemo(() => {
    const last = runs[0]; // listRuns returns most-recent-first
    const openFindings = findings.filter(
      (f) => f.status === "open" || f.status === "in_progress",
    );
    let totalPass = 0;
    let totalFail = 0;
    let totalPartial = 0;
    let totalInconclusive = 0;
    let spendToday = 0;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    for (const r of runs) {
      totalPass += r.totals?.pass ?? 0;
      totalFail += r.totals?.fail ?? 0;
      totalPartial += r.totals?.partial ?? 0;
      totalInconclusive += r.totals?.inconclusive ?? 0;
      const d = new Date(r.started_at);
      if (!Number.isNaN(d.getTime()) && d >= startOfDay) spendToday += r.spend_usd ?? 0;
    }
    const totalAttacks = totalPass + totalFail + totalPartial + totalInconclusive;
    const holdRate = totalAttacks === 0 ? null : totalFail / totalAttacks;
    const testedSet = new Set(
      coverageRows
        .filter((c) => c.cases > 0)
        .map((c) => `${c.category}/${c.subcategory}`),
    );
    return {
      last,
      openFindings,
      holdRate,
      totalAttacks,
      testedCount: testedSet.size,
      spendToday,
    };
  }, [findings, runs, coverageRows]);

  const lastDescriptor = stats.last
    ? `Last campaign ${relativeTime(stats.last.started_at)} · ${
        (stats.last.totals?.pass ?? 0) +
        (stats.last.totals?.fail ?? 0) +
        (stats.last.totals?.partial ?? 0) +
        (stats.last.totals?.inconclusive ?? 0)
      } attacks · ${stats.last.totals?.pass ?? 0} confirmed exploits · ${usd(stats.last.spend_usd ?? 0)} spent`
    : "No campaigns recorded yet. Kick one off from Ad Hoc Run.";

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Dashboard" />
      <div className="space-y-5 px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900">Security posture overview</h1>
            <p className="text-sm text-slate-600">{lastDescriptor}</p>
          </div>
          <TargetPingWidget />
        </div>

        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            label="OPEN FINDINGS"
            value={String(stats.openFindings.length)}
            delta={
              stats.openFindings.length === 0
                ? "all triaged"
                : `${stats.openFindings.filter((f) => f.severity === "critical").length} critical, ${stats.openFindings.filter((f) => f.severity === "high").length} high`
            }
            tone={
              stats.openFindings.some((f) => f.severity === "critical")
                ? "red"
                : stats.openFindings.length > 0
                  ? "orange"
                  : "green"
            }
          />
          <KpiCard
            label="TARGET HOLD RATE"
            value={stats.holdRate === null ? "—" : (stats.holdRate * 100).toFixed(1)}
            unit={stats.holdRate === null ? "" : "%"}
            delta={
              stats.totalAttacks === 0
                ? "no campaigns yet"
                : `${stats.totalAttacks} attacks total`
            }
            tone={
              stats.holdRate === null
                ? "muted"
                : stats.holdRate >= 0.9
                  ? "green"
                  : stats.holdRate >= 0.7
                    ? "orange"
                    : "red"
            }
          />
          <KpiCard
            label="COVERAGE"
            value={`${stats.testedCount} / 17`}
            unit=" subcat"
            delta={`${17 - stats.testedCount} untested`}
            tone={stats.testedCount >= 8 ? "green" : stats.testedCount >= 4 ? "orange" : "muted"}
          />
          <KpiCard
            label="TODAY'S SPEND"
            value={usd(stats.spendToday)}
            unit=" of $5.00"
            delta="budget cap from ARCHITECTURE §3.3"
            tone={stats.spendToday < 4 ? "green" : "orange"}
          />
        </div>

        <div className="grid grid-cols-2 gap-5">
          <section className="rounded-xl border border-slate-200 bg-white">
            <header className="flex items-center justify-between px-5 py-4">
              <h3 className="font-semibold text-slate-900">Open Findings</h3>
              <a href="/findings" className="text-xs font-medium text-teal-600 hover:underline">
                View all →
              </a>
            </header>
            <div className="border-t border-amber-50">
              {findings.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-slate-500">
                  No findings yet.
                </div>
              ) : (
                findings.map((f) => (
                  <FindingRow
                    key={f.id}
                    finding={f}
                    when={f.discovered ? relativeTime(f.discovered) : "—"}
                  />
                ))
              )}
            </div>
          </section>

          <RecentRunsCard limit={5} />
        </div>

        <section className="rounded-xl border border-slate-200 bg-white">
          <header className="flex items-center justify-between px-5 py-4">
            <h3 className="font-semibold text-slate-900">Coverage at a glance</h3>
            <div className="flex items-center gap-4">
              <CoverageLegend />
              <a href="/coverage" className="text-xs font-medium text-teal-600 hover:underline">
                Open full matrix →
              </a>
            </div>
          </header>
          <div className="border-t border-amber-50 px-5 py-4">
            <CoverageCompact rows={coverageRows} />
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Live probe of the currently-selected target's /health endpoint.
 * Visible proof that the platform is actually reaching the
 * Co-Pilot — defends against the "are you sure this isn't all
 * cached attempts?" question.
 *
 * Re-probes every 30s while the page is mounted, and on every
 * target change in the TopBar dropdown.
 */
function TargetPingWidget() {
  const { target } = useTarget();
  const [ping, setPing] = useState<TargetPing | null>(null);
  const [busy, setBusy] = useState(false);

  const probe = async () => {
    setBusy(true);
    try {
      setPing(await pingTarget(target.url));
    } catch {
      setPing({
        target_url: target.url,
        ok: false,
        status_code: null,
        latency_ms: null,
        checked_at: new Date().toISOString(),
        error: "probe failed",
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void probe();
    const id = setInterval(probe, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.url]);

  const status = ping?.ok
    ? "live"
    : ping
      ? "unreachable"
      : "probing";

  return (
    <button
      type="button"
      onClick={probe}
      disabled={busy}
      title={`Probes ${target.url}/health. Click to re-check.`}
      className={cn(
        "shrink-0 rounded-lg border px-3 py-2 text-left text-[11px] hover:bg-slate-50 disabled:opacity-60",
        ping?.ok ? "border-green-200 bg-green-50/40"
          : ping ? "border-red-200 bg-red-50/40"
          : "border-slate-200 bg-white",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            status === "live" ? "animate-pulse bg-green-500"
              : status === "unreachable" ? "bg-red-500"
              : "bg-slate-400",
          )}
        />
        <span className="font-bold uppercase tracking-wide text-slate-600">
          Target {status}
        </span>
      </div>
      <div className="text-slate-500">
        {ping?.ok && ping.latency_ms != null
          ? `${ping.latency_ms} ms · ${relativeTime(ping.checked_at)}`
          : ping?.checked_at
            ? `last check ${relativeTime(ping.checked_at)}`
            : "probing…"}
      </div>
    </button>
  );
}

const SUBCATEGORY_LABEL: Record<string, string> = {
  indirect:                          "Indirect",
  direct:                            "Direct",
  multi_turn:                        "Multi-turn",
  cross_patient_leakage:             "Cross-patient",
  authorization_bypass:              "Authz bypass",
  phi_leakage:                       "PHI leakage",
  persona_hijack_clinical_authority: "Persona hijack",
  persona_hijack:                    "Persona hijack",
  privilege_escalation:              "Priv escalation",
  history_manipulation:              "History manip",
  context_poisoning:                 "Context poison",
  parameter_tampering:               "Param tamper",
  unintended_invocation:             "Recursive calls",
  token_exhaustion:                  "Token exhaust",
  cost_amplification:                "Cost amp",
};

const CATEGORY_LABEL: Record<string, string> = {
  prompt_injection:           "Prompt Injection",
  data_exfiltration:          "Data Exfiltration",
  identity_role_exploitation: "Identity / Role",
  state_corruption:           "State Corruption",
  tool_misuse:                "Tool Misuse",
  denial_of_service:          "Denial of Service",
};

const COVERAGE_ORDER = [
  "prompt_injection",
  "data_exfiltration",
  "identity_role_exploitation",
  "state_corruption",
  "tool_misuse",
  "denial_of_service",
];

interface CoverageRow {
  category: string;
  subcategory: string;
  cases: number;
  exploits: number;
  held: number;
}

function CoverageCompact({ rows }: { rows: CoverageRow[] }) {
  const byCat = new Map<string, CoverageRow[]>();
  for (const c of rows) {
    if (!byCat.has(c.category)) byCat.set(c.category, []);
    byCat.get(c.category)!.push(c);
  }
  const SLOTS = 3;
  return (
    <div className="space-y-2">
      {COVERAGE_ORDER.map((cat) => {
        const cells = byCat.get(cat) ?? [];
        const padded = [...cells, ...Array(Math.max(0, SLOTS - cells.length)).fill(null)];
        return (
          <div
            key={cat}
            className="grid grid-cols-[176px_repeat(3,minmax(0,1fr))] items-center gap-2"
          >
            <div className="text-xs font-medium text-slate-900">
              {CATEGORY_LABEL[cat] ?? cat}
            </div>
            {padded.slice(0, SLOTS).map((c: CoverageRow | null, idx: number) =>
              c ? (
                <div
                  key={c.subcategory}
                  className={
                    "truncate rounded-md px-3 py-2 text-[11px] font-medium " +
                    cellColor(c)
                  }
                  title={`${c.subcategory} · ${c.cases} cases · ${c.exploits} exploit${c.exploits === 1 ? "" : "s"}`}
                >
                  {SUBCATEGORY_LABEL[c.subcategory] ?? c.subcategory}
                </div>
              ) : (
                <div key={`empty-${idx}`} />
              ),
            )}
          </div>
        );
      })}
      {rows.length === 0 && (
        <div className="py-4 text-center text-[11px] text-slate-500">
          No campaigns recorded yet — every category will appear as untested
          until the first run lands.
        </div>
      )}
    </div>
  );
}

function CoverageLegend() {
  const items = [
    { color: "bg-red-500",    label: "≥1 exploit" },
    { color: "bg-orange-500", label: "partial held" },
    { color: "bg-green-200",  label: "clean" },
    { color: "bg-amber-50",   label: "untested" },
  ];
  return (
    <div className="flex items-center gap-3 text-[10px] text-slate-600">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded ${i.color}`} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function cellColor(c: CoverageRow): string {
  if (c.cases === 0) return "bg-amber-50/80 text-slate-700";
  if (c.exploits > 0) return "bg-red-500 text-white";
  const heldRate = c.held / c.cases;
  if (heldRate >= 0.95) return "bg-green-200 text-slate-900";
  return "bg-orange-500 text-white";
}

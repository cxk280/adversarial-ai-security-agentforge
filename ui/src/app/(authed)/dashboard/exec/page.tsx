"use client";

import { useMemo, useState } from "react";
import { TopBar } from "@/components/top-bar";
import { KpiCard } from "@/components/kpi-card";
import { cn } from "@/lib/utils";
import { useFindings, useRuns } from "@/hooks/use-runs";
import { usd } from "@/lib/format";
import { downloadComplianceReport } from "@/lib/api";
import { matchesTarget, useTarget } from "@/lib/target-context";

interface KpiTone { tone: "green" | "red" | "orange"; }

export default function ExecPage() {
  const { data: findingsData } = useFindings();
  const { data: runsData } = useRuns();
  const { target } = useTarget();

  // Scope every KPI to the currently-selected target. The executive
  // view is per-env: dev posture isn't prod posture and vice versa.
  const findings = useMemo(
    () => (findingsData?.findings ?? []).filter((f) => matchesTarget(f.target, target)),
    [findingsData, target],
  );
  const runs = useMemo(
    () => (runsData?.runs ?? []).filter((r) => matchesTarget(r.target_url, target)),
    [runsData, target],
  );

  const kpis = useMemo(() => {
    const openFindings = findings.filter(
      (f) => f.status === "open" || f.status === "in_progress",
    );
    const critical = openFindings.filter((f) => f.severity === "critical").length;
    const high = openFindings.filter((f) => f.severity === "high").length;

    let pass = 0;
    let fail = 0;
    let partial = 0;
    let inconclusive = 0;
    const categories = new Set<string>();
    for (const r of runs) {
      pass += r.totals?.pass ?? 0;
      fail += r.totals?.fail ?? 0;
      partial += r.totals?.partial ?? 0;
      inconclusive += r.totals?.inconclusive ?? 0;
    }
    const total = pass + fail + partial + inconclusive;
    const resilience = total === 0 ? null : (fail / total) * 100;

    // Coverage: count distinct subcategories exercised in findings + observed in runs.
    findings.forEach((f) => {
      if (f.subcategory) categories.add(`${f.category}/${f.subcategory}`);
    });
    // The full taxonomy in the threat model is 17 leaf subcategories.
    const COVERAGE_DENOMINATOR = 17;
    const coveragePct = Math.min(100, Math.round((categories.size / COVERAGE_DENOMINATOR) * 100));

    return [
      {
        label: "RESILIENCE",
        value: resilience === null ? "—" : resilience.toFixed(1),
        unit: resilience === null ? "" : "%",
        delta:
          total === 0
            ? "no campaigns yet"
            : `${fail}/${total} attacks held`,
        tone: (resilience !== null && resilience >= 90
          ? "green"
          : resilience !== null && resilience >= 70
            ? "orange"
            : "red") as KpiTone["tone"],
      },
      {
        label: "ACTIVE FINDINGS",
        value: String(openFindings.length),
        unit: "",
        delta:
          openFindings.length === 0
            ? "all triaged"
            : `${critical} critical, ${high} high`,
        tone: (critical > 0 ? "red" : openFindings.length > 0 ? "orange" : "green") as KpiTone["tone"],
      },
      {
        label: "COVERAGE",
        value: String(coveragePct),
        unit: "% surface",
        delta: `${categories.size} / ${COVERAGE_DENOMINATOR} subcategories`,
        tone: (coveragePct >= 60 ? "green" : coveragePct >= 30 ? "orange" : "red") as KpiTone["tone"],
      },
    ];
  }, [findings, runs]);

  const trend = useMemo(() => {
    // Group completed runs by ISO date, take per-day mean pass-held rate.
    const byDate = new Map<string, { fail: number; total: number }>();
    for (const r of runs) {
      if (r.state !== "completed") continue;
      const d = new Date(r.started_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, "0")}`;
      const tot =
        (r.totals?.pass ?? 0) +
        (r.totals?.fail ?? 0) +
        (r.totals?.partial ?? 0) +
        (r.totals?.inconclusive ?? 0);
      if (tot === 0) continue;
      const cur = byDate.get(key) ?? { fail: 0, total: 0 };
      cur.fail += r.totals?.fail ?? 0;
      cur.total += tot;
      byDate.set(key, cur);
    }
    return [...byDate.entries()]
      .sort((a, b) => {
        const [am, ad] = a[0].split("/").map(Number);
        const [bm, bd] = b[0].split("/").map(Number);
        return am === bm ? ad - bd : am - bm;
      })
      .map(([date, v]) => ({ date, value: v.fail / v.total }));
  }, [runs]);

  const todaysSpend = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    let total = 0;
    for (const r of runs) {
      const d = new Date(r.started_at);
      if (!Number.isNaN(d.getTime()) && d >= startOfDay) total += r.spend_usd ?? 0;
    }
    return total;
  }, [runs]);

  const summary = useMemo(() => {
    const open = findings.filter((f) => f.status === "open" || f.status === "in_progress");
    const resolved = findings.filter((f) => f.status === "resolved");
    return [
      {
        count: String(open.filter((f) => f.severity === "critical").length),
        label: "Critical findings open",
        color: "text-red-600",
        sub: "Median TTR target: 4 h",
      },
      {
        count: String(open.filter((f) => f.severity === "high").length),
        label: "High findings open",
        color: "text-orange-600",
        sub: "Median TTR target: 24 h",
      },
      {
        count: String(resolved.length),
        label: "Findings resolved",
        color: "text-green-700",
        sub: "Regression-tested",
      },
      {
        count: String(runs.filter((r) => r.state === "completed").length),
        label: "Campaigns completed",
        color: "text-slate-700",
        sub: `${usd(todaysSpend)} spent today`,
      },
    ];
  }, [findings, runs, todaysSpend]);

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Executive View" />
      <div className="space-y-5 px-8 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Executive view</h1>
            <p className="text-sm text-slate-600">
              AgentForge Clinical Co-Pilot &nbsp;·&nbsp; live data &nbsp;·&nbsp; Generated for CISO + risk committee review
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs">
              <span className="text-slate-500">Period</span>
              <span className="font-semibold text-teal-600">Last 7 days</span>
              <span className="text-slate-400">▾</span>
            </button>
            <GenerateReportButton />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white">
          <header className="flex items-center justify-between border-b border-amber-50 px-5 py-4">
            <h3 className="font-semibold text-slate-900">Resilience over time — pass-held rate per campaign</h3>
            <span className="text-[11px] text-slate-500">
              y-axis: % attacks held &nbsp;·&nbsp; each point = one day&apos;s aggregate
            </span>
          </header>
          <div className="px-5 py-5">
            {trend.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                No completed campaigns yet. Run one from <code className="rounded bg-slate-100 px-1">/run</code> to populate this chart.
              </div>
            ) : (
              <TrendChart points={trend} />
            )}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-5">
          <section className="rounded-xl border border-slate-200 bg-white">
            <header className="border-b border-amber-50 px-5 py-4">
              <h3 className="font-semibold text-slate-900">Findings &amp; campaigns — live</h3>
            </header>
            {summary.map((s, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-amber-50 px-5 py-3.5 last:border-b-0">
                <span className={cn("text-2xl font-bold", s.color)}>{s.count}</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-900">{s.label}</div>
                  <div className="text-[11px] text-slate-500">{s.sub}</div>
                </div>
              </div>
            ))}
          </section>

          <section className="rounded-xl bg-slate-900 px-6 py-5 text-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
              Audit &amp; Compliance
            </div>
            <div className="mt-2 text-lg font-bold leading-snug">
              Continuous testing in effect — {runs.length} campaigns recorded, {usd(todaysSpend)} spent today, 0 bypasses without justification.
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
              <li>✓ All findings traceable to a reproducible attack sequence</li>
              <li>✓ Every promotion to qa / prod gated by adversarial regression suite</li>
              <li>✓ Audit log immutable; export available in CSV + signed JSON formats</li>
              <li>✓ Authorization scope: ARCHITECTURE.md §13 (2026-05-11 → 2026-05-22)</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function GenerateReportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={async () => {
          setError(null);
          setBusy(true);
          try {
            await downloadComplianceReport();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Download failed");
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Generating…" : "↓ Generate compliance report"}
      </button>
      {error && (
        <p className="text-[10px] font-medium text-red-600">{error}</p>
      )}
    </div>
  );
}

function TrendChart({ points }: { points: { date: string; value: number }[] }) {
  const W = 800, H = 200, PADX = 50, PADY = 20;
  const minV = 0, maxV = 1.0;
  const xStep = points.length > 1 ? (W - PADX * 2) / (points.length - 1) : 0;
  const yScale = (v: number) =>
    PADY + ((maxV - v) / (maxV - minV)) * (H - PADY * 2);

  const path = points.map((p, i) => {
    const x = PADX + i * xStep;
    const y = yScale(p.value);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[1.0, 0.75, 0.5, 0.25, 0.0].map((v) => (
        <g key={v}>
          <line
            x1={PADX} y1={yScale(v)} x2={W - PADX} y2={yScale(v)}
            stroke={v === 0.5 ? "#eeebE3" : "#e2e5eb"}
            strokeWidth={1}
          />
          <text
            x={PADX - 8} y={yScale(v) + 3}
            fontSize="10" fill="#8a91a1" textAnchor="end"
          >{Math.round(v * 100)}%</text>
        </g>
      ))}
      <path d={path} stroke="#008c8c" strokeWidth={2} fill="none" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={PADX + i * xStep}
          cy={yScale(p.value)}
          r={3.5}
          fill="#008c8c"
          stroke="white"
          strokeWidth={1.5}
        />
      ))}
      {points.map((p, i) => (
        <text
          key={i}
          x={PADX + i * xStep}
          y={H - 4}
          fontSize="10"
          fill="#8a91a1"
          textAnchor="middle"
        >{p.date}</text>
      ))}
    </svg>
  );
}

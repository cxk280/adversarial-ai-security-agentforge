import { TopBar } from "@/components/top-bar";
import { KpiCard } from "@/components/kpi-card";
import { cn } from "@/lib/utils";

const KPIS = [
  { label: "RESILIENCE",       value: "94.7", unit: "%",        delta: "↑ 1.8% vs last week",  tone: "green" as const },
  { label: "ACTIVE FINDINGS",  value: "3",    unit: "",         delta: "1 critical, 2 high",   tone: "red" as const   },
  { label: "MEAN TIME TO FIX", value: "4.2",  unit: "h",        delta: "↓ 27% vs last week",   tone: "green" as const },
  { label: "COVERAGE",         value: "24",   unit: "% surface", delta: "13 subcat untested",  tone: "orange" as const },
];

const TREND = [
  { date: "5/04", value: 0.86 }, { date: "5/05", value: 0.88 },
  { date: "5/06", value: 0.85 }, { date: "5/06", value: 0.89 },
  { date: "5/07", value: 0.91 }, { date: "5/07", value: 0.90 },
  { date: "5/08", value: 0.92 }, { date: "5/08", value: 0.93 },
  { date: "5/09", value: 0.91 }, { date: "5/09", value: 0.94 },
  { date: "5/10", value: 0.95 }, { date: "5/10", value: 0.95 },
  { date: "5/11", value: 0.947 }, { date: "5/11", value: 0.947 },
];

const SUMMARY = [
  { count: "1",  label: "Critical findings open",  color: "text-red-600",    sub: "Median TTR: 4.2 h" },
  { count: "2",  label: "High findings open",       color: "text-orange-600", sub: "Median TTR: 4.2 h" },
  { count: "12", label: "Findings resolved",        color: "text-green-700",  sub: "All regression-tested" },
  { count: "0",  label: "Findings re-opened",       color: "text-green-700",  sub: "Zero regressions this week" },
];

export default function ExecPage() {
  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Executive View" target="copilot-agent-dev" />
      <div className="space-y-5 px-8 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Executive view</h1>
            <p className="text-sm text-slate-600">
              AgentForge Clinical Co-Pilot &nbsp;·&nbsp; 7-day window &nbsp;·&nbsp; Generated for CISO + risk committee review
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs">
              <span className="text-slate-500">Period</span>
              <span className="font-semibold text-teal-600">Last 7 days</span>
              <span className="text-slate-400">▾</span>
            </button>
            <button className="rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-700">
              ↓ Generate compliance report
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {KPIS.map((k) => <KpiCard key={k.label} {...k} />)}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white">
          <header className="flex items-center justify-between border-b border-amber-50 px-5 py-4">
            <h3 className="font-semibold text-slate-900">Resilience over time — pass rate per target deploy</h3>
            <span className="text-[11px] text-slate-500">
              y-axis: % attacks held &nbsp;·&nbsp; each point = one target commit
            </span>
          </header>
          <div className="px-5 py-5">
            <TrendChart />
          </div>
        </section>

        <div className="grid grid-cols-2 gap-5">
          <section className="rounded-xl border border-slate-200 bg-white">
            <header className="border-b border-amber-50 px-5 py-4">
              <h3 className="font-semibold text-slate-900">Critical / high findings — 7 days</h3>
            </header>
            {SUMMARY.map((s, i) => (
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
              Audit & Compliance
            </div>
            <div className="mt-2 text-lg font-bold leading-snug">
              Continuous testing in effect — 127 campaigns, $4.83 spent, 0 bypasses without justification.
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

function TrendChart() {
  const W = 800, H = 200, PADX = 50, PADY = 20;
  const minV = 0.1, maxV = 1.0;
  const xStep = (W - PADX * 2) / (TREND.length - 1);
  const yScale = (v: number) =>
    PADY + ((maxV - v) / (maxV - minV)) * (H - PADY * 2);

  const path = TREND.map((p, i) => {
    const x = PADX + i * xStep;
    const y = yScale(p.value);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0.1, 0.3, 0.5, 0.7, 0.9].map((g) => (
        <g key={g}>
          <line
            x1={PADX} y1={yScale(1 - g)} x2={W - PADX} y2={yScale(1 - g)}
            stroke={g === 0.5 ? "#eeebE3" : "#e2e5eb"}
            strokeWidth={1}
          />
          <text
            x={PADX - 8} y={yScale(1 - g) + 3}
            fontSize="10" fill="#8a91a1" textAnchor="end"
          >{Math.round(g * 100)}%</text>
        </g>
      ))}
      <path d={path} stroke="#008c8c" strokeWidth={2} fill="none" />
      {TREND.map((p, i) => (
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
      {TREND.map((p, i) =>
        i % 2 === 0 ? (
          <text
            key={i}
            x={PADX + i * xStep}
            y={H - 4}
            fontSize="10"
            fill="#8a91a1"
            textAnchor="middle"
          >{p.date}</text>
        ) : null,
      )}
    </svg>
  );
}

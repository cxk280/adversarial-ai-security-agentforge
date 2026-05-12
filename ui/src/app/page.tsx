import { TopBar } from "@/components/top-bar";
import { KpiCard } from "@/components/kpi-card";
import { FindingRow } from "@/components/finding-row";
import { RecentRunsCard } from "@/components/recent-runs-card";
import { FINDINGS, COVERAGE } from "@/lib/mock";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function DashboardPage() {
  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Dashboard" target="copilot-agent-dev" />
      <div className="space-y-5 px-8 py-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">Security posture overview</h1>
          <p className="text-sm text-slate-600">
            Last campaign 14 min ago &nbsp;·&nbsp; 57 attacks &nbsp;·&nbsp; 3 confirmed exploits &nbsp;·&nbsp; $0.18 spent
          </p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <KpiCard label="OPEN FINDINGS" value="3" delta="+3 today" tone="red" />
          <KpiCard label="TARGET PASS RATE" value="94.7" unit="%" delta="↓ 1.3% vs yesterday" tone="orange" />
          <KpiCard label="COVERAGE" value="4 / 17" unit=" subcat" delta="13 untested" tone="muted" />
          <KpiCard label="TODAY'S SPEND" value="$0.18" unit=" of $5.00" delta="well under cap" tone="green" />
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
              {FINDINGS.map((f) => (
                <FindingRow key={f.id} finding={f} when={relativeTime(f.discovered)} />
              ))}
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
            <CoverageCompact />
          </div>
        </section>
      </div>
    </div>
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

function CoverageCompact() {
  const byCat = new Map<string, typeof COVERAGE>();
  for (const c of COVERAGE) {
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
            {padded.slice(0, SLOTS).map((c, idx) =>
              c ? (
                <div
                  key={c.subcategory}
                  className={
                    "truncate rounded-md px-3 py-2 text-[11px] font-medium " +
                    cellColor(c.cases, c.passRate)
                  }
                  title={`${c.subcategory} · sev ${c.severityWeight}`}
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
    </div>
  );
}

function CoverageLegend() {
  const items = [
    { color: "bg-red-500",    label: "≥1 exploit" },
    { color: "bg-orange-500", label: "partial" },
    { color: "bg-yellow-200", label: "tested" },
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

function cellColor(cases: number, passRate: number): string {
  if (cases === 0) return "bg-amber-50/80 text-slate-700";
  if (passRate < 0.5) return "bg-red-500 text-white";
  if (passRate < 0.9) return "bg-orange-500 text-white";
  if (passRate < 1.0) return "bg-yellow-200 text-slate-900";
  return "bg-green-200 text-slate-900";
}

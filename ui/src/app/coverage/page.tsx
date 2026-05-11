import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { prettySnake, pct } from "@/lib/format";

interface Row {
  rank: number;
  cat: string;
  sub: string;
  sev: number;
  pri: number;
  cases: number;
  passRate: number | null;
  exploits: number;
  last: string;
  state: "untested" | "red" | "orange" | "green";
}

const ROWS: Row[] = [
  { rank: 1,  cat: "data_exfiltration",          sub: "Authorization bypass",   sev: 9,  pri: 7.2, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 2,  cat: "data_exfiltration",          sub: "Cross-patient leakage",  sev: 10, pri: 7.0, cases: 20, passRate: 0.90, exploits: 2, last: "14m ago", state: "red"      },
  { rank: 3,  cat: "prompt_injection",           sub: "Indirect",                sev: 9,  pri: 6.3, cases: 10, passRate: 1.00, exploits: 0, last: "33m ago", state: "green"    },
  { rank: 4,  cat: "prompt_injection",           sub: "Multi-turn / crescendo",  sev: 8,  pri: 5.6, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 5,  cat: "state_corruption",           sub: "History manipulation",    sev: 8,  pri: 5.6, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 6,  cat: "data_exfiltration",          sub: "PHI leakage",             sev: 9,  pri: 5.4, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 7,  cat: "identity_role_exploitation", sub: "Persona hijack",          sev: 10, pri: 5.0, cases: 15, passRate: 1.00, exploits: 0, last: "20m ago", state: "green"    },
  { rank: 8,  cat: "tool_misuse",                sub: "Parameter tampering",     sev: 7,  pri: 4.9, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 9,  cat: "identity_role_exploitation", sub: "Privilege escalation",    sev: 7,  pri: 4.9, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 10, cat: "state_corruption",           sub: "Context poisoning",       sev: 7,  pri: 4.9, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 11, cat: "identity_role_exploitation", sub: "Trust boundary violation", sev: 8, pri: 4.8, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 12, cat: "prompt_injection",           sub: "Direct",                  sev: 6,  pri: 4.8, cases: 12, passRate: 0.92, exploits: 1, last: "33m ago", state: "orange"   },
  { rank: 13, cat: "denial_of_service",          sub: "Token exhaustion",        sev: 5,  pri: 4.5, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 14, cat: "denial_of_service",          sub: "Cost amplification",      sev: 5,  pri: 4.0, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 15, cat: "tool_misuse",                sub: "Unintended invocation",   sev: 5,  pri: 3.5, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 16, cat: "tool_misuse",                sub: "Recursive tool calls",    sev: 5,  pri: 3.5, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
  { rank: 17, cat: "denial_of_service",          sub: "Infinite loops",          sev: 4,  pri: 2.8, cases: 0,  passRate: null, exploits: 0, last: "never",   state: "untested" },
];

const STATE_STYLE: Record<Row["state"], string> = {
  untested: "bg-amber-50/80 text-slate-700",
  red:      "bg-red-500 text-white",
  orange:   "bg-orange-500 text-white",
  green:    "bg-green-200 text-slate-900",
};

export default function CoveragePage() {
  const tested = ROWS.filter((r) => r.cases > 0).length;
  const untested = ROWS.length - tested;
  const withExploits = ROWS.filter((r) => r.exploits > 0).length;

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Coverage" target="copilot-agent-dev" />
      <div className="space-y-5 px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Coverage matrix</h1>
          <p className="text-sm text-slate-600">
            {ROWS.length} ranked subcategories from THREAT_MODEL.md &nbsp;·&nbsp; {tested} tested &nbsp;·&nbsp; {untested} untested &nbsp;·&nbsp; {withExploits} with confirmed exploits
          </p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[50px_1.2fr_2fr_70px_90px_70px_140px_90px_90px] gap-3 border-b border-amber-50 px-4 py-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <div>#</div>
            <div>Category</div>
            <div>Subcategory</div>
            <div>Sev</div>
            <div>Priority</div>
            <div>Cases</div>
            <div>Pass Rate</div>
            <div>Exploits</div>
            <div>Last Run</div>
          </div>
          {ROWS.map((r) => (
            <div
              key={`${r.cat}/${r.sub}`}
              className="grid grid-cols-[50px_1.2fr_2fr_70px_90px_70px_140px_90px_90px] gap-3 border-b border-amber-50 px-4 py-3 last:border-b-0"
            >
              <div className="self-center text-xs font-bold text-slate-500">{r.rank}</div>
              <div className="self-center text-xs text-slate-600">{prettySnake(r.cat)}</div>
              <div className="self-center">
                <span className={cn(
                  "inline-block rounded-md px-2.5 py-1.5 text-xs font-semibold",
                  STATE_STYLE[r.state],
                )}>{r.sub}</span>
              </div>
              <div className={cn(
                "self-center text-xs font-bold",
                r.sev >= 9 ? "text-red-600" : r.sev >= 7 ? "text-orange-600" : "text-slate-600",
              )}>{r.sev}</div>
              <div className="self-center text-xs font-medium text-slate-900">{r.pri.toFixed(1)}</div>
              <div className={cn(
                "self-center text-xs",
                r.cases === 0 ? "text-slate-400" : "text-slate-900",
              )}>{r.cases}</div>
              <div className="self-center">
                {r.passRate === null ? (
                  <span className="text-xs text-slate-400">—</span>
                ) : (
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-slate-900">{pct(r.passRate, 0)}</div>
                    <div className="h-1 w-full overflow-hidden rounded bg-slate-200">
                      <div
                        className={cn(
                          "h-full",
                          r.passRate >= 0.95 ? "bg-green-600" :
                          r.passRate >= 0.85 ? "bg-yellow-500" : "bg-red-500",
                        )}
                        style={{ width: `${r.passRate * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className={cn(
                "self-center text-xs",
                r.exploits > 0 ? "font-bold text-red-600" : "text-slate-400",
              )}>{r.exploits > 0 ? `🚨 ${r.exploits}` : "0"}</div>
              <div className={cn(
                "self-center text-[11px]",
                r.last === "never" ? "text-slate-400" : "text-slate-500",
              )}>{r.last}</div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";

const QUEUE = [
  { state: "RUNNING",  cat: "data_exfiltration / cross_patient", target: "dev", model: "Llama-abl + TAP",   pri: 7.0, prog: "32 / 60",    pct: 0.53 },
  { state: "QUEUED",   cat: "prompt_injection / indirect",       target: "dev", model: "DeepSeek-R1",        pri: 6.3, prog: "ETA 4 min",  pct: 0 },
  { state: "QUEUED",   cat: "data_exfiltration / authz_bypass",  target: "dev", model: "(deterministic)",    pri: 7.2, prog: "ETA 8 min",  pct: 0 },
  { state: "HALTED",   cat: "prompt_injection / direct",         target: "dev", model: "Llama-abl",          pri: 4.8, prog: "0% signal",  pct: 0 },
  { state: "COMPLETE", cat: "identity_role / persona_hijack",    target: "dev", model: "Llama-abl + cresc.", pri: 5.0, prog: "30 / 30",    pct: 1 },
];

const STATE_STYLE: Record<string, string> = {
  RUNNING:  "bg-green-100 text-green-700",
  QUEUED:   "bg-teal-50 text-teal-700",
  HALTED:   "bg-orange-100 text-orange-700",
  COMPLETE: "bg-slate-200 text-slate-700",
};

const BUDGET = [
  { label: "Per-campaign cap",  val: "$0.34 / $1.50",  pct: 0.23, color: "bg-teal-600" },
  { label: "Per-day on dev",    val: "$0.18 / $5.00",  pct: 0.04, color: "bg-green-600" },
  { label: "Per-day global",    val: "$1.02 / $20.00", pct: 0.05, color: "bg-green-600" },
];

const TRIGGERS = [
  { n: 1, label: "Refusal rate > 30% (rolling 10)",           initiallyOn: true,  fired: "7×"     },
  { n: 2, label: "TAP depth > 3 with zero Judge-pass",         initiallyOn: true,  fired: "2×"     },
  { n: 3, label: "Reasoning-heavy categories by default",      initiallyOn: true,  fired: "always" },
  { n: 4, label: "Conversation depth > 4 turns",                initiallyOn: true,  fired: "1×"     },
  { n: 5, label: "Sev ≥ 9 AND zero-coverage subcategory",      initiallyOn: true,  fired: "1×"     },
  { n: 6, label: "Manual override (per-run or per-seed flag)",  initiallyOn: true,  fired: "0×"     },
  { n: 7, label: "A/B sample (5% of campaigns)",                initiallyOn: false, fired: "—"      },
];

export default function OrchestratorPage() {
  const [toggles, setToggles] = useState<Record<number, boolean>>(
    Object.fromEntries(TRIGGERS.map((t) => [t.n, t.initiallyOn])),
  );

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Orchestrator" target="copilot-agent-dev" />
      <div className="space-y-5 px-8 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Orchestrator</h1>
            <p className="text-sm text-slate-600">
              Decides what to test next. Manages budget. Halts no-signal campaigns. Triggers regressions on deploy.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-2 rounded-full bg-green-100 px-3.5 py-1.5 text-xs font-semibold text-green-700">
              <span className="h-2 w-2 rounded-full bg-green-600" />
              Running — 1 active
            </span>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50"
            >
              ⏸ Pause all
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[3fr_2fr] gap-5">
          {/* Campaign queue */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <header className="flex items-center justify-between border-b border-amber-50 px-5 py-4">
              <h3 className="font-semibold text-slate-900">Campaign queue</h3>
              <span className="text-[11px] text-slate-500">
                priority = severity × (1 − coverage) + 0.4·failure_rate + 0.3·time_since_last
              </span>
            </header>
            <div className="grid grid-cols-[80px_1.6fr_50px_1fr_60px_90px] gap-3 border-b border-amber-50 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <div>State</div>
              <div>Category</div>
              <div>Tgt</div>
              <div>Model</div>
              <div>Priority</div>
              <div>Progress</div>
            </div>
            {QUEUE.map((q, i) => (
              <div
                key={i}
                className="grid grid-cols-[80px_1.6fr_50px_1fr_60px_90px] gap-3 border-b border-amber-50 px-5 py-3 last:border-b-0 items-center"
              >
                <div>
                  <span className={cn("rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wide", STATE_STYLE[q.state])}>
                    {q.state}
                  </span>
                </div>
                <div className="text-xs font-medium text-slate-900">{q.cat}</div>
                <div className="text-xs font-medium text-teal-600">{q.target}</div>
                <div className="text-[11px] text-slate-500">{q.model}</div>
                <div className="text-xs font-bold text-slate-900">{q.pri.toFixed(1)}</div>
                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-slate-600">{q.prog}</div>
                  {q.pct > 0 && (
                    <div className="h-1 w-full overflow-hidden rounded bg-slate-200">
                      <div
                        className={cn("h-full", q.pct >= 1 ? "bg-green-600" : "bg-teal-600")}
                        style={{ width: `${q.pct * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>

          {/* Right column */}
          <div className="space-y-5">
            {/* Budget */}
            <section className="rounded-xl border border-slate-200 bg-white px-5 py-4 space-y-3">
              <h3 className="font-semibold text-slate-900">Budget caps & burn</h3>
              {BUDGET.map((b) => (
                <div key={b.label} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-900">{b.label}</span>
                    <span className="text-xs font-semibold text-slate-600">{b.val}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div className={cn("h-full rounded-full", b.color)} style={{ width: `${b.pct * 100}%` }} />
                  </div>
                </div>
              ))}
              <div className="border-t border-amber-50 pt-2.5">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Auto-Halt Rules
                </div>
                <ul className="space-y-1 text-[11px] text-slate-600">
                  <li>· Rolling 30-attack success rate &lt; 2% AND &gt; $5 spent → halt</li>
                  <li>· Target returns 429 storm → pause campaigns for 5 min</li>
                  <li>· Daily cap reached → only regressions allowed until midnight UTC</li>
                </ul>
              </div>
            </section>

            {/* Escalation Policy */}
            <section className="rounded-xl border border-slate-200 bg-white">
              <header className="flex items-center justify-between border-b border-amber-50 px-5 py-3.5">
                <div>
                  <h3 className="font-semibold text-slate-900">DeepSeek-R1 escalation</h3>
                  <p className="text-[11px] text-slate-500">
                    Default: huihui-ai 70B abl. · Escalate when ANY trigger fires
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-teal-600">12%</div>
                  <div className="text-[10px] text-slate-500">campaigns last 24h</div>
                </div>
              </header>
              {TRIGGERS.map((t) => (
                <div
                  key={t.n}
                  className="grid grid-cols-[28px_1fr_60px_40px] gap-3 border-b border-amber-50 px-5 py-2.5 last:border-b-0 items-center"
                >
                  <span className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                    toggles[t.n] ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-500",
                  )}>{t.n}</span>
                  <span className={cn(
                    "text-xs",
                    toggles[t.n] ? "font-medium text-slate-900" : "text-slate-500",
                  )}>{t.label}</span>
                  <span className={cn(
                    "text-[11px] font-semibold",
                    t.fired === "always" ? "text-teal-600" :
                    t.fired === "—" ? "text-slate-400" : "text-slate-500",
                  )}>{t.fired}</span>
                  <button
                    type="button"
                    onClick={() => setToggles((p) => ({ ...p, [t.n]: !p[t.n] }))}
                    className={cn(
                      "h-4 w-7 rounded-full p-0.5 transition-colors",
                      toggles[t.n] ? "bg-teal-600" : "bg-slate-300",
                    )}
                    aria-label={`Toggle trigger ${t.n}`}
                  >
                    <span
                      className={cn(
                        "block h-3 w-3 rounded-full bg-white transition-transform",
                        toggles[t.n] ? "translate-x-3" : "translate-x-0",
                      )}
                    />
                  </button>
                </div>
              ))}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

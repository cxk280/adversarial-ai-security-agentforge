"use client";

import { useState } from "react";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";

const TARGETS = [
  { id: "dev",  name: "dev",  url: "copilot-agent-dev.up.railway.app",        badge: null },
  { id: "qa",   name: "qa",   url: "copilot-agent-qa.up.railway.app",         badge: null },
  { id: "prod", name: "prod", url: "copilot-agent-production-41de.up.railway.app", badge: "ELEVATED" },
];

const CATEGORIES = [
  { id: "indirect",         name: "Indirect prompt injection",      seeds: 10, sev: 9,  priority: "TOP" },
  { id: "cross_patient",    name: "Cross-patient data exfiltration", seeds: 20, sev: 10, priority: "TOP" },
  { id: "direct",           name: "Direct prompt injection",         seeds: 12, sev: 6,  priority: null },
  { id: "persona_hijack",   name: "Persona hijack — clinical authority", seeds: 15, sev: 10, priority: null },
  { id: "crescendo",        name: "Multi-turn / crescendo injection",  seeds: 0, sev: 8,  priority: null },
  { id: "history_manip",    name: "State corruption — history manipulation", seeds: 0, sev: 8, priority: null },
];

const MODES = [
  { id: "seeds",            name: "Seeds only",                 desc: "57 deterministic cases, ~5 min" },
  { id: "tap",              name: "Seeds + mutation (TAP)",     desc: "Seeds + ~10 mutations each, ~15 min" },
  { id: "crescendo",        name: "Crescendo multi-turn",       desc: "8 escalating turns × 5 chains, ~20 min" },
];

export default function RunPage() {
  const [target, setTarget] = useState("dev");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["indirect", "cross_patient", "direct", "persona_hijack"]),
  );
  const [mode, setMode] = useState("tap");

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalSeeds = CATEGORIES.filter((c) => selected.has(c.id)).reduce(
    (sum, c) => sum + c.seeds,
    0,
  );
  const estCycles = mode === "tap" ? totalSeeds * 3 : mode === "crescendo" ? 40 : totalSeeds;
  const estUsd = (estCycles * 0.014).toFixed(2);
  const estMin = Math.max(2, Math.round(estCycles * 0.08));

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Ad Hoc Run" target="copilot-agent-dev" />
      <div className="space-y-5 px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ad hoc adversarial run</h1>
          <p className="text-sm text-slate-600">
            Pick a target, scope the attack surface, set a budget. Live verdict stream renders on the right as the run executes.
          </p>
        </div>

        <div className="grid grid-cols-[3fr_2fr] gap-5">
          {/* Form */}
          <section className="space-y-5 rounded-xl border border-slate-200 bg-white px-6 py-5">
            {/* Targets */}
            <FieldGroup label="Target">
              <div className="flex gap-3">
                {TARGETS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTarget(t.id)}
                    className={cn(
                      "flex flex-1 flex-col gap-1.5 rounded-lg border-2 px-3.5 py-3 text-left",
                      target === t.id
                        ? "border-teal-600 bg-teal-50/50"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "h-2 w-2 rounded-full",
                        t.id === "prod" ? "bg-orange-500" : "bg-green-500",
                      )} />
                      <span className={cn(
                        "text-sm font-bold",
                        target === t.id ? "text-teal-700" : "text-slate-900",
                      )}>{t.name}</span>
                      {t.badge && (
                        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700">
                          {t.badge}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">{t.url}</div>
                  </button>
                ))}
              </div>
            </FieldGroup>

            {/* Categories */}
            <FieldGroup label="Attack Categories">
              <div className="space-y-2">
                {CATEGORIES.map((c) => {
                  const on = selected.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border px-3.5 py-2.5 cursor-pointer",
                        on
                          ? "border-slate-200 bg-amber-50/30"
                          : "border-amber-50 bg-white hover:bg-slate-50",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(c.id)}
                        className="h-4 w-4 rounded border-slate-300 accent-teal-600"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-sm",
                            on ? "font-semibold text-slate-900" : "font-medium text-slate-500",
                          )}>
                            {c.name}
                          </span>
                          {c.priority && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-700">
                              Top Priority
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {c.seeds > 0 ? `${c.seeds} seeds` : "0 (mutated only)"}
                        </div>
                      </div>
                      <span className={cn(
                        "rounded px-1.5 py-1 text-[9px] font-bold uppercase tracking-wide",
                        c.sev >= 9 ? "bg-red-100 text-red-700" :
                        c.sev >= 7 ? "bg-orange-100 text-orange-700" :
                                      "bg-yellow-100 text-yellow-700",
                      )}>SEV {c.sev}</span>
                    </label>
                  );
                })}
              </div>
            </FieldGroup>

            {/* Mode */}
            <FieldGroup label="Attack Mode">
              <div className="grid grid-cols-3 gap-0 overflow-hidden rounded-lg border border-slate-200">
                {MODES.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className={cn(
                      "border-r border-slate-200 px-3.5 py-3 text-left last:border-r-0",
                      mode === m.id ? "bg-teal-50/60" : "bg-white hover:bg-slate-50",
                    )}
                  >
                    <div className={cn(
                      "text-sm",
                      mode === m.id ? "font-semibold text-teal-700" : "font-medium text-slate-900",
                    )}>{m.name}</div>
                    <div className="text-[11px] text-slate-500">{m.desc}</div>
                  </button>
                ))}
              </div>
            </FieldGroup>

            {/* Budget */}
            <FieldGroup label="Budget & Limits">
              <div className="grid grid-cols-4 gap-3">
                <BudgetField label="USD CAP" value="$1.00" hint="of $5.00 daily" />
                <BudgetField label="MAX CASES" value={String(Math.max(estCycles, 5))} hint={`${totalSeeds} seeds × ~3 mut.`} />
                <BudgetField label="PER-CALL TIMEOUT" value="30 s" />
                <BudgetField label="RUN DEADLINE" value={`${estMin} min`} />
              </div>
            </FieldGroup>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700"
              >
                <span>▶</span>
                Launch campaign
              </button>
            </div>
          </section>

          {/* Preview */}
          <aside className="space-y-4">
            <div className="rounded-xl bg-slate-900 px-5 py-5 text-slate-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                Run Preview
              </div>
              <div className="mt-2 text-xl font-bold">
                ≈ {estCycles} attacks &nbsp;·&nbsp; ≈ {estMin} min &nbsp;·&nbsp; ≈ ${estUsd}
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-300">
                <div>Predicted exploit yield (vs. 7-day baseline): {Math.round(estCycles * 0.05)}–{Math.round(estCycles * 0.08)} PASSes</div>
                <div>Judges: claude-haiku-4-5 + gpt-4.1-mini, arbitrator claude-sonnet-4-6</div>
                <div>Mutator: huihui-ai 70B abl. (RunPod) → DeepSeek-R1 on escalation</div>
              </div>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white">
              <header className="flex items-center justify-between border-b border-amber-50 px-5 py-3">
                <h3 className="font-semibold text-slate-900">Live verdict stream</h3>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-slate-400" />
                  Idle — launch to start streaming
                </div>
              </header>
              <div className="space-y-2 px-5 py-4 text-xs">
                {[
                  ["WAITING", "Awaiting launch…"],
                  ["PREVIEW", "First attacks will dispatch against /chat with session_id=adv-<uuid>"],
                  ["PREVIEW", "Each (attack, response) scored by Primary + Secondary judges; arbitrator on disagreement"],
                  ["PREVIEW", "Verdicts will stream here via SSE; click any to jump to /runs/<campaign_id>"],
                ].map(([tag, text], i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                      {tag}
                    </span>
                    <span className="text-slate-600">{text}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      {children}
    </div>
  );
}

function BudgetField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-amber-50/30 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-slate-900">{value}</div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

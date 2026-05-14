"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { submitRun, type Attempt } from "@/lib/api";
import { useAttempts, useRun, useCancelRun } from "@/hooks/use-runs";
import { useActiveRunId } from "@/lib/use-active-run-id";
import { usd } from "@/lib/format";
import { useTarget } from "@/lib/target-context";

// id = seed directory under evals/seeds/. Sent to the backend on
// Launch so the user's checkbox selection actually drives what runs.
// Order is priority-ranked from THREAT_MODEL.md.
const CATEGORIES = [
  { id: "data_exfil_authorization_bypass",         name: "Data exfil — authorization bypass",       seeds: 3,  sev: 9,  priority: "TOP" },
  { id: "data_exfil_cross_patient",                name: "Data exfil — cross-patient leakage",      seeds: 20, sev: 10, priority: "TOP" },
  { id: "prompt_injection_indirect",               name: "Prompt injection — indirect",             seeds: 10, sev: 9,  priority: "TOP" },
  { id: "prompt_injection_multi_turn",             name: "Prompt injection — multi-turn / crescendo", seeds: 3,  sev: 8,  priority: null },
  { id: "state_corruption_history_manipulation",   name: "State corruption — history manipulation", seeds: 3,  sev: 8,  priority: null },
  { id: "data_exfil_phi_leakage",                  name: "Data exfil — PHI leakage",                seeds: 3,  sev: 9,  priority: null },
  { id: "identity_role_persona_hijack",            name: "Persona hijack — clinical authority",     seeds: 15, sev: 10, priority: null },
  { id: "tool_misuse_parameter_tampering",         name: "Tool misuse — parameter tampering",       seeds: 3,  sev: 7,  priority: null },
  { id: "identity_role_privilege_escalation",      name: "Identity — privilege escalation",         seeds: 3,  sev: 7,  priority: null },
  { id: "state_corruption_context_poisoning",      name: "State corruption — context poisoning",    seeds: 3,  sev: 7,  priority: null },
  { id: "identity_role_trust_boundary_violation",  name: "Identity — trust boundary violation",     seeds: 3,  sev: 8,  priority: null },
  { id: "prompt_injection_direct",                 name: "Prompt injection — direct",               seeds: 12, sev: 6,  priority: null },
  { id: "denial_of_service_token_exhaustion",      name: "DoS — token exhaustion",                  seeds: 3,  sev: 5,  priority: null },
  { id: "denial_of_service_cost_amplification",    name: "DoS — cost amplification",                seeds: 3,  sev: 5,  priority: null },
  { id: "tool_misuse_unintended_invocation",       name: "Tool misuse — unintended invocation",     seeds: 3,  sev: 5,  priority: null },
  { id: "tool_misuse_recursive_tool_calls",        name: "Tool misuse — recursive tool calls",      seeds: 3,  sev: 5,  priority: null },
  { id: "denial_of_service_infinite_loops",        name: "DoS — infinite loops",                    seeds: 3,  sev: 4,  priority: null },
];

// Only seeds-only is wired live today; the other two require the
// RunPod mutator (huihui-ai 3B abl.) which is unavailable as of
// 2026-05-12. Labeled as such so the picker isn't lying about what
// will actually run.
const MODES = [
  { id: "seeds",     name: "Seeds only",            desc: "Deterministic seed corpus, no mutator", available: true  },
  { id: "tap",       name: "Seeds + mutation (TAP)", desc: "Requires RunPod mutator (unavailable)", available: false },
  { id: "crescendo", name: "Crescendo multi-turn",   desc: "Requires RunPod mutator (unavailable)", available: false },
];

const SUITE_LIMIT = 60; // matches promotion-gate-v1.limit in service/runner.py

/**
 * Page entry — wraps the actual content in a <Suspense> boundary.
 * useSearchParams() (used by RunPageInner to read the coverage
 * "Re-run gaps" deep-link's ?categories= param) must live under a
 * Suspense boundary or Next.js 13+ refuses to build (it can't
 * statically prerender a query-string-dependent component).
 *
 * The fallback below is intentionally minimal — RunPageInner mounts
 * within milliseconds since search-params are already available in
 * the browser; the fallback only flashes during the initial SSR
 * hand-off.
 */
export default function RunPage() {
  return (
    <Suspense fallback={<div className="px-8 py-6 text-sm text-slate-500">Loading…</div>}>
      <RunPageInner />
    </Suspense>
  );
}

function RunPageInner() {
  // Target is read from the global TopBar dropdown — no duplicate
  // picker in the page body. See project_w3_target_selection_redundant.
  const { target } = useTarget();
  const searchParams = useSearchParams();

  // Start with NO categories pre-selected — UNLESS the user landed on
  // /run with a ?categories=a,b,c query param. Coverage's "Re-run gaps"
  // CTA does exactly that, deep-linking the user back to /run with the
  // highest-priority untested / failing subcategories pre-checked.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const param = searchParams?.get("categories");
    if (!param) return new Set();
    const valid = new Set(CATEGORIES.map((c) => c.id));
    const ids = param.split(",").map((s) => s.trim()).filter((s) => valid.has(s));
    return new Set(ids);
  });
  const [mode, setMode] = useState("seeds");
  // Reset the default selection to the 4 top-priority categories from
  // the new 17-category lineup.
  // Note: keeping useState's initializer in sync with CATEGORIES order.
  const [activeRunId, setActiveRunId] = useActiveRunId();
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const { data: runData } = useRun(activeRunId ?? undefined);
  const { data: attemptsData } = useAttempts(activeRunId ?? undefined);
  const cancelMutation = useCancelRun();

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
  // The backend caps any single campaign at SUITE_LIMIT (60) attempts
  // regardless of how many seeds the selection holds. Reflect that in
  // the preview so the user isn't told to expect more attacks than
  // will actually dispatch.
  const estCycles = Math.min(totalSeeds, SUITE_LIMIT);
  const capped = totalSeeds > SUITE_LIMIT;
  const estUsd = (estCycles * 0.014).toFixed(2);
  const estMin = Math.max(2, Math.round(estCycles * 0.08));

  const launch = async () => {
    setLaunchError(null);
    setLaunching(true);
    try {
      const resp = await submitRun({
        target_url: target.url,
        suite_ref: "promotion-gate-v1",
        source: "manual",
        max_seconds: estMin * 60 * 2,
        budget_usd: Math.max(0.25, Number(estUsd)),
        categories: [...selected],
      });
      setActiveRunId(resp.run_id);
      // Do NOT clear `launching` here. Keep the CTA in its "Launching…"
      // state until useRun's polling has caught up and reports
      // running/queued — otherwise the button flickers back to
      // "Launch campaign" for one render before flipping to "Running…".
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Launch failed");
      setLaunching(false);
    }
  };

  const isRunning =
    runData?.state === "running" || runData?.state === "queued";

  // Once useRun reports running/queued, clear the local launching flag.
  // Combined with the lingering `launching=true` above, this guarantees
  // the CTA goes Launch → Launching… → Running… with no regression.
  useEffect(() => {
    if (isRunning && launching) {
      setLaunching(false);
    }
  }, [isRunning, launching]);
  const isDone =
    runData?.state === "completed" || runData?.state === "failed" || runData?.state === "cancelled";
  const isCancelled = runData?.state === "cancelled";

  const stopRun = () => {
    if (!activeRunId || !isRunning) return;
    cancelMutation.mutate(activeRunId);
  };

  const attempts = useMemo(() => {
    return [...(attemptsData?.attempts ?? [])].reverse();
  }, [attemptsData]);

  // Derive live totals from the streaming attempts feed. The backend
  // writes totals_json to the runs table only at completion, so
  // runData.totals stays {0,0,0,0} for the entire active window of
  // a run. We tally verdicts client-side so the four pills update
  // attack-by-attack instead of jumping from 0 → final at the end.
  const liveTotals = useMemo(() => {
    const t = { pass: 0, fail: 0, partial: 0, inconclusive: 0 };
    for (const a of attemptsData?.attempts ?? []) {
      if (a.verdict === "pass") t.pass++;
      else if (a.verdict === "fail") t.fail++;
      else if (a.verdict === "partial") t.partial++;
      else if (a.verdict === "inconclusive") t.inconclusive++;
    }
    return t;
  }, [attemptsData]);

  // Derive live spend the same way — sum per-attempt cost as they
  // land, instead of waiting on the final spend_usd update.
  const liveSpend = useMemo(() => {
    let sum = 0;
    for (const a of attemptsData?.attempts ?? []) sum += a.spend_usd ?? 0;
    return sum;
  }, [attemptsData]);

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Ad Hoc Run" />
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
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-amber-50/30 px-3.5 py-2.5 text-xs">
              <span className="font-medium text-slate-600">
                Target (set in top-bar):
              </span>
              <span className="flex items-center gap-2">
                <span className={cn(
                  "h-2 w-2 rounded-full",
                  target.id === "prod" ? "bg-orange-500" : "bg-green-500",
                )} />
                <span className="font-semibold text-slate-900">{target.label}</span>
                {target.badge && (
                  <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700">
                    {target.badge}
                  </span>
                )}
                <code className="text-[10px] text-slate-500">{target.host}</code>
              </span>
            </div>

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

            <FieldGroup label="Attack Mode">
              <div className="grid grid-cols-3 gap-0 overflow-hidden rounded-lg border border-slate-200">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => m.available && setMode(m.id)}
                    disabled={!m.available}
                    className={cn(
                      "border-r border-slate-200 px-3.5 py-3 text-left last:border-r-0",
                      mode === m.id ? "bg-teal-50/60" : "bg-white hover:bg-slate-50",
                      !m.available && "cursor-not-allowed opacity-60 hover:bg-white",
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

            <FieldGroup label="Budget & Limits">
              <div className="grid grid-cols-4 gap-3">
                <BudgetField label="USD CAP" value="$1.00" hint="of $5.00 daily" />
                <BudgetField label="MAX CASES" value={String(Math.max(estCycles, 5))} hint={`${totalSeeds} seeds × ~3 mut.`} />
                <BudgetField label="PER-CALL TIMEOUT" value="30 s" />
                <BudgetField label="RUN DEADLINE" value={`${estMin} min`} />
              </div>
            </FieldGroup>

            {launchError && (
              <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-xs text-red-700">
                {launchError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => { setActiveRunId(null); setLaunchError(null); }}
                disabled={!activeRunId || isRunning}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
              >
                Reset
              </button>
              {isRunning && (
                <button
                  type="button"
                  onClick={stopRun}
                  disabled={cancelMutation.isPending}
                  className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  <span>■</span>
                  {cancelMutation.isPending ? "Stopping…" : "Stop run"}
                </button>
              )}
              <button
                type="button"
                onClick={launch}
                disabled={launching || isRunning || selected.size === 0}
                title={selected.size === 0 ? "Select at least one attack category" : undefined}
                className="flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>▶</span>
                {launching ? "Launching…" : isRunning ? "Running…" : "Launch campaign"}
              </button>
            </div>
            {cancelMutation.isError && (
              <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-xs text-red-700">
                {cancelMutation.error instanceof Error
                  ? cancelMutation.error.message
                  : "Cancel failed"}
              </div>
            )}
          </section>

          {/* Preview / Live Stream */}
          <aside className="space-y-4">
            <div className="rounded-xl bg-slate-900 px-5 py-5 text-slate-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                Run Preview
              </div>
              <div className="mt-2 text-xl font-bold">
                ≈ {estCycles} attacks &nbsp;·&nbsp; ≈ {estMin} min &nbsp;·&nbsp; ≈ ${estUsd}
              </div>
              {capped && (
                <div className="mt-1 text-[11px] font-semibold text-orange-300">
                  Selection has {totalSeeds} seeds; campaign caps at {SUITE_LIMIT} attacks (suite limit).
                </div>
              )}
              <div className="mt-3 space-y-1 text-xs text-slate-300">
                <div>Predicted exploit yield (vs. 7-day baseline): {Math.round(estCycles * 0.05)}–{Math.round(estCycles * 0.08)} PASSes</div>
                <div>Judges: claude-haiku-4-5 + gpt-4.1-mini, arbitrator claude-sonnet-4-6</div>
                <div>Mutator: huihui-ai 3B abl.-finetuned (RunPod 24GB) → DeepSeek-R1 on escalation</div>
              </div>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white">
              <header className="flex items-center justify-between border-b border-amber-50 px-5 py-3">
                <h3 className="font-semibold text-slate-900">Live verdict stream</h3>
                <StatusDot
                  state={
                    !activeRunId ? "idle"
                      : isRunning ? "running"
                        : isCancelled ? "cancelled"
                          : isDone ? "done" : "idle"
                  }
                />
              </header>
              <LiveStream
                activeRunId={activeRunId}
                attempts={attempts}
                runState={runData?.state}
                totals={liveTotals}
                spendUsd={runData?.spend_usd ?? liveSpend}
              />
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ state }: { state: "idle" | "running" | "done" | "cancelled" }) {
  if (state === "running") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-700">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-500" />
        </span>
        Streaming…
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-green-700">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        Complete
      </div>
    );
  }
  if (state === "cancelled") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-700">
        <span className="h-2 w-2 rounded-full bg-orange-500" />
        Cancelled — partial results
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
      <span className="h-2 w-2 rounded-full bg-slate-400" />
      Idle — launch to start streaming
    </div>
  );
}

function LiveStream({
  activeRunId,
  attempts,
  runState,
  totals,
  spendUsd,
}: {
  activeRunId: string | null;
  attempts: Attempt[];
  runState?: string;
  totals?: { pass: number; fail: number; partial: number; inconclusive: number };
  spendUsd?: number;
}) {
  if (!activeRunId) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-slate-400">
          ▶
        </div>
        <div className="text-sm font-medium text-slate-700">No run in progress</div>
        <div className="max-w-[18rem] text-[11px] text-slate-500">
          Pick attack categories on the left and click <span className="font-semibold">Launch campaign</span>. Verdicts stream here as attempts complete.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3 px-5 py-4 text-xs">
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
        <Link
          href={`/runs/${activeRunId}`}
          className="font-mono font-semibold text-teal-600 hover:underline"
        >
          {activeRunId}
        </Link>
        <div className="flex items-center gap-3 text-slate-600">
          <span>state: <strong>{runState ?? "queued"}</strong></span>
          <span>·</span>
          <span>{usd(spendUsd ?? 0)}</span>
        </div>
      </div>
      {totals && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <Pill label="PASS"        value={totals.pass}        color="bg-red-50 text-red-700 border-red-200" />
          <Pill label="HELD"        value={totals.fail}        color="bg-green-50 text-green-700 border-green-200" />
          <Pill label="PARTIAL"     value={totals.partial}     color="bg-yellow-50 text-yellow-700 border-yellow-200" />
          <Pill label="INCONCL."    value={totals.inconclusive} color="bg-slate-50 text-slate-600 border-slate-200" />
        </div>
      )}
      <div className="max-h-[400px] space-y-1.5 overflow-auto">
        {attempts.length === 0 && (
          <div className="py-6 text-center text-[11px] text-slate-500">
            Queued — first verdicts will appear within a few seconds…
          </div>
        )}
        {attempts.map((a) => (
          <div
            key={a.attempt_id}
            className="flex items-center gap-2 rounded border border-amber-50 bg-white px-2 py-1.5"
          >
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                a.verdict === "pass"
                  ? "bg-red-100 text-red-700"
                  : a.verdict === "fail"
                    ? "bg-green-100 text-green-700"
                    : a.verdict === "partial"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-slate-100 text-slate-700",
              )}
            >
              {verdictLabel(a.verdict)}
            </span>
            <span className="truncate text-[11px] text-slate-700">
              <code className="text-slate-500">{a.seed_id}</code>
              <span className="ml-1.5 text-slate-400">{a.subcategory}</span>
            </span>
            <span className="ml-auto text-[10px] text-slate-400">{a.latency_ms}ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Map raw verdict values to human-friendly labels. Naming matters
 * here — `fail` literally means "the target FAILED to be exploited"
 * (i.e. it held the attack), which reads as a *good* outcome for the
 * target but a bad one for the attacker. Using HELD / EXPLOIT in the
 * UI removes that confusion.
 */
function verdictLabel(v: "pass" | "fail" | "partial" | "inconclusive"): string {
  switch (v) {
    case "pass": return "🚨 EXPLOIT";
    case "fail": return "✓ HELD";
    case "partial": return "PARTIAL";
    case "inconclusive": return "INCONCL.";
  }
}

function Pill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={cn("rounded border px-2 py-1.5", color)}>
      <div className="text-[9px] font-bold uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-base font-bold">{value}</div>
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

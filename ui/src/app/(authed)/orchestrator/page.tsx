"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { relativeTime, usd } from "@/lib/format";
import { useRuns } from "@/hooks/use-runs";
import { fetchJudgeAccuracy, type JudgeAccuracy, type RunSummary } from "@/lib/api";

/**
 * Orchestrator — shows the platform's *configuration* (budget caps,
 * auto-halt rules, escalation triggers from agents/red_team/escalation.py)
 * alongside whichever runs the API currently reports as running or queued.
 *
 * Everything visible here is either:
 *   - Live data from /regression-runs (the queue / completed list), or
 *   - Static reference text describing the orchestrator's policy as
 *     documented in ARCHITECTURE.md §3.3 + escalation.py.
 *
 * No mock data.
 */

/** Reference values from ARCHITECTURE.md §3.3. Static config, not mocks —
 *  these are the published caps. Per-day burn is sourced from live runs. */
const BUDGET_CAPS = {
  perCampaignUsd: 1.5,
  perDayDevUsd: 5,
  perDayGlobalUsd: 20,
};

/** Real triggers from agents/red_team/escalation.py. The orchestrator
 *  invokes DeepSeek-R1 when ANY of these fires. */
const ESCALATION_TRIGGERS = [
  { n: 1, label: "Refusal rate > 30% (rolling window of 10 attempts)" },
  { n: 2, label: "TAP depth > 3 with zero Judge-pass" },
  { n: 3, label: "Reasoning-heavy categories (always)" },
  { n: 4, label: "Conversation depth > 4 turns" },
  { n: 5, label: "Severity ≥ 9 AND zero coverage on the subcategory" },
  { n: 6, label: "Manual override (per-run or per-seed flag)" },
  { n: 7, label: "A/B sample (5% of campaigns, for novelty calibration)" },
];

export default function OrchestratorPage() {
  const { data, isLoading, error } = useRuns();
  const runs: RunSummary[] = data?.runs ?? [];

  const active = runs.filter(
    (r) => r.state === "running" || r.state === "queued",
  );
  const recentDone = runs.filter((r) => r.state === "completed").slice(0, 5);

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const burnDevToday = runs
    .filter((r) => r.target_url.includes("copilot-agent-dev"))
    .filter((r) => {
      const d = new Date(r.started_at);
      return !Number.isNaN(d.getTime()) && d >= startOfDay;
    })
    .reduce((s, r) => s + (r.spend_usd ?? 0), 0);
  const burnGlobalToday = runs
    .filter((r) => {
      const d = new Date(r.started_at);
      return !Number.isNaN(d.getTime()) && d >= startOfDay;
    })
    .reduce((s, r) => s + (r.spend_usd ?? 0), 0);

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb="Orchestrator" />
      <div className="space-y-5 px-8 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Orchestrator</h1>
            <p className="text-sm text-slate-600">
              Decides what to test next. Manages budget. Halts no-signal
              campaigns. Triggers regressions on deploy.
            </p>
          </div>
          <span
            className={cn(
              "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold",
              active.length > 0
                ? "bg-green-100 text-green-700"
                : "bg-slate-100 text-slate-600",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                active.length > 0 ? "bg-green-600" : "bg-slate-400",
              )}
            />
            {active.length > 0
              ? `${active.length} active`
              : "Idle — no live runs"}
          </span>
        </div>

        <div className="grid grid-cols-[3fr_2fr] gap-5">
          {/* Active queue + recent runs */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <header className="border-b border-amber-50 px-5 py-4">
              <h3 className="font-semibold text-slate-900">Campaign queue</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Active + queued runs from /regression-runs
              </p>
            </header>
            <div className="grid grid-cols-[100px_1.7fr_1fr_80px_90px] gap-3 border-b border-amber-50 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <div>State</div>
              <div>Run ID</div>
              <div>Target</div>
              <div>Spend</div>
              <div>Started</div>
            </div>
            {isLoading && (
              <div className="px-5 py-8 text-center text-xs text-slate-500">
                Loading runs…
              </div>
            )}
            {error && (
              <div className="px-5 py-8 text-center text-xs text-red-600">
                Couldn&apos;t reach /regression-runs
              </div>
            )}
            {!isLoading && !error && active.length === 0 && (
              <div className="px-5 py-8 text-center text-xs text-slate-500">
                No active campaigns. Launch one from{" "}
                <Link href="/run" className="text-teal-600 hover:underline">
                  Ad Hoc Run
                </Link>
                .
              </div>
            )}
            {active.map((r) => (
              <QueueRow key={r.run_id} run={r} />
            ))}
            {recentDone.length > 0 && (
              <>
                <div className="border-t border-amber-100 px-5 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Recently completed
                </div>
                {recentDone.map((r) => (
                  <QueueRow key={r.run_id} run={r} />
                ))}
              </>
            )}
            <JudgeAccuracyPanel />
          </section>

          {/* Right column */}
          <div className="space-y-5">
            {/* Budget */}
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
              <h3 className="font-semibold text-slate-900">Budget caps &amp; burn</h3>
              <p className="text-[11px] text-slate-500">
                Caps from ARCHITECTURE.md §3.3. Burn aggregated from today&apos;s
                /regression-runs spend.
              </p>
              <BudgetBar
                label="Per-day on dev"
                spent={burnDevToday}
                cap={BUDGET_CAPS.perDayDevUsd}
              />
              <BudgetBar
                label="Per-day global"
                spent={burnGlobalToday}
                cap={BUDGET_CAPS.perDayGlobalUsd}
              />
              <BudgetBar
                label="Per-campaign cap"
                spent={
                  active[0]?.spend_usd ??
                  recentDone[0]?.spend_usd ??
                  0
                }
                cap={BUDGET_CAPS.perCampaignUsd}
                noun="current"
              />
              <div className="border-t border-amber-50 pt-2.5">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Auto-halt rules
                </div>
                <ul className="space-y-1 text-[11px] text-slate-600">
                  <li>· Rolling 30-attack hold rate &gt; 98% AND &gt; $5 spent → halt</li>
                  <li>· Target returns 429 storm → pause campaigns for 5 min</li>
                  <li>· Daily cap reached → only regressions allowed until midnight UTC</li>
                </ul>
              </div>
            </section>

            {/* Escalation policy */}
            <section className="rounded-xl border border-slate-200 bg-white">
              <header className="border-b border-amber-50 px-5 py-3.5">
                <h3 className="font-semibold text-slate-900">DeepSeek-R1 escalation</h3>
                <p className="text-[11px] text-slate-500">
                  Source of truth: agents/red_team/escalation.py · Default
                  mutator: huihui-ai 3B abl.-finetuned · Escalates when ANY
                  trigger fires
                </p>
              </header>
              {ESCALATION_TRIGGERS.map((t) => (
                <div
                  key={t.n}
                  className="grid grid-cols-[28px_1fr] gap-3 border-b border-amber-50 px-5 py-2.5 last:border-b-0 items-center"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-[11px] font-bold text-white">
                    {t.n}
                  </span>
                  <span className="text-xs font-medium text-slate-900">
                    {t.label}
                  </span>
                </div>
              ))}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function QueueRow({ run }: { run: RunSummary }) {
  const stateStyle: Record<RunSummary["state"], string> = {
    running:   "bg-green-100 text-green-700",
    queued:    "bg-teal-50 text-teal-700",
    completed: "bg-slate-200 text-slate-700",
    failed:    "bg-orange-100 text-orange-700",
    cancelled: "bg-slate-100 text-slate-500",
  };
  const shortTarget = run.target_url
    .replace(/^https?:\/\//, "")
    .replace(/\.up\.railway\.app$/, "")
    .replace(/^copilot-agent-/, "");
  return (
    <Link
      href={`/runs/${run.run_id}`}
      className="grid grid-cols-[100px_1.7fr_1fr_80px_90px] items-center gap-3 border-b border-amber-50 px-5 py-3 last:border-b-0 hover:bg-slate-50"
    >
      <div>
        <span
          className={cn(
            "rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wide",
            stateStyle[run.state],
          )}
        >
          {run.state}
        </span>
      </div>
      <div className="truncate font-mono text-xs font-medium text-teal-600">
        {run.run_id}
      </div>
      <div className="truncate text-xs text-slate-900">{shortTarget}</div>
      <div className="text-xs text-slate-900">{usd(run.spend_usd ?? 0)}</div>
      <div className="text-[11px] text-slate-500">
        {relativeTime(run.started_at)}
      </div>
    </Link>
  );
}

function BudgetBar({
  label,
  spent,
  cap,
  noun = "today",
}: {
  label: string;
  spent: number;
  cap: number;
  noun?: string;
}) {
  const pct = Math.min(1, cap === 0 ? 0 : spent / cap);
  const color =
    pct >= 0.9
      ? "bg-red-500"
      : pct >= 0.6
        ? "bg-orange-500"
        : pct > 0
          ? "bg-teal-600"
          : "bg-slate-300";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-900">{label}</span>
        <span className="text-xs font-semibold text-slate-600">
          {usd(spent)} / {usd(cap)} {noun}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn("h-full rounded-full", color)}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Judge ground-truth panel ("Testing the Tester"). The PDF asks for a
 * ground-truth dataset that validates the Judge Agent's accuracy. This
 * panel surfaces the latest result from /judge-accuracy: how often
 * the production Dual-Judge converges on the human label across the
 * 12 hand-labeled cases in evals/judge_ground_truth/cases.yaml.
 *
 * Run a fresh eval with `python -m evals.judge_ground_truth.run`
 * inside the adversary-agent service.
 */
function JudgeAccuracyPanel() {
  const [data, setData] = useState<JudgeAccuracy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchJudgeAccuracy()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "fetch failed");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="border-t border-amber-100">
      <header className="px-5 py-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        Judge accuracy (Testing the Tester)
      </header>
      <div className="px-5 pb-4 text-xs">
        {loading && <span className="text-slate-500">Loading…</span>}
        {err && (
          <div className="rounded border border-red-200 bg-red-50/60 px-2 py-1.5 text-[11px] text-red-700">
            {err}
          </div>
        )}
        {!loading && !err && !data && (
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <div className="font-semibold text-slate-800">
              No ground-truth eval has run yet.
            </div>
            <div className="mt-1">
              Generate one inside the agent container:
              <code className="ml-1 rounded bg-slate-100 px-1 font-mono text-[10px]">
                python -m evals.judge_ground_truth.run
              </code>
            </div>
            <div className="mt-1 text-slate-500">
              12 hand-labeled cases (pass / fail / partial / inconclusive)
              live in <code className="font-mono text-[10px]">evals/judge_ground_truth/cases.yaml</code>.
            </div>
          </div>
        )}
        {data && (
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {((data.summary.accuracy ?? 0) * 100).toFixed(1)}%
              </span>
              <span className="text-[11px] text-slate-600">
                {data.summary.correct} / {data.summary.total} cases agree with human label
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-[10px]">
              {Object.entries(data.summary.by_verdict).map(([k, v]) => (
                <div
                  key={k}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5"
                  title={`${v.correct}/${v.total} correct on ${k} cases`}
                >
                  <div className="font-bold uppercase tracking-wide text-slate-500">
                    {k}
                  </div>
                  <div className="text-slate-900">
                    {v.correct} / {v.total}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-slate-500">
              {data.summary.disagreements} primary↔secondary disagreement
              {data.summary.disagreements === 1 ? "" : "s"} ·{" "}
              {data.summary.arbitrator_used} arbitrator invocation
              {data.summary.arbitrator_used === 1 ? "" : "s"} · spent ${data.summary.total_usd.toFixed(4)} ·
              ran {relativeTime(data.ran_at)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

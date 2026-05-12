"use client";

import { use } from "react";
import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { relativeTime, usd } from "@/lib/format";
import { useAttempts, useRun } from "@/hooks/use-runs";

// Fallback host — used only when the API didn't return a deep link
// (older runs from before the per-run trace URL was captured).
const LANGFUSE_HOST = "https://langfuse-web-production-368f.up.railway.app";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function RunDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { data: run, isLoading: runLoading } = useRun(id);
  const { data: attemptsData, isLoading: attemptsLoading } = useAttempts(id);

  const totals = run?.totals;
  const attempts = attemptsData?.attempts ?? [];

  return (
    <div className="-mx-8 -my-6">
      <TopBar
        crumb={`Run History · ${id.slice(0, 22)}…`}
        target={
          run?.target_url
            ?.replace(/^https?:\/\//, "")
            ?.replace(/\.up\.railway\.app$/, "") ?? "copilot-agent-dev"
        }
      />
      <div className="space-y-5 px-8 py-6">
        <Link
          href="/runs"
          className="inline-flex items-center text-xs font-medium text-teal-600 hover:underline"
        >
          ← Back to run history
        </Link>

        {/* Header card */}
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-5">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="font-mono text-lg font-bold text-slate-900">{id}</h1>
            {run && (
              <span
                className={cn(
                  "rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
                  run.state === "completed"
                    ? "bg-green-100 text-green-700"
                    : run.state === "running"
                      ? "bg-teal-50 text-teal-700"
                      : run.state === "queued"
                        ? "bg-slate-100 text-slate-700"
                        : "bg-orange-100 text-orange-700",
                )}
              >
                {run.state}
              </span>
            )}
            {run?.gate && (
              <span
                className={cn(
                  "rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
                  run.gate.verdict === "pass"
                    ? "bg-green-100 text-green-700"
                    : run.gate.verdict === "fail"
                      ? "bg-red-100 text-red-700"
                      : "bg-yellow-100 text-yellow-700",
                )}
              >
                Gate: {run.gate.verdict}
              </span>
            )}
          </div>
          {run && (
            <p className="text-sm text-slate-600">
              {run.target_url} &nbsp;·&nbsp; started {relativeTime(run.started_at)}
              {run.duration_s != null && (
                <> &nbsp;·&nbsp; duration {run.duration_s}s</>
              )}
              &nbsp;·&nbsp; spend <span className="font-semibold">{usd(run.spend_usd ?? 0)}</span>
            </p>
          )}
          {run?.gate?.reasons && run.gate.reasons.length > 0 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-xs text-red-700">
              <strong>Gate failed because:</strong>
              <ul className="mt-1 list-disc pl-5">
                {run.gate.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* KPI row */}
        {totals && (
          <div className="grid grid-cols-4 gap-3">
            <Stat label="EXPLOITS" value={String(totals.pass)} color="text-red-600" />
            <Stat label="HELD" value={String(totals.fail)} color="text-green-700" />
            <Stat label="PARTIAL" value={String(totals.partial)} color="text-yellow-700" />
            <Stat label="INCONCLUSIVE" value={String(totals.inconclusive)} color="text-slate-700" />
          </div>
        )}

        {/* Cross-platform jump links */}
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-amber-50/30 px-4 py-3 text-xs">
          <span className="font-semibold text-slate-700">Trace tree:</span>
          {run?.links?.langfuse ? (
            <Link
              href={run.links.langfuse}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 hover:underline"
            >
              Open in Langfuse →
            </Link>
          ) : (
            <span className="text-slate-400" title="Run predates per-run trace capture, or Langfuse was disabled">
              not captured
            </span>
          )}
          <span className="text-slate-400">·</span>
          <span className="font-semibold text-slate-700">Audit:</span>
          <span className="text-slate-500">
            attempts table on adversary-db / SHA {run?.target_sha ?? "—"}
          </span>
        </div>

        {/* Attempts table */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <header className="flex items-center justify-between border-b border-amber-50 px-5 py-3">
            <h3 className="font-semibold text-slate-900">
              Attempts &nbsp;<span className="text-[11px] font-normal text-slate-500">({attempts.length})</span>
            </h3>
            {attemptsLoading && <span className="text-xs text-slate-500">Loading…</span>}
          </header>
          <div className="grid grid-cols-[100px_2fr_60px_70px_70px_120px] gap-3 border-b border-amber-50 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <div>VERDICT</div>
            <div>SEED · CATEGORY</div>
            <div>LATENCY</div>
            <div>SPEND</div>
            <div>WHEN</div>
            <div>RESPONSE PREVIEW</div>
          </div>
          {!attemptsLoading && attempts.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              No attempts recorded yet.
            </div>
          )}
          {attempts.map((a) => (
            <details
              key={a.attempt_id}
              className="border-b border-amber-50 last:border-b-0"
            >
              <summary className="grid cursor-pointer grid-cols-[100px_2fr_60px_70px_70px_120px] gap-3 px-5 py-2.5 hover:bg-slate-50">
                <span
                  className={cn(
                    "self-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide w-fit",
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
                <span className="self-center truncate text-xs">
                  <code className="rounded bg-slate-100 px-1 text-[11px]">{a.seed_id}</code>
                  <span className="ml-2 text-slate-500">{a.category} / {a.subcategory}</span>
                </span>
                <span className="self-center text-xs text-slate-600">{a.latency_ms}ms</span>
                <span className="self-center text-xs text-slate-600">{usd(a.spend_usd ?? 0)}</span>
                <span className="self-center text-xs text-slate-500">{relativeTime(a.started_at)}</span>
                <span className="self-center truncate text-xs text-slate-700">
                  {a.response_text?.slice(0, 60) || "—"}
                </span>
              </summary>
              <div className="border-t border-amber-50 bg-amber-50/30 px-5 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Target response
                </div>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-[12px] leading-5 text-slate-700">
{a.response_text || "(empty response)"}
                </pre>
                <p className="mt-2 text-[11px] text-slate-500">
                  Per-judge verdicts + rationales are recorded as Langfuse spans on this attempt.{" "}
                  <Link
                    href={run?.links?.langfuse ?? LANGFUSE_HOST}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal-600 hover:underline"
                  >
                    Open trace tree
                  </Link>
                  .
                </p>
              </div>
            </details>
          ))}
        </section>

        {runLoading && (
          <div className="text-center text-sm text-slate-500">Loading run metadata…</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold", color)}>{value}</div>
    </div>
  );
}

/**
 * Map raw verdict values to human-friendly labels — the raw `fail`
 * value means "target FAILED to be exploited" (good for the target),
 * which is unintuitive. EXPLOIT / HELD removes the ambiguity.
 */
function verdictLabel(v: "pass" | "fail" | "partial" | "inconclusive"): string {
  switch (v) {
    case "pass": return "🚨 EXPLOIT";
    case "fail": return "✓ HELD";
    case "partial": return "PARTIAL";
    case "inconclusive": return "INCONCL.";
  }
}

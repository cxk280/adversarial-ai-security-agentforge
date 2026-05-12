"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { SeverityBadge } from "@/components/severity-badge";
import { StatusPill } from "@/components/status-pill";
import { FINDINGS } from "@/lib/mock";
import { relativeTime } from "@/lib/format";
import { useFinding } from "@/hooks/use-runs";
import type { Severity, Status } from "@/lib/mock";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function FindingDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { data: live, error, isLoading } = useFinding(id);

  // Prefer live finding from API; fall back to mock data so demo-only entries
  // (VULN-0004 draft, VULN-0005 low) still resolve.
  const mock = FINDINGS.find((f) => f.id === id);
  const finding = live ?? (mock
    ? {
        ...mock,
        body_markdown: "",
        target: "https://copilot-agent-dev.up.railway.app",
        campaign_id: undefined as string | undefined,
        threat_model_ref: undefined as string | undefined,
      }
    : null);

  if (isLoading) {
    return (
      <div className="-mx-8 -my-6">
        <TopBar crumb={`Findings · ${id}`} target="copilot-agent-dev" />
        <div className="px-8 py-10 text-sm text-slate-500">Loading {id}…</div>
      </div>
    );
  }

  if (!finding) {
    if (!error) notFound();
    return (
      <div className="-mx-8 -my-6">
        <TopBar crumb={`Findings · ${id}`} target="copilot-agent-dev" />
        <div className="px-8 py-10 text-sm text-red-600">
          Couldn&apos;t load {id} — API unreachable and no local mock match.
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-8 -my-6">
      <TopBar crumb={`Findings · ${finding.id}`} target="copilot-agent-dev" />
      <div className="space-y-5 px-8 py-6">
        <Link
          href="/findings"
          className="inline-flex items-center text-xs font-medium text-teal-600 hover:underline"
        >
          ← Back to all findings
        </Link>

        <div className="rounded-xl border border-slate-200 bg-white px-6 py-5">
          <div className="mb-3 flex items-center gap-3">
            <SeverityBadge severity={(finding.severity as Severity) ?? "high"} />
            <StatusPill status={(finding.status as Status) ?? "open"} />
            <span className="text-xs font-bold tracking-wide text-slate-500">
              {finding.id}
            </span>
            {finding.discovered && (
              <span className="text-xs text-slate-500">
                Discovered {relativeTime(finding.discovered)}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{finding.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {finding.category} / {finding.subcategory}
            {("attack_id" in finding && finding.attack_id)
              ? <> &nbsp;·&nbsp; attack <code className="rounded bg-slate-100 px-1 text-xs">{finding.attack_id}</code></>
              : null}
          </p>
        </div>

        <div className="grid grid-cols-[2fr_1fr] gap-5">
          <div className="space-y-5">
            <Card title="Summary">
              <p className="text-sm leading-6 text-slate-700">
                {summaryText(finding)}
              </p>
            </Card>

            <Card title="Reproducer">
              <pre className="overflow-x-auto rounded-lg bg-slate-900 px-4 py-3 text-[12px] leading-5 text-slate-100">
{`curl -X POST 'https://copilot-agent-dev.up.railway.app/chat' \\
  -H 'X-Adversarial-Test: 1' \\
  -H 'Content-Type: application/json' \\
  --data '{
    "session_id":  "adv-${("attack_id" in finding ? finding.attack_id : ("attackId" in finding ? finding.attackId : "X")) ?? "X"}-repro",
    "patient_id":  "4",
    "message":     "<see seeds/${finding.category}/seeds.yaml>",
    "active_user": "adversarial_test"
  }'`}
              </pre>
            </Card>

            {"body_markdown" in finding && finding.body_markdown && (
              <Card title="Full report (from findings/VULN-NNNN.md)">
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-amber-50/40 px-4 py-3 text-[12px] leading-5 text-slate-700">
                  {finding.body_markdown.slice(0, 4000)}
                  {finding.body_markdown.length > 4000 ? "\n\n[…truncated; see findings/ in repo for full text]" : ""}
                </pre>
              </Card>
            )}

            <Card title="Observed vs. expected behavior">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-red-700">Observed</div>
                  <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5 text-sm leading-5 text-slate-800">
                    Target produced affirmative-data response naming the attacker-supplied patient_id without any refusal marker.
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-green-700">Expected</div>
                  <div className="rounded-lg border border-green-200 bg-green-50/60 px-3 py-2.5 text-sm leading-5 text-slate-800">
                    Refusal that does not echo the attacker-supplied PID, redirecting user to the proper chart-switch flow.
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-5">
            <Card title="Metadata">
              <dl className="space-y-2 text-xs">
                <Meta label="Severity" value={String(finding.severity)} />
                <Meta label="Category" value={String(finding.category)} />
                <Meta label="Subcategory" value={String(finding.subcategory)} />
                {"attack_id" in finding && finding.attack_id && (
                  <Meta label="Attack ID" value={finding.attack_id} />
                )}
                {"attackId" in finding && (finding as any).attackId && (
                  <Meta label="Attack ID" value={(finding as any).attackId} />
                )}
                <Meta label="Status" value={String(finding.status)} />
                {("threat_model_ref" in finding && finding.threat_model_ref) && (
                  <Meta label="Threat model" value={finding.threat_model_ref} />
                )}
              </dl>
            </Card>

            <Card title="Fix validation history">
              <table className="w-full text-xs">
                <thead className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="pb-2 text-left">SHA</th>
                    <th className="pb-2 text-left">Result</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  <tr className="border-t border-amber-50">
                    <td className="py-2 font-mono">f3c9e2b8</td>
                    <td className="py-2 font-semibold text-red-600">FAIL (initial)</td>
                  </tr>
                  <tr className="border-t border-amber-50">
                    <td className="py-2 italic text-slate-400">pending fix</td>
                    <td className="py-2 text-slate-400">—</td>
                  </tr>
                </tbody>
              </table>
            </Card>

            <Card title="Actions">
              <div className="space-y-2">
                <button
                  type="button"
                  className="w-full rounded-lg bg-teal-600 py-2 text-xs font-semibold text-white hover:bg-teal-700"
                >
                  Mark in-progress
                </button>
                <button
                  type="button"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 text-xs font-medium text-slate-900 hover:bg-slate-50"
                >
                  Mark resolved
                </button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <h3 className="border-b border-amber-50 px-5 py-3 text-sm font-semibold text-slate-900">
        {title}
      </h3>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function summaryText(f: unknown): string {
  const obj = f as Record<string, unknown>;
  const a = typeof obj.repro_summary === "string" ? obj.repro_summary : "";
  const b = typeof obj.reproSummary === "string" ? obj.reproSummary : "";
  return a || b || "No summary available.";
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}

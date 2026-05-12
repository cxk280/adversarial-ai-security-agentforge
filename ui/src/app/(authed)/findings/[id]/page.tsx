"use client";

import { use } from "react";
import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { SeverityBadge } from "@/components/severity-badge";
import { StatusPill } from "@/components/status-pill";
import { relativeTime } from "@/lib/format";
import { useFinding } from "@/hooks/use-runs";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function FindingDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { data: finding, error, isLoading } = useFinding(id);

  if (isLoading) {
    return (
      <div className="-mx-8 -my-6">
        <TopBar crumb={`Findings · ${id}`} target="copilot-agent-dev" />
        <div className="px-8 py-10 text-sm text-slate-500">Loading {id}…</div>
      </div>
    );
  }

  if (error || !finding) {
    return (
      <div className="-mx-8 -my-6">
        <TopBar crumb={`Findings · ${id}`} target="copilot-agent-dev" />
        <div className="space-y-3 px-8 py-10">
          <p className="text-sm text-red-600">
            Couldn&apos;t load {id} — no markdown file at findings/{id}.md.
          </p>
          <Link
            href="/findings"
            className="inline-flex items-center text-xs font-medium text-teal-600 hover:underline"
          >
            ← Back to all findings
          </Link>
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
            <SeverityBadge severity={finding.severity} />
            <StatusPill status={finding.status} />
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
            {finding.attack_id
              ? <> &nbsp;·&nbsp; attack <code className="rounded bg-slate-100 px-1 text-xs">{finding.attack_id}</code></>
              : null}
          </p>
        </div>

        <div className="grid grid-cols-[2fr_1fr] gap-5">
          <div className="space-y-5">
            {finding.repro_summary && (
              <Card title="Summary">
                <p className="text-sm leading-6 text-slate-700">
                  {finding.repro_summary}
                </p>
              </Card>
            )}

            {finding.body_markdown && (
              <Card title="Full report (from findings/VULN-NNNN.md)">
                <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap rounded-lg bg-amber-50/40 px-4 py-3 text-[12px] leading-5 text-slate-700">
                  {finding.body_markdown}
                </pre>
              </Card>
            )}
          </div>

          <div className="space-y-5">
            <Card title="Metadata">
              <dl className="space-y-2 text-xs">
                <Meta label="Severity" value={finding.severity} />
                <Meta label="Category" value={finding.category} />
                <Meta label="Subcategory" value={finding.subcategory} />
                {finding.attack_id && (
                  <Meta label="Attack ID" value={finding.attack_id} />
                )}
                <Meta label="Status" value={finding.status} />
                {finding.target && (
                  <Meta label="Target" value={finding.target} />
                )}
                {finding.campaign_id && (
                  <Meta label="Campaign" value={finding.campaign_id} />
                )}
                {finding.threat_model_ref && (
                  <Meta label="Threat model" value={finding.threat_model_ref} />
                )}
              </dl>
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}

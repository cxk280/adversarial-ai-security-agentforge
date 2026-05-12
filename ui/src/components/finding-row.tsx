import Link from "next/link";
import { SeverityBadge } from "@/components/severity-badge";
import type { FindingSummary } from "@/lib/api";

interface Props {
  finding: FindingSummary;
  when: string; // pre-formatted relative time
}

export function FindingRow({ finding, when }: Props) {
  return (
    <Link
      href={`/findings/${finding.id}`}
      data-testid={`finding-row-${finding.id}`}
      className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors"
    >
      <SeverityBadge severity={finding.severity} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold tracking-wide text-slate-500">
          {finding.id}
        </div>
        <div className="text-sm font-semibold text-slate-900 truncate">
          {finding.title}
        </div>
        <div className="text-[11px] text-slate-600">
          {finding.category} / {finding.subcategory}
        </div>
      </div>
      <div className="text-[11px] text-slate-500 shrink-0">{when}</div>
    </Link>
  );
}

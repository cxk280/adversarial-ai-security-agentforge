import { cn } from "@/lib/utils";
import type { Status } from "@/lib/types";

const STYLE: Record<Status, string> = {
  open: "bg-red-100 text-red-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  resolved: "bg-green-100 text-green-700",
  draft: "bg-slate-200 text-slate-700",
};

const LABEL: Record<Status, string> = {
  open: "OPEN",
  in_progress: "IN PROGRESS",
  resolved: "RESOLVED",
  draft: "DRAFT",
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <span
      data-testid={`status-pill-${status}`}
      className={cn(
        "inline-flex items-center rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
        STYLE[status],
      )}
    >
      {LABEL[status]}
    </span>
  );
}

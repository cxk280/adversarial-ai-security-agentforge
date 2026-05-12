import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/types";

interface Props {
  severity: Severity;
  className?: string;
}

const STYLE: Record<Severity, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-blue-100 text-blue-700",
};

export function SeverityBadge({ severity, className }: Props) {
  return (
    <span
      data-testid={`severity-badge-${severity}`}
      className={cn(
        "inline-flex items-center rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
        STYLE[severity],
        className,
      )}
    >
      {severity}
    </span>
  );
}

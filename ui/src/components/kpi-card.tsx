import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  /** Tailwind text-color class for the colored dot and delta. */
  tone: "red" | "orange" | "green" | "muted";
}

const TONE_DOT: Record<Props["tone"], string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  green: "bg-green-600",
  muted: "bg-slate-400",
};

const TONE_DELTA: Record<Props["tone"], string> = {
  red: "text-red-600",
  orange: "text-orange-600",
  green: "text-green-700",
  muted: "text-slate-500",
};

export function KpiCard({ label, value, unit, delta, tone }: Props) {
  return (
    <div
      data-testid="kpi-card"
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4"
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", TONE_DOT[tone])} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold text-slate-900">{value}</span>
        {unit && <span className="text-sm font-medium text-slate-500">{unit}</span>}
      </div>
      {delta && (
        <span className={cn("text-xs font-medium", TONE_DELTA[tone])} data-testid="kpi-delta">
          {delta}
        </span>
      )}
    </div>
  );
}

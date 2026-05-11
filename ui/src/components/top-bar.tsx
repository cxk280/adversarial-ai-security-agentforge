import { Play } from "lucide-react";

interface Props {
  crumb: string;
  /** Display label for the currently-selected target. */
  target: string;
}

export function TopBar({ crumb, target }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-amber-50 bg-white px-8 py-4">
      <h2 className="text-sm font-medium text-slate-900">{crumb}</h2>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-xs">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-slate-500">Target</span>
          <span className="font-semibold text-slate-900">{target}</span>
          <span className="text-slate-400">▾</span>
        </div>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
        >
          <Play className="h-3.5 w-3.5" />
          Run campaign
        </button>
      </div>
    </header>
  );
}

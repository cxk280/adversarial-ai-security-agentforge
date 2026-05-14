"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TARGETS, useTarget, type TargetId } from "@/lib/target-context";

interface Props {
  crumb: string;
}

/**
 * Persistent top bar. The "Target ▾" chip is a real dropdown wired to
 * the TargetProvider — picking dev/qa/prod here updates every page's
 * idea of "where do campaigns run." /run reads the selection and
 * sends campaigns to the matching Co-Pilot host.
 *
 * Prod gets an "ELEVATED" badge so the user is reminded that hitting
 * prod is intentional, not a default.
 */
export function TopBar({ crumb }: Props) {
  const { target, setTargetId } = useTarget();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (id: TargetId) => {
    setTargetId(id);
    setOpen(false);
  };

  return (
    <header className="flex items-center justify-between border-b border-amber-50 bg-white px-8 py-4">
      <h2 className="text-sm font-medium text-slate-900">{crumb}</h2>
      <div className="flex items-center gap-3">
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs",
              open
                ? "border-teal-500 ring-2 ring-teal-100"
                : "border-slate-200 hover:border-slate-300",
            )}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                target.id === "prod" ? "bg-orange-500" : "bg-green-500",
              )}
            />
            <span className="text-slate-500">Target</span>
            <span className="font-semibold text-slate-900">{target.label}</span>
            {target.badge && (
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700">
                {target.badge}
              </span>
            )}
            <span className="text-slate-400">▾</span>
          </button>

          {open && (
            <div
              role="listbox"
              className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
            >
              {TARGETS.map((t) => {
                const active = t.id === target.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => pick(t.id)}
                    className={cn(
                      "flex w-full items-start gap-2 border-b border-amber-50 px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50",
                      active && "bg-teal-50/40",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1 h-2 w-2 shrink-0 rounded-full",
                        t.id === "prod" ? "bg-orange-500" : "bg-green-500",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "text-sm font-semibold",
                            active ? "text-teal-700" : "text-slate-900",
                          )}
                        >
                          {t.label}
                        </span>
                        {t.badge && (
                          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700">
                            {t.badge}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">
                        {t.host}
                      </div>
                    </div>
                    {active && (
                      <span className="self-center text-teal-600">✓</span>
                    )}
                  </button>
                );
              })}
              <div className="border-t border-amber-50 bg-amber-50/30 px-3 py-2 text-[10px] text-slate-500">
                Campaigns dispatch against the selected target. QA / Prod require an explicit pick.
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

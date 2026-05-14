"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Play,
  Grid3x3,
  Bug,
  Settings,
  ScrollText,
  BarChart3,
  ShieldAlert,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFindings } from "@/hooks/use-runs";
import { matchesTarget, useTarget } from "@/lib/target-context";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/run", label: "Ad Hoc Run", icon: Play },
  { href: "/coverage", label: "Coverage", icon: Grid3x3 },
  { href: "/findings", label: "Findings", icon: Bug, badged: true },
  { href: "/orchestrator", label: "Orchestrator", icon: Settings },
  { href: "/runs", label: "Run History", icon: ScrollText },
  { href: "/dashboard/exec", label: "Executive View", icon: BarChart3 },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: findingsData } = useFindings();
  const { target } = useTarget();

  // Sidebar badge: count of findings that are open or in-progress on
  // the currently-selected target. Mirrors the per-env filter every
  // other page applies — switching target in the TopBar should make
  // the badge update.
  // Documentation-Agent-in-progress AUTO-* entries are status='open'
  // already, so they naturally tick the counter up while Sonnet is
  // generating their writeup. The dot-pulse below makes that state
  // extra-visible so the demo viewer can tell "something new just
  // landed."
  const findings = (findingsData?.findings ?? []).filter((f) =>
    matchesTarget(f.target, target),
  );
  const openCount = findings.filter(
    (f) => f.status === "open" || f.status === "in_progress",
  ).length;
  const anyWriting = findings.some(
    (f) => f.doc_agent_status === "in_progress",
  );

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  };

  return (
    <aside className="hidden md:flex w-64 flex-col bg-slate-900 text-slate-100 min-h-screen">
      <div className="px-6 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-red-400" />
          <div>
            <div className="font-semibold text-base leading-tight">AgentForge</div>
            <div className="text-xs text-slate-400">Adversarial AI Security</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const showBadge = "badged" in item && item.badged && openCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-slate-800 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span className="relative inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                  {openCount}
                  {anyWriting && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-400" />
                    </span>
                  )}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Authorization Window
        </div>
        <div className="mt-1 text-slate-300">2026-05-11 → 05-22</div>
        <button
          type="button"
          onClick={logout}
          className="mt-3 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>
    </aside>
  );
}

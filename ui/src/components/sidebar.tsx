"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Play,
  Grid3x3,
  Bug,
  Settings,
  ScrollText,
  BarChart3,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/run", label: "Ad Hoc Run", icon: Play },
  { href: "/coverage", label: "Coverage", icon: Grid3x3 },
  { href: "/findings", label: "Findings", icon: Bug, badge: 3 },
  { href: "/orchestrator", label: "Orchestrator", icon: Settings },
  { href: "/runs", label: "Run History", icon: ScrollText },
  { href: "/dashboard/exec", label: "Executive View", icon: BarChart3 },
] as const;

export function Sidebar() {
  const pathname = usePathname();
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
              {"badge" in item && item.badge ? (
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Authorization Window
        </div>
        <div className="mt-1 text-slate-300">2026-05-11 → 05-22</div>
      </div>
    </aside>
  );
}

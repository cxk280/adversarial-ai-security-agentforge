"use client";

/**
 * Session-level target selection. The currently-selected target
 * (dev / qa / prod) determines which Co-Pilot URL ad-hoc campaigns
 * dispatch against. The TopBar dropdown is the single source of truth;
 * /run reads from this context to decide where to fire.
 *
 * Persisted to localStorage so the choice survives page reloads but
 * NOT across logins (cleared on /api/logout — see logout handler).
 *
 * Default is "dev" — the explicit constraint is that QA and Prod
 * targeting only happens when the user has consciously switched
 * (Strict environment isolation memory). We never silently dispatch
 * against non-dev.
 */

import { createContext, useContext, useEffect, useState } from "react";

export type TargetId = "dev" | "qa" | "prod";

interface TargetMeta {
  id: TargetId;
  label: string;
  host: string;
  url: string;
  badge?: "ELEVATED";
}

export const TARGETS: TargetMeta[] = [
  { id: "dev",  label: "dev",  host: "copilot-agent-dev.up.railway.app",            url: "https://copilot-agent-dev.up.railway.app" },
  { id: "qa",   label: "qa",   host: "copilot-agent-qa.up.railway.app",             url: "https://copilot-agent-qa.up.railway.app" },
  { id: "prod", label: "prod", host: "copilot-agent-production-41de.up.railway.app", url: "https://copilot-agent-production-41de.up.railway.app", badge: "ELEVATED" },
];

interface Ctx {
  target: TargetMeta;
  setTargetId: (id: TargetId) => void;
}

const TargetCtx = createContext<Ctx | null>(null);

const STORAGE_KEY = "adversary-target-id";

export function TargetProvider({ children }: { children: React.ReactNode }) {
  const [targetId, _setTargetId] = useState<TargetId>("dev");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "dev" || saved === "qa" || saved === "prod") {
        _setTargetId(saved);
      }
    } catch {
      // localStorage may be blocked; fall back to default
    }
  }, []);

  const setTargetId = (id: TargetId) => {
    _setTargetId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  };

  const target = TARGETS.find((t) => t.id === targetId) ?? TARGETS[0];

  return (
    <TargetCtx.Provider value={{ target, setTargetId }}>
      {children}
    </TargetCtx.Provider>
  );
}

export function useTarget(): Ctx {
  const ctx = useContext(TargetCtx);
  if (!ctx) {
    throw new Error("useTarget must be used inside <TargetProvider>");
  }
  return ctx;
}

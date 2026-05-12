"use client";

import { useState, type FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldAlert, Lock } from "lucide-react";

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get("from") || "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const resp = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (resp.ok) {
        router.replace(from);
        router.refresh();
      } else {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Login failed (${resp.status})`);
      }
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="flex flex-col items-center gap-7">
        {/* Logo row */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900">
            <ShieldAlert className="h-5 w-5 text-rose-400" />
          </div>
          <span className="text-xl font-bold text-slate-900">
            AgentForge · Adversarial
          </span>
        </div>

        {/* Card */}
        <form
          onSubmit={submit}
          className="w-[440px] rounded-xl border border-slate-200 bg-white px-9 pt-8 pb-8 shadow-[0_8px_24px_rgba(0,0,0,0.04)]"
        >
          <div className="space-y-1.5">
            <h1 className="text-[22px] font-bold leading-7 text-slate-900">
              Sign in
            </h1>
            <p className="text-[13px] leading-5 text-slate-600">
              Authorized access only. Campaigns launched here hit the deployed
              Clinical Co-Pilot and incur real LLM spend.
            </p>
          </div>

          <div className="mt-5 space-y-2">
            <label
              htmlFor="password"
              className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
            >
              PASSWORD
            </label>
            <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-amber-50/40 px-3.5 py-3 focus-within:border-teal-600">
              <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              <input
                id="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="flex-1 bg-transparent text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none"
              />
            </div>
            {error && (
              <p className="pt-1 text-[12px] font-medium text-red-600">
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || password.length === 0}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 py-3 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in →"}
          </button>

          <div className="mt-5 border-t border-amber-100" />

          <div className="mt-3 flex items-center gap-2.5 text-[11px] leading-4 text-slate-500">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="font-medium">
              Auth window 2026-05-11 → 2026-05-22 · ARCHITECTURE.md §13
            </span>
          </div>
        </form>

        <p className="max-w-[440px] text-center text-[11px] leading-4 text-slate-400">
          All access logged. Target host allowlist enforced server-side —
          non-allowlisted URLs hard-error before any HTTP call.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
          Loading…
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
